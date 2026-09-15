/**
 * Task 24.x — the `document.process` handler.
 *
 * Turns a settled upload into normalized, stored text:
 *
 *   uploaded → indexing → indexed
 *                      ↘ failed (sanitized error_message; a retryable failure
 *                        rests failed until the next attempt flips it back)
 *
 * The unit of storage is one page (PDF) or the whole document (DOCX): the
 * schema's `document_chunks` carries ordered text, and 25.x owns the real
 * chunking strategy for embeddings — this phase must not pre-empt it. Writes
 * are idempotent: chunks are replaced, never appended, so a retry after a
 * partial write cannot duplicate text.
 *
 * Failure policy: corrupt/unsupported/unreadable content fails permanently
 * (`failed` on the job); transport failures (a missing object, a database
 * write) retry with the 29.1 backoff; the last attempt records the terminal
 * copy. All user-facing copy lives here and is sanitized — no library,
 * Postgres or provider message ever reaches `error_message`, and the worker
 * logs ids/counts only, never document content.
 */
import { extractDocx } from "./extract/docx.mjs";
import { OcrUnavailableError, extractWithOcr } from "./extract/ocr.mjs";
import { extractPdf } from "./extract/pdf.mjs";
import { isProbablyScanned, normalizeText } from "./extract/text.mjs";

const DOCUMENT_BUCKET = "documents";
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** 24.13 / R5 — the documented per-document processing limits. */
export const DOCUMENT_MAX_PAGES = 200;
export const DOCUMENT_MAX_CHARS = 2_000_000;

/** Sanitized, user-facing copy (24.12). The only strings that reach the DB. */
export const PROCESSING_COPY = {
  TRANSIENT:
    "We couldn't finish processing this document. We'll try again shortly.",
  TERMINAL:
    "We couldn't process this document after several attempts. Try uploading it again.",
  UNREADABLE:
    "This file's contents couldn't be read. Make sure it isn't corrupted or password-protected, then try uploading it again.",
  OCR_UNAVAILABLE:
    "Image and scanned-document processing isn't available yet. Upload a text-based PDF or DOCX for now.",
  TOO_MANY_PAGES: `This document has more than ${DOCUMENT_MAX_PAGES} pages, which this plan doesn't process yet.`,
  TOO_MUCH_TEXT:
    "This document contains too much text to process. Split it into smaller files and try again.",
};

class ProcessingFailure extends Error {
  constructor(message, retryable) {
    super(message);
    this.name = "ProcessingFailure";
    this.retryable = retryable;
  }
}

function permanent(message) {
  return new ProcessingFailure(message, false);
}

function transient() {
  return new ProcessingFailure(PROCESSING_COPY.TRANSIENT, true);
}

/** The raw cause stays in server logs; the DB and the user see sanitized copy. */
function classify(caught, ctx) {
  if (caught instanceof ProcessingFailure) return caught;
  if (caught instanceof OcrUnavailableError) {
    ctx.log(`ocr_unavailable ${caught.message}`);
    return permanent(PROCESSING_COPY.OCR_UNAVAILABLE);
  }
  const reason = caught instanceof Error ? caught.message : String(caught);
  ctx.log(`processing_error ${reason}`);
  return transient();
}

function readDocumentId(payload) {
  if (payload === null || typeof payload !== "object") return null;
  const id = payload.documentId;
  return typeof id === "string" && id.trim() !== "" ? id.trim() : null;
}

async function loadDocument(ctx, documentId) {
  const { data, error } = await ctx.client
    .from("documents")
    .select("id, user_id, name, storage_path, mime_type, status")
    .eq("id", documentId)
    .maybeSingle();

  if (error) throw transient();
  return data;
}

async function markIndexing(ctx, documentId) {
  const { error } = await ctx.client
    .from("documents")
    .update({ status: "indexing", error_message: null })
    .eq("id", documentId);
  if (error) throw transient();
}

