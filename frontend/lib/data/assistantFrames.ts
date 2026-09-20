/**
 * Task 19.x — the assistant UI's pure frame vocabulary.
 *
 * `POST /api/assistant/turn` (26.8) answers with `text/event-stream` of
 * `data: <json>\n\n` blocks, one `AssistantStreamFrame` per block. This module
 * is the client half: it parses arbitrary SSE chunks into validated frames and
 * reduces them onto a streaming assistant entry — without importing the
 * server pipeline (`assistant.ts`), any Supabase client or `next/headers`, so
 * the chat UI and its specs can use the exact contract the route emits.
 *
 * Honesty rules:
 *   - an entry's `content` is only ever the `delta` text the stream delivered
 *     (no fallback copy is ever fabricated here);
 *   - a `done` frame's status is copied verbatim: `unconfigured` stays an
 *     honest unconfigured entry, never folded into `failed` or `complete`;
 *   - an `error` frame records its sanitized copy and marks the entry failed,
 *     without inventing any answer text;
 *   - malformed JSON, malformed frame shapes, unknown frame types, comment
 *     lines and `[DONE]`-style terminators are dropped, never guessed at.
 *
 * Pure and dependency-free (only the client-safe vocabulary types), so both
 * the streaming UI and `assistant-ui.spec.ts` prove it without a provider or a
 * browser.
 */
import type {
  AssistantSource,
  AssistantStreamFrame,
  AssistantTurnStatus,
} from "./assistantValues";

/** An entry is streaming until a terminal frame settles it. */
export type AssistantEntryStatus = "streaming" | AssistantTurnStatus;

/** One assistant turn being received, before it is a stored message. */
export type AssistantEntry = {
  role: "assistant";
  /** The settled message id announced by `done`; null until then. */
  messageId: string | null;
  /** Set by `start` (or seeded by the caller for an existing conversation). */
  conversationId: string | null;
  /** Only what `delta` frames delivered; never fabricated. */
  content: string;
  /** Set to a terminal status by `done`/`error`; never returns to streaming. */
  status: AssistantEntryStatus;
  /** Set by `start`; null until the stream opens. */
  configured: boolean | null;
  /** The `sources` frame's list; empty until (and unless) it arrives. */
  sources: AssistantSource[];
  /** The `error` frame's sanitized copy; null otherwise. */
  error: string | null;
};

/**
 * A fresh streaming assistant entry. Pass `conversationId` when the turn is
 * sent into an already selected conversation; the `start` frame overwrites it
 * with the server's answer either way.
 */
export function createAssistantEntry(
  initial: { conversationId?: string | null } = {},
): AssistantEntry {
  return {
    role: "assistant",
    messageId: null,
    conversationId: initial.conversationId ?? null,
    content: "",
    status: "streaming",
    configured: null,
    sources: [],
    error: null,
  };
}

/**
 * Applies one frame to a streaming entry (client-side accumulation).
 *
 *   - `start`       records the conversation + configured flag;
 *   - `delta`       appends text; an empty delta changes nothing;
 *   - `sources`     attaches the delivered list in order (an empty list is a
 *                   no-op, so it can never erase a previous attach);
 *   - `done`        copies the terminal status and the settled message id;
 *   - `error`       marks the entry `failed` and records the sanitized copy.
 *
 * Returns a new entry except for no-op frames (empty delta / empty sources),
 * which return the input entry unchanged.
 */
