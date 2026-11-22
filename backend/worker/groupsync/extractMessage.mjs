/**
 * WhatsApp group sync: the `whatsapp.extract` pipeline.
 *
 * One job = one captured message (ids only: `{ rawMessageId }`). The steps:
 *
 *   1. idempotency gate: only a `queued` message is processed, so a redelivered
 *      or retried job is a no-op;
 *   2. gather: the student's subjects, time zone and date order, and, for a
 *      file, its text (PDF/DOCX/PPTX) or, for an image, a vision check first;
 *   3. an image that is a meme, selfie or casual photo is DISCARDED (marked
 *      `ignored_noise`, the stored copy removed); an exam schedule, official
 *      notice or whiteboard goes on to multimodal extraction;
 *   4. one structured Gemini call, validated with Zod (one retry on a malformed
 *      answer, then a sanitized failure);
 *   5. plan: resolve dates deterministically, match subjects, score;
 *   6. persist: confident items go straight to tasks/events, the rest to the
 *      review queue; the file gets its summary, tags and subject.
 *
 * Failure policy: rate limits and outages RETRY (the worker's backoff), keeping
 * the message `queued`; a final attempt, or anything permanent, marks the
 * message `failed` with a fixed sanitized reason. Message text, file text and
 * provider bodies are never logged.
 */
import { createGeminiClient, GeminiError, GEMINI_MESSAGES, readGeminiConfig } from "./gemini.mjs";
import { startJobHeartbeat } from "../heartbeat.mjs";
import { extractDocx } from "../extract/docx.mjs";
import { extractPdf } from "../extract/pdf.mjs";
import { extractPptx } from "../extract/pptx.mjs";
import { buildClassifyParts, buildExtractionParts, EXTRACTION_SYSTEM, IMAGE_CLASSIFY_SYSTEM } from "./prompts.mjs";
import { pickDocumentSubject, planItems, readThreshold } from "./plan.mjs";
import {
  ExtractionSchema,
  ImageClassSchema,
  toRequestSchema,
  USEFUL_IMAGE_CATEGORIES,
} from "./schemas.mjs";
import { zonedParts } from "./whenResolver.mjs";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

/** Fixed, user-safe reasons stored in `raw_messages.error`. */
export const EXTRACT_MESSAGES = {
  fileUnreadable: "The file could not be read.",
  fileMissing: "The file for this message is missing.",
  imageTooLarge: "The image is too large for AI analysis.",
  exhausted: "This could not be processed after several attempts.",
};

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function pad(n) {
  return String(n).padStart(2, "0");
}

function describeLocal(sentAt, timeZone) {
  const p = zonedParts(sentAt.getTime(), timeZone);
  return `${WEEKDAY[p.weekday]} ${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)} (${timeZone})`;
}

function permanent(message) {
  const error = new Error(message);
  error.retryable = false;
  return error;
}

function documentKind(mime) {
  if (mime === "application/pdf") return "pdf";
  if (mime === DOCX_MIME) return "docx";
  if (mime === PPTX_MIME) return "pptx";
  if (mime === "image/png" || mime === "image/jpeg") return "image";
  return null;
}

async function extractText(kind, bytes, extractors) {
  const buffer = Buffer.from(bytes);
  const result =
    kind === "pdf"
      ? await extractors.pdf(buffer)
      : kind === "docx"
        ? await extractors.docx(buffer)
        : await extractors.pptx(buffer);
  return result.pages.join("\n\n").trim();
}

/** One validated model call; a malformed answer is retried once. */
async function callValidated(gemini, schema, request) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { value, usage } = await gemini.generateJson({
      ...request,
      jsonSchema: toRequestSchema(schema),
    });
    const parsed = schema.safeParse(value);
    if (parsed.success) return { data: parsed.data, usage };
    lastError = parsed.error;
  }
  void lastError; // the Zod issues can quote the model's output: never logged
  throw new GeminiError("invalid_response", GEMINI_MESSAGES.invalid_response, false);
}

/**
 * @param {object} deps
 * @param {object} deps.repo       see repo.mjs
 * @param {object} deps.gemini     createGeminiClient(...) or a fake
 * @param {() => Date} [deps.now]
 * @param {number} [deps.threshold]
 * @param {object} [deps.extractors]  { pdf, docx, pptx } (test seam)
 * @param {(line: string) => void} [deps.log]
 * @param {string} rawMessageId
 * @param {{attempt?: number, maxAttempts?: number}} [attempt]
 */