async function extract(ctx, row, buffer) {
  if (row.mime_type === "application/pdf") {
    try {
      return await extractPdf(buffer);
    } catch {
      throw permanent(PROCESSING_COPY.UNREADABLE);
    }
  }

  if (row.mime_type === DOCX_MIME) {
    try {
      return await extractDocx(buffer);
    } catch {
      throw permanent(PROCESSING_COPY.UNREADABLE);
    }
  }

  if (row.mime_type === "image/png" || row.mime_type === "image/jpeg") {
    // 24.5/24.6 — the OCR seam. It throws until a provider exists, and the
    // classified error carries the honest "not available yet" copy.
    return await extractWithOcr(buffer, row.mime_type);
  }

  throw permanent(PROCESSING_COPY.UNREADABLE);
}

async function run(ctx, row) {
  if (row.storage_path === null) throw permanent(PROCESSING_COPY.UNREADABLE);

  const download = await ctx.client.storage
    .from(DOCUMENT_BUCKET)
    .download(row.storage_path);
  if (download.error || !download.data) throw transient();
  const buffer = Buffer.from(await download.data.arrayBuffer());

  const extracted = await extract(ctx, row, buffer);
  const pages = extracted.pages.map((page) => normalizeText(page));
  const joined = pages.join("\n\n");

  // A PDF with no text layer is a scan: OCR (24.6) is blocked, and pretending
  // an empty extraction succeeded would hide the document from the student.
  if (row.mime_type === "application/pdf" && isProbablyScanned(joined)) {
    throw permanent(PROCESSING_COPY.OCR_UNAVAILABLE);
  }
  if (extracted.pageCount !== null && extracted.pageCount > DOCUMENT_MAX_PAGES) {
    throw permanent(PROCESSING_COPY.TOO_MANY_PAGES);
  }
  if (joined.replace(/\s/g, "").length === 0) {
    throw permanent(PROCESSING_COPY.UNREADABLE);
  }
  if (joined.length > DOCUMENT_MAX_CHARS) {
    throw permanent(PROCESSING_COPY.TOO_MUCH_TEXT);
  }

  // One unit per page, ordered; 25.x re-chunks for embeddings. The source
  // page travels with the unit so 25.9's references work before re-indexing.
  const units = pages
    .map((content, index) => ({
      document_id: row.id,
      chunk_index: index,
      page: extracted.pageCount !== null ? index + 1 : null,
      content,
    }))
    .filter((unit) => unit.content !== "");

  // Replace, not append: a retry after a partial write is safe.
  const cleared = await ctx.client
    .from("document_chunks")
    .delete()
    .eq("document_id", row.id);
  if (cleared.error) throw transient();

  if (units.length > 0) {
    const inserted = await ctx.client.from("document_chunks").insert(units);
    if (inserted.error) throw transient();
  }

  const settled = await ctx.client
    .from("documents")
    .update({
      status: "indexed",
      error_message: null,
      page_count: extracted.pageCount,
    })
    .eq("id", row.id);
  if (settled.error) throw transient();

  ctx.log(
    `indexed document=${row.id} pages=${extracted.pageCount ?? "n/a"} units=${units.length}`,
  );
}

async function recordFailure(ctx, row, failure) {
  if (!row) return;

  const terminal =
    failure.retryable === false || ctx.attempt >= ctx.maxAttempts;
  const message = !failure.retryable
    ? failure.message
    : terminal
      ? PROCESSING_COPY.TERMINAL
      : PROCESSING_COPY.TRANSIENT;

  // Best effort: the job's own failure record is what the runner settles, and
  // a failed status write must not mask the original error.
  try {
    await ctx.client
      .from("documents")
      .update({ status: "failed", error_message: message })
      .eq("id", row.id);
  } catch {
    // Ignored deliberately; the runner still reports the failure.
  }
}

export async function processDocument(payload, ctx) {
  const documentId = readDocumentId(payload);
  if (documentId === null) {
    throw permanent(PROCESSING_COPY.UNREADABLE);
  }

  let row = null;
  try {
    row = await loadDocument(ctx, documentId);
    if (row === null) {
      ctx.log(`document=${documentId} no longer exists; nothing to process`);
      return;
    }
    await markIndexing(ctx, row.id);
    await run(ctx, row);
  } catch (caught) {
    const failure = classify(caught, ctx);
    await recordFailure(ctx, row, failure);
    throw failure;
  }
}