export function applyAssistantFrame(
  entry: AssistantEntry,
  frame: AssistantStreamFrame,
): AssistantEntry {
  switch (frame.type) {
    case "start":
      return {
        ...entry,
        conversationId: frame.conversationId,
        configured: frame.configured,
      };
    case "delta":
      return frame.text === ""
        ? entry
        : { ...entry, content: entry.content + frame.text };
    case "sources":
      return frame.sources.length === 0
        ? entry
        : { ...entry, sources: [...frame.sources] };
    case "done":
      return {
        ...entry,
        status: frame.status,
        // A terminal frame without an id must not erase an id already learned.
        messageId: frame.messageId ?? entry.messageId,
      };
    case "error":
      return { ...entry, status: "failed", error: frame.error };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * One source entry, kept only when it carries the stored shape
 * (`messages.ts`'s `parseAssistantSources`): a document id + name and a
 * numeric chunk index; `page` is optional and kept only when numeric.
 */
function parseSourceValue(value: unknown): AssistantSource | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.documentId !== "string" ||
    typeof value.documentName !== "string" ||
    typeof value.chunkIndex !== "number"
  ) {
    return null;
  }
  const source: AssistantSource = {
    documentId: value.documentId,
    documentName: value.documentName,
    chunkIndex: value.chunkIndex,
  };
  if (typeof value.page === "number") source.page = value.page;
  return source;
}

function isTurnStatus(value: unknown): value is AssistantTurnStatus {
  return value === "complete" || value === "failed" || value === "unconfigured";
}

/**
 * One parsed JSON payload → a validated frame, or null for anything this
 * contract does not carry (unknown `type`, wrong field types, non-objects).
 * The frame's declared shape is the validation rule; the one leniency is
 * `done.messageId`, which normalizes an absent/non-string id to null instead
 * of dropping a terminal frame (that would leave the UI streaming).
 */
export function normalizeAssistantFrame(
  value: unknown,
): AssistantStreamFrame | null {
  if (!isRecord(value)) return null;

  switch (value.type) {
    case "start":
      return typeof value.conversationId === "string" &&
        typeof value.configured === "boolean"
        ? {
            type: "start",
            conversationId: value.conversationId,
            configured: value.configured,
          }
        : null;
    case "delta":
      return typeof value.text === "string"
        ? { type: "delta", text: value.text }
        : null;
    case "sources":
      return Array.isArray(value.sources)
        ? {
            type: "sources",
            sources: value.sources
              .map(parseSourceValue)
              .filter((source): source is AssistantSource => source !== null),
          }
        : null;
    case "done":
      return isTurnStatus(value.status)
        ? {
            type: "done",
            status: value.status,
            messageId:
              typeof value.messageId === "string" ? value.messageId : null,
          }
        : null;
    case "error":
      return typeof value.error === "string"
        ? { type: "error", error: value.error }
        : null;
    default:
      return null;
  }
}

/**
 * Splits a growing SSE buffer into validated frames plus the incomplete tail.
 *
 * Follows the wire format the route emits (and the SSE spec): blocks are
 * blank-line separated, `data:` lines join with `\n`, CRLF/CR are normalized,
 * comment lines (`:`) are ignored, and an optional single space after the
 * colon is stripped. A block whose joined data is malformed JSON, is
 * `[DONE]`, or does not normalize to a frame is dropped; only complete blocks
 * are ever parsed, so a chunk may split a frame anywhere and the caller
 * passes the returned `carry` into the next call.
 *
 * The caller owns the "stream ended" case: appending `"\n\n"` to a final
 * partial chunk flushes an unterminated block (a well-formed stream ends every
 * frame with the blank separator).
 */
export function parseSseFrames(
  chunk: string,
  carry: string,
): { frames: AssistantStreamFrame[]; carry: string } {
  const buffer = `${carry}${chunk}`.replace(/\r\n|\r/g, "\n");
  const blocks = buffer.split("\n\n");
  const rest = blocks.pop() ?? "";
  const frames: AssistantStreamFrame[] = [];

  for (const block of blocks) {
    if (block.trim() === "") continue;

    let data: string | null = null;
    for (const line of block.split("\n")) {
      if (line === "" || line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      if (colon < 0) continue;
      if (line.slice(0, colon) !== "data") continue;
      const raw = line.slice(colon + 1);
      const value = raw.startsWith(" ") ? raw.slice(1) : raw;
      data = data === null ? value : `${data}\n${value}`;
    }

    if (data === null) continue;
    if (data.trim() === "[DONE]") continue;

    try {
      const frame = normalizeAssistantFrame(JSON.parse(data));
      if (frame !== null) frames.push(frame);
    } catch {
      // Malformed JSON: skipped, never guessed at.
    }
  }

  return { frames, carry: rest };
}
