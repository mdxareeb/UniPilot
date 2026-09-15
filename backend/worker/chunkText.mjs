/**
 * Task 25.1/25.2 — the chunking strategy (pure, deterministic).
 *
 * The 24.x pipeline stores one text unit per PDF page (or one for DOCX);
 * embedding models want windows of roughly a few hundred tokens. This module
 * turns one unit into embedding-sized chunks:
 *
 *   * target ~1200 characters (≈300 English tokens at ~4 chars/token);
 *   * 200-character overlap, so a sentence crossing a window edge is still
 *     fully present in one of its neighbours;
 *   * window ends prefer a paragraph break, then a sentence end, then a word
 *     boundary — the last 40% of a window is searched backwards for one, so
 *     chunks do not end mid-word when a boundary is available.
 *
 * Determinism is the point: the same text produces the same chunks on every
 * run, which is what makes `document.reindex` idempotent (replace, never
 * append). The exact numbers are recorded in DATABASE.md as the initial
 * strategy; changing them is a re-index run, not a schema change.
 */

export const CHUNK_TARGET_CHARS = 1_200;
export const CHUNK_OVERLAP_CHARS = 200;

/** The fraction of a window that may be given up to reach a boundary. */
const BOUNDARY_SEARCH_FRACTION = 0.6;

function findBoundary(source, start, end) {
  const earliest = Math.max(
    start + Math.ceil((end - start) * BOUNDARY_SEARCH_FRACTION),
    start + 1,
  );

  for (let index = end - 1; index >= earliest; index -= 1) {
    const char = source[index];
    if (char === "\n") return index + 1;
    if (
      (char === "." || char === "!" || char === "?") &&
      (index + 1 === source.length ||
        source[index + 1] === " " ||
        source[index + 1] === "\n")
    ) {
      return index + 1;
    }
  }

  const space = source.lastIndexOf(" ", end);
  return space > earliest ? space : end;
}

export function chunkText(
  text,
  { target = CHUNK_TARGET_CHARS, overlap = CHUNK_OVERLAP_CHARS } = {},
) {
  const source = typeof text === "string" ? text.trim() : "";
  if (source === "") return [];
  if (source.length <= target) return [source];

  const chunks = [];
  let start = 0;

  while (start < source.length) {
    let end = Math.min(start + target, source.length);
    if (end < source.length) {
      const boundary = findBoundary(source, start, end);
      if (boundary > start) end = boundary;
    }

    const piece = source.slice(start, end).trim();
    if (piece !== "") chunks.push(piece);

    if (end >= source.length) break;
    const next = end - overlap;
    start = next > start ? next : end;
  }

  return chunks;
}
