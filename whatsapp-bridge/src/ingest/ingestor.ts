import type { WAMessage } from "@whiskeysockets/baileys";
import type { Logger } from "pino";
import { safeError } from "../log.ts";
import type { MediaCapture } from "../media/capture.ts";
import type { IngestRow, SessionStore } from "../store/types.ts";
import { computeFingerprint } from "./fingerprint.ts";
import { isTrivialText, parseGroupMessage, type ParsedMessage } from "./parse.ts";

export interface IngestSummary {
  /** Messages offered by Baileys (every chat, not just groups). */
  received: number;
  /** Rows the database actually inserted (duplicates and inactive groups excluded). */
  ingested: number;
  /** Dropped because they are not a capturable group message. */
  skippedUnparsed: number;
  /** Dropped because their group is not switched on. */
  skippedInactive: number;
  /** Dropped as obvious chatter before any storage. */
  skippedTrivial: number;
  /** Attachments stored / already stored / failed. */
  media: { stored: number; duplicate: number; failed: number };
}

const EMPTY = (): IngestSummary => ({
  received: 0,
  ingested: 0,
  skippedUnparsed: 0,
  skippedInactive: 0,
  skippedTrivial: 0,
  media: { stored: 0, duplicate: 0, failed: 0 },
});

interface IngestorDeps {
  store: SessionStore;
  logger: Logger;
  media?: MediaCapture;
  /** How long the active-group list is cached per user. */
  activeTtlMs?: number;
  now?: () => number;
  /** Rows per database call. */
  batchSize?: number;
}

/**
 * Turns Baileys message events into `raw_messages` rows.
 *
 * The privacy rule is enforced twice: this class drops anything outside an
 * ACTIVE group before touching the database, and `ingest_raw_messages` joins on
 * `monitored_groups.is_active` itself. Nothing from a group the student has not
 * switched on is ever stored, and history delivered at link time is therefore
 * ingested only for groups that were already on.
 */
export class MessageIngestor {
  private readonly deps: IngestorDeps;
  private readonly active = new Map<string, { at: number; jids: Set<string> }>();
  /** Per-user serial queue: batches for one user never interleave. */
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(deps: IngestorDeps) {
    this.deps = deps;
  }

  handle(userId: string, messages: WAMessage[], source: "history" | "live"): Promise<IngestSummary> {
    const previous = this.queues.get(userId) ?? Promise.resolve();
    const run = previous.then(
      () => this.process(userId, messages, source),
      () => this.process(userId, messages, source),
    );
    this.queues.set(
      userId,
      run.catch(() => undefined),
    );
    return run;
  }

  private async activeGroups(userId: string): Promise<Set<string>> {
    const now = (this.deps.now ?? Date.now)();
    const ttl = this.deps.activeTtlMs ?? 5_000;
    const cached = this.active.get(userId);
    if (cached && now - cached.at < ttl) return cached.jids;
    const jids = await this.deps.store.listActiveGroups(userId);
    this.active.set(userId, { at: now, jids });
    return jids;
  }

  private async process(
    userId: string,
    messages: WAMessage[],
    source: "history" | "live",
  ): Promise<IngestSummary> {
    const { store, logger } = this.deps;
    const summary = EMPTY();
    summary.received = messages.length;
    if (messages.length === 0) return summary;

    const active = await this.activeGroups(userId);
    const rows: IngestRow[] = [];
    const bySlot = new Map<string, { parsed: ParsedMessage; raw: WAMessage }>();

    for (const raw of messages) {
      const parsed = parseGroupMessage(raw);
      if (!parsed) {
        summary.skippedUnparsed += 1;
        continue;
      }
      if (!active.has(parsed.groupJid)) {
        summary.skippedInactive += 1;
        continue;
      }
      if (isTrivialText(parsed.text, parsed.media !== null)) {
        summary.skippedTrivial += 1;
        continue;
      }
      const slot = `${parsed.groupJid}|${parsed.whatsappMsgId}`;
      if (bySlot.has(slot)) continue; // the same message twice in one batch
      bySlot.set(slot, { parsed, raw });

      const reported = parsed.media?.reportedSha256 ?? null;
      rows.push({
        groupJid: parsed.groupJid,
        whatsappMsgId: parsed.whatsappMsgId,
        fingerprint: computeFingerprint({
          userId,
          groupJid: parsed.groupJid,
          senderName: parsed.senderName,
          sentAt: parsed.sentAt,
          textOrFileSha256: reported ?? parsed.text,
          isFileHash: reported !== null,
        }),
        senderName: parsed.senderName,
        sentAt: parsed.sentAt.toISOString(),
        rawText: parsed.text,
        mediaType: parsed.media?.type ?? "none",
        fileSha256: reported,
      });
    }

    const size = this.deps.batchSize ?? 200;
    for (let start = 0; start < rows.length; start += size) {
      const inserted = await store.ingestMessages(userId, rows.slice(start, start + size));
      summary.ingested += inserted.length;

      for (const row of inserted) {
        if (row.mediaType === "none" || !this.deps.media) continue;
        const entry = bySlot.get(`${row.groupJid}|${row.whatsappMsgId}`);
        if (!entry?.parsed.media) continue;
        const outcome = await this.deps.media.capture(userId, row, entry.parsed.media, entry.raw);
        summary.media[outcome] += 1;
      }
    }

    // Counts only: never a name, a jid, or a word of a message.
    logger.info(
      {
        source,
        received: summary.received,
        ingested: summary.ingested,
        skipped: {
          unparsed: summary.skippedUnparsed,
          inactive: summary.skippedInactive,
          trivial: summary.skippedTrivial,
        },
        media: summary.media,
      },
      "messages processed",
    );
    return summary;
  }

  /** Called by the runner hooks; never throws into the socket's event loop. */
  async safeHandle(
    userId: string,
    messages: WAMessage[],
    source: "history" | "live",
  ): Promise<void> {
    try {
      await this.handle(userId, messages, source);
    } catch (error) {
      this.deps.logger.error(safeError(error), "ingestion failed");
    }
  }
}
