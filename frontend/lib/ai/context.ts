/**
 * Tasks 26.5/26.6 — context selection and the token budget.
 *
 * 25.x's search returns ranked chunks; this module turns them into the
 * provider's context under two documented guards:
 *
 * - at most `CONTEXT_MAX_CHUNKS` chunks (8) — breadth without a kitchen sink;
 * - at most `CONTEXT_TOKEN_BUDGET` tokens (2000), approximated at 4
 *   characters per token (the standard English rule of thumb) because a real
 *   tokenizer is provider-specific; the character cap is exact at 8000, and
 *   the last chunk is truncated at a word boundary rather than mid-word.
 *
 * Deduplication is by `(documentId, chunkIndex)`: search can return the same
 * chunk twice once the hybrid branch exists, and the budget must not pay for
 * it twice. Order is preserved (highest-ranked first) so truncation drops the
 * weakest tail, and every kept chunk keeps its document/page provenance for
 * 26.7's citations.
 *
 * Pure by design: the budget maths is a direct unit test.
 */
import type { SearchHit } from "@/lib/data/searchValues";
import type { AssistantContextChunk } from "./prompt";

export const CONTEXT_MAX_CHUNKS = 8;
export const CONTEXT_TOKEN_BUDGET = 2_000;
export const CHARS_PER_TOKEN_APPROX = 4;
export const CONTEXT_MAX_CHARS = CONTEXT_TOKEN_BUDGET * CHARS_PER_TOKEN_APPROX;

/** Truncate at a word boundary; never mid-word when a boundary exists. */
function truncateAtWord(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const slice = text.slice(0, limit);
  const boundary = slice.lastIndexOf(" ");
  return (boundary > limit * 0.6 ? slice.slice(0, boundary) : slice).trim();
}

export function selectContextChunks(
  hits: readonly SearchHit[],
  options: { maxChunks?: number; maxChars?: number } = {},
): AssistantContextChunk[] {
  const maxChunks = options.maxChunks ?? CONTEXT_MAX_CHUNKS;
  const maxChars = options.maxChars ?? CONTEXT_MAX_CHARS;

  const seen = new Set<string>();
  const selected: AssistantContextChunk[] = [];
  let usedChars = 0;

  for (const hit of hits) {
    if (selected.length >= maxChunks || usedChars >= maxChars) break;

    const key = `${hit.documentId}:${hit.chunkIndex}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const content = hit.content.trim();
    if (content === "") continue;

    const remaining = maxChars - usedChars;
    const chunk: AssistantContextChunk = {
      documentId: hit.documentId,
      documentName: hit.documentName,
      chunkIndex: hit.chunkIndex,
      content: truncateAtWord(content, remaining),
    };
    if (hit.page !== undefined) chunk.page = hit.page;
    if (chunk.content === "") break;

    selected.push(chunk);
    usedChars += chunk.content.length;
  }

  return selected;
}

export function contextUsage(
  chunks: readonly AssistantContextChunk[],
): { chars: number; approxTokens: number } {
  const chars = chunks.reduce((sum, chunk) => sum + chunk.content.length, 0);
  return { chars, approxTokens: Math.ceil(chars / CHARS_PER_TOKEN_APPROX) };
}
