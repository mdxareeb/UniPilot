/**
 * Task 25.1/25.2/25.12 — the `document.reindex` handler.
 *
 * Re-chunks the stored page text into embedding-sized windows (25.1's
 * strategy) and replaces the document's chunk rows; when a provider exists it
 * would embed the new chunks in the same pass. This is the backfill/re-embed
 * path: run it for any document whose chunks predate the strategy, or after a
 * chunking change.
 *
 * Idempotent by construction: the chunker is deterministic and the write is
 * delete-then-insert, so running twice yields the same `(chunk_index, page,
 * content)` set — never duplicates.
 *
 * The document's `status` is deliberately untouched: re-indexing is an
 * internal retrieval concern, and a reindex failure must not mark a
 * perfectly searchable document as failed. The job's own state carries the
 * failure (29.1's retry/dead-letter).
 */
import { CHUNK_OVERLAP_CHARS, CHUNK_TARGET_CHARS, chunkText } from "./chunkText.mjs";
import { embedTexts, embeddingProviderStatus } from "./embed.mjs";

export const REINDEX_COPY = {
  UNPROCESSED:
    "This document hasn't been processed yet, so there is no text to re-index.",
};

class ReindexFailure extends Error {
  constructor(message, retryable) {
    super(message);
    this.name = "ReindexFailure";
    this.retryable = retryable;
  }
}

const permanent = (message) => new ReindexFailure(message, false);
const transient = () =>
  new ReindexFailure(
    "Re-indexing hit a temporary problem. We'll try again shortly.",
    true,
  );

function readDocumentId(payload) {
  if (payload === null || typeof payload !== "object") return null;
  const id = payload.documentId;
  return typeof id === "string" && id.trim() !== "" ? id.trim() : null;
}

export async function reindexDocument(payload, ctx) {
  const documentId = readDocumentId(payload);
  if (documentId === null) {
    throw permanent(REINDEX_COPY.UNPROCESSED);
  }

  const { data: document, error: documentError } = await ctx.client
    .from("documents")
    .select("id, name, mime_type")
    .eq("id", documentId)
    .maybeSingle();
  if (documentError) throw transient();
  if (document === null) {
    ctx.log(`document=${documentId} no longer exists; nothing to re-index`);
    return;
  }

  const { data: source, error: sourceError } = await ctx.client
    .from("document_chunks")
    .select("chunk_index, page, content")
    .eq("document_id", documentId)
    .order("chunk_index", { ascending: true });
  if (sourceError) throw transient();
  if (!source || source.length === 0) {
    throw permanent(REINDEX_COPY.UNPROCESSED);
  }

  const rows = [];
  let chunkIndex = 0;
  for (const unit of source) {
    for (const content of chunkText(unit.content, {
      target: CHUNK_TARGET_CHARS,
      overlap: CHUNK_OVERLAP_CHARS,
    })) {
      rows.push({
        document_id: documentId,
        chunk_index: chunkIndex,
        page: unit.page ?? null,
        content,
      });
      chunkIndex += 1;
    }
  }
  if (rows.length === 0) throw permanent(REINDEX_COPY.UNPROCESSED);

  // Replace, never append: the retry/idempotency contract.
  const cleared = await ctx.client
    .from("document_chunks")
    .delete()
    .eq("document_id", documentId);
  if (cleared.error) throw transient();

  const inserted = await ctx.client.from("document_chunks").insert(rows);
  if (inserted.error) throw transient();

  const provider = embeddingProviderStatus();
  let embedded = 0;
  if (provider.available) {
    const vectors = await embedTexts(rows.map((row) => row.content));
    const updates = rows.map((row, index) => ({
      ...row,
      embedding: vectors[index],
    }));
    const reembedded = await ctx.client
      .from("document_chunks")
      .delete()
      .eq("document_id", documentId);
    if (reembedded.error) throw transient();
    const stored = await ctx.client.from("document_chunks").insert(updates);
    if (stored.error) throw transient();
    embedded = updates.length;
  } else {
    ctx.log(`embeddings_skipped reason="${provider.reason}"`);
  }

  ctx.log(
    `rechunked document=${documentId} units=${source.length} chunks=${rows.length} embedded=${embedded}`,
  );
}