export async function extractMessage(deps, rawMessageId, attempt = {}) {
  const { repo, gemini } = deps;
  const log = deps.log ?? (() => undefined);
  const now = (deps.now ?? (() => new Date()))();
  const threshold = deps.threshold ?? readThreshold();
  const extractors = { pdf: extractPdf, docx: extractDocx, pptx: extractPptx, ...(deps.extractors ?? {}) };

  const message = await repo.getMessage(rawMessageId);
  if (!message) return { outcome: "missing" };
  if (message.status !== "queued") return { outcome: "already_settled" };

  const fail = async (reason) => {
    await repo.setMessage(message.id, "failed", reason);
    return { outcome: "failed" };
  };

  if (!gemini.configured) {
    await repo.setMessage(message.id, "failed", GEMINI_MESSAGES.not_configured);
    throw permanent(GEMINI_MESSAGES.not_configured);
  }

  try {
    return await run();
  } catch (error) {
    const retryable = error?.retryable !== false;
    const last = (attempt.attempt ?? 1) >= (attempt.maxAttempts ?? 5);
    // A retry is coming: leave the message `queued`. Otherwise settle it now so
    // it never sits `queued` forever behind a dead job.
    if (!retryable || last) {
      await repo
        .setMessage(
          message.id,
          "failed",
          error instanceof GeminiError && !retryable ? error.message : EXTRACT_MESSAGES.exhausted,
        )
        .catch(() => undefined);
    }
    throw error;
  }

  async function run() {
    const ctx = await repo.getContext(message.user_id, message.group_jid);
    const sentAt = new Date(message.sent_at);
    const doc = message.media_type === "none" ? null : await repo.getDocument(message.id);

    if (message.media_type !== "none" && !doc) return fail(EXTRACT_MESSAGES.fileMissing);

    let documentText = null;
    let image = null;
    let usageCalls = 0;
    const tokens = { input: 0, output: 0 };
    const addUsage = (u) => {
      usageCalls += 1;
      tokens.input += u?.inputTokens ?? 0;
      tokens.output += u?.outputTokens ?? 0;
    };

    if (doc) {
      const kind = documentKind(doc.mime_type);
      if (!kind) return fail(EXTRACT_MESSAGES.fileUnreadable);
      const bytes = await repo.downloadObject(doc.storage_path);

      if (kind === "image") {
        if (bytes.byteLength > MAX_IMAGE_BYTES) return fail(EXTRACT_MESSAGES.imageTooLarge);
        const data = Buffer.from(bytes).toString("base64");
        const classified = await callValidated(gemini, ImageClassSchema, {
          system: IMAGE_CLASSIFY_SYSTEM,
          parts: buildClassifyParts({ mimeType: doc.mime_type, data }),
          maxOutputTokens: 256,
        });
        addUsage(classified.usage);
        if (!USEFUL_IMAGE_CATEGORIES.has(classified.data.category)) {
          // A meme, selfie or casual photo: discard it entirely.
          await repo.deleteDocument(doc.id, doc.storage_path);
          await repo.setMessage(message.id, "ignored_noise", null);
          await recordUsage();
          return { outcome: "discarded_image", category: classified.data.category };
        }
        image = { mimeType: doc.mime_type, data };
      } else {
        try {
          documentText = await extractText(kind, bytes, extractors);
        } catch {
          return fail(EXTRACT_MESSAGES.fileUnreadable);
        }
      }
    }

    if (!message.raw_text.trim() && !documentText && !image) {
      await repo.setMessage(message.id, "ignored_noise", null);
      return { outcome: "empty" };
    }

    const extraction = await callValidated(gemini, ExtractionSchema, {
      system: EXTRACTION_SYSTEM,
      parts: buildExtractionParts({
        messageText: message.raw_text,
        documentText,
        documentName: doc?.name ?? "",
        senderName: message.sender_name,
        groupName: ctx.groupName,
        sentAtLocal: describeLocal(sentAt, ctx.timeZone),
        dateOrder: ctx.dateOrder,
        subjects: ctx.subjects,
        image,
      }),
      maxOutputTokens: 4096,
    });
    addUsage(extraction.usage);

    const plans = planItems(extraction.data, {
      sentAt,
      timeZone: ctx.timeZone,
      dateOrder: ctx.dateOrder,
      now,
      threshold,
      subjects: ctx.subjects,
      messageText: message.raw_text,
      rawFingerprint: message.fingerprint,
    });

    const counts = { auto: 0, review: 0, skipped: 0, duplicate: 0, alreadyReviewed: 0 };
    for (const plan of plans) {
      if (plan.action === "skip") {
        counts.skipped += 1;
        continue;
      }
      // A rejected (or already-handled) suggestion with this key is final.
      if (await repo.candidateExists(message.user_id, plan.ref)) {
        counts.alreadyReviewed += 1;
        continue;
      }

      const description = `From WhatsApp${ctx.groupName ? ` (${ctx.groupName})` : ""}: ${plan.evidence}`.slice(0, 500);
      if (plan.action === "auto") {
        const base = {
          userId: message.user_id,
          title: plan.title,
          description,
          subjectId: plan.subjectId,
          ref: plan.ref,
          messageId: message.id,
          confidence: plan.confidence,
        };
        const result =
          plan.kind === "task"
            ? await repo.insertTask({ ...base, dueAt: plan.startAt, taskType: plan.type })
            : await repo.insertEvent({
                ...base,
                startAt: plan.startAt,
                endAt: plan.endAt,
                allDay: plan.allDay,
                eventType: plan.eventType,
              });
        counts[result === "inserted" ? "auto" : "duplicate"] += 1;
      } else {
        const result = await repo.insertCandidate({
          userId: message.user_id,
          ref: plan.ref,
          kind: plan.kind,
          title: plan.title,
          startAt: plan.startAt,
          endAt: plan.endAt,
          allDay: plan.allDay,
          sender: message.sender_name,
          messageText: message.raw_text.slice(0, 1000),
          eventType: plan.eventType,
          taskType: plan.kind === "task" ? plan.type : null,
          confidence: plan.confidence,
          subjectId: plan.subjectId,
          proposedSubjectName: plan.proposedSubjectName,
          messageId: message.id,
          groupName: ctx.groupName,
        });
        counts[result === "inserted" ? "review" : "duplicate"] += 1;
      }
    }

    if (doc) {
      const subjectId = pickDocumentSubject({
        plans,
        fileName: doc.name,
        caption: message.raw_text,
        textHead: (documentText ?? "").slice(0, 2_000),
        subjects: ctx.subjects,
      });
      await repo.updateDocument(doc.id, {
        ai_summary: extraction.data.summary ?? null,
        topic_tags: (extraction.data.topic_tags ?? []).slice(0, 8),
        subject_id: subjectId,
      });
      // Searchable text for the Documents page: PDFs and DOCX only (the
      // existing processor has no PPTX/vision path).
      const kind = documentKind(doc.mime_type);
      if (kind === "pdf" || kind === "docx") await repo.enqueueIndexing(message.user_id, doc.id);
    }

    const noise = !doc && !extraction.data.relevant && plans.length === 0;
    await repo.setMessage(message.id, noise ? "ignored_noise" : "processed", null);
    await recordUsage();
    log(
      `extract message=${message.id} outcome=${noise ? "noise" : "processed"} auto=${counts.auto} review=${counts.review} skipped=${counts.skipped} dup=${counts.duplicate}`,
    );
    return { outcome: noise ? "noise" : "processed", counts };

    async function recordUsage() {
      if (usageCalls === 0) return;
      try {
        await repo.recordUsage(message.user_id, "gemini_extract", usageCalls);
      } catch {
        // The ledger must never fail an extraction.
      }
    }
  }
}

/** The registry entry: `handlers["whatsapp.extract"]`. */
export async function whatsappExtract(payload, ctx) {
  const id = typeof payload?.rawMessageId === "string" ? payload.rawMessageId.trim() : "";
  if (!id) throw permanent("whatsapp.extract needs a rawMessageId.");

  const { createRepo } = await import("./repo.mjs");
  const gemini = createGeminiClient({ config: readGeminiConfig() });
  /* A slow Gemini call or a large file must never outlive the 5-minute lease;
     the heartbeat extends it exactly like the Python and presentation jobs. */
  const stopHeartbeat = startJobHeartbeat(ctx);
  try {
    await extractMessage(
      { repo: createRepo(ctx.client), gemini, log: ctx.log },
      id,
      { attempt: ctx.attempt, maxAttempts: ctx.maxAttempts },
    );
  } finally {
    stopHeartbeat();
  }
}
