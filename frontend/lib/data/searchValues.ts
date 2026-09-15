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

export type SearchMatchKind = "keyword" | "vector" | "hybrid";

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
