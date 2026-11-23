/**
 * The retrieval contract's client-safe half (Task 25.x): the query bounds and
 * the `SearchHit` vocabulary the search panel renders. Kept separate from
 * `search.ts` because that module owns the server client; a client component
 * importing it would pull `next/headers` into the browser bundle — the exact
 * boundary the build enforces.
 */

export const SEARCH_QUERY_MIN_LENGTH = 2;
export const SEARCH_QUERY_MAX_LENGTH = 200;
export const SEARCH_LIMIT = 10;

/** Ask AI's recency fallback is deliberately smaller than a normal search. */
export const RECENT_FALLBACK_LIMIT = 8;

export type SearchMatchKind = "keyword" | "vector" | "hybrid" | "recent";

/**
 * Broad summary questions ("summarise my latest notes") have no distinctive
 * terms for full-text search, so the recency fallback must run even when FTS
 * happens to match something generic. The heuristic is deliberately small and
 * literal: it only recognises the ways a student asks for an overview, and it
 * never upgrades an ordinary question into a summary request.
 */
const BROAD_SUMMARY_PATTERNS: readonly RegExp[] = [
  /\b(?:summari[sz]e|summary|overview|outline|recap|review|tl;?dr|gist)\b/i,
  /\bkey (?:points|ideas|takeaways|concepts)\b/i,
  /\bmain (?:points|ideas|takeaways|concepts)\b/i,
  /\b(?:latest|recent|newest)\s+(?:notes?|material|documents?|uploads?|files?|readings?)\b/i,
  /\b(?:notes?|material|documents?|uploads?|files?|readings?)\b.{0,24}\b(?:latest|recent|newest)\b/i,
  /\b(?:tell me about|what(?:'s| is) in)\s+(?:my|this|the)\s+(?:course|notes?|material|readings?|chapter|unit)\b/i,
];

/** True when the question asks for a broad overview rather than a lookup. */
export function isBroadSummaryQuery(query: string): boolean {
  const normalized = query.trim();
  if (normalized === "") return false;
  return BROAD_SUMMARY_PATTERNS.some((pattern) => pattern.test(normalized));
}

export type SearchHit = {
  documentId: string;
  documentName: string;
  chunkIndex: number;
  page?: number;
  content: string;
  /** Matched terms wrapped in `[[`…`]]`; the UI renders them from text. */
  snippet: string;
  score: number;
  matchKind: SearchMatchKind;
};

export type SemanticSearchStatus = {
  available: boolean;
  /** The exact dependency, so a blocked deployment states it honestly. */
  reason: string;
};
