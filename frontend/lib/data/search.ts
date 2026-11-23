/**
 * Task 25.x — the retrieval service.
 *
 * One read path: `searchDocumentChunks` calls the `search_document_chunks`
 * SQL function through the request-scoped session client, so the
 * chunk-parent RLS policies are the authority for every row (the function is
 * security invoker). The function fuses a full-text branch (25.7) with a
 * vector branch (25.6) when a query embedding is supplied; this build passes
 * `null` because no embedding provider exists (25.3 is `[!]` blocked), so
 * every search is keyword-only by construction — never a fabricated vector or
 * a fake semantic result.
 *
 * The query contract mirrors the SQL: hits carry the owning document's id and
 * name plus the chunk's page and index (25.9), a snippet with `[[`/`]]`
 * markers around the matched terms, and the match kind.
 */
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  RECENT_FALLBACK_LIMIT,
  SEARCH_LIMIT,
  SEARCH_QUERY_MAX_LENGTH,
  SEARCH_QUERY_MIN_LENGTH,
  isBroadSummaryQuery,
  type SearchHit,
  type SemanticSearchStatus,
} from "./searchValues";

export * from "./searchValues";

/**
 * 25.3/25.6 — the query-side provider seam. Always unavailable in this build:
 * without a key nothing can run, and with a key there is still no client that
 * could produce a vector (the worker's `embed.mjs` owns the same truth for
 * document chunks). When a provider lands, this reads the key, embeds the
 * query and passes it to the RPC — the SQL is already hybrid.
 */
export function semanticSearchStatus(): SemanticSearchStatus {
  if (!process.env.OPENAI_API_KEY) {
    return {
      available: false,
      reason:
        "Semantic search needs an embedding provider (text-embedding-3-small, 1536 dims). Keyword search is available now.",
    };
  }
  return {
    available: false,
    reason:
      "An embedding provider key is present, but no embedding client is implemented in this build; search stays keyword-only.",
  };
}

/** Raw RPC row (the generated Returns type; columns are non-null here). */
type SearchRow = {
  document_id: string;
  document_name: string;
  chunk_index: number;
  page: number | null;
  content: string;
  snippet: string;
  score: number;
  match_kind: string;
};

function toHit(row: SearchRow): SearchHit {
  const hit: SearchHit = {
    documentId: row.document_id,
    documentName: row.document_name,
    chunkIndex: row.chunk_index,
    content: row.content,
    snippet: row.snippet,
    score: row.score,
    matchKind:
      row.match_kind === "vector" ||
      row.match_kind === "hybrid" ||
      row.match_kind === "recent"
        ? row.match_kind
        : "keyword",
  };
  if (row.page !== null) hit.page = row.page;
  return hit;
}

type RecentRow = SearchRow;

/** One bounded recency read; RLS is the authority, exactly as for FTS. */
async function recentDocumentChunks(
  client: SupabaseClient<Database>,
  options: {
    documentId?: string;
    subjectId?: string;
  },
): Promise<SearchHit[]> {
  const { data, error } = await client.rpc("recent_document_chunks", {
    p_limit: RECENT_FALLBACK_LIMIT,
    p_document_id: options.documentId,
    p_subject_id: options.subjectId,
  });
  if (error) throw new Error("Failed to read recent documents.");
  return ((data ?? []) as RecentRow[]).map(toHit);
}

function dedupeHits(hits: readonly SearchHit[]): SearchHit[] {
  const seen = new Set<string>();
  const unique: SearchHit[] = [];
  for (const hit of hits) {
    const key = `${hit.documentId}:${hit.chunkIndex}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(hit);
  }
  return unique;
}

/**
 * 25.7/25.8/25.9 — keyword (and, when a provider exists, hybrid) search over
 * the caller's chunks.
 *
 * `subjectId`/`documentId` narrow both the FTS read and (when requested) the
 * recency fallback. The fallback is opt-in because global search must stay
 * literal: showing unrelated recent material for a no-match query would break
 * its honest "no matches" state. Ask AI passes `fallback: "recent"`, which
 * replaces a false empty context with up to 8 newest chunks (newest document
 * first, in reading order) whenever FTS returns nothing or the question is a
 * broad summary request. Fallback hits are labelled `matchKind: "recent"` so
 * no caller can present them as term matches.
 */
export async function searchDocumentChunks(options: {
  query: string;
  limit?: number;
  documentId?: string;
  subjectId?: string;
  page?: number;
  /** `"recent"` = Ask AI's bounded summary fallback; omitted = literal search. */
  fallback?: "recent";
  /**
   * The caller-scoped client. Web pages/actions omit it and use cookies; the
   * mobile Bearer route passes its own JWT-scoped client so the RPC runs as
   * `authenticated`, never as `anon`.
   */
  client?: SupabaseClient<Database>;
}): Promise<SearchHit[]> {
  const query = options.query.trim();
  if (
    query.length < SEARCH_QUERY_MIN_LENGTH ||
    query.length > SEARCH_QUERY_MAX_LENGTH
  ) {
    return [];
  }

  const limit = options.limit ?? SEARCH_LIMIT;
  const supabase = options.client ?? (await createClient());

  const { data, error } = await supabase.rpc("search_document_chunks", {
    p_query: query,
    p_limit: limit,
    // Omitted keys fall back to the SQL defaults (NULL = no filter).
    p_document_id: options.documentId,
    p_page: options.page,
    // 25.6 is blocked without a provider: no fabricated vectors, keyword-only.
    p_embedding: undefined,
    p_subject_id: options.subjectId,
  });

  if (error) throw new Error("Failed to search documents.");
  const hits = ((data ?? []) as SearchRow[]).map(toHit);

  if (options.fallback !== "recent") return hits;

  const broad = isBroadSummaryQuery(query);
  if (hits.length > 0 && !broad) return hits;

  const recent = await recentDocumentChunks(supabase, {
    documentId: options.documentId,
    subjectId: options.subjectId,
  });
  if (recent.length === 0) return hits;

  // A summary request leads with the newest material; a zero-hit lookup has
  // no FTS rows to preserve.
  return dedupeHits(
    broad ? [...recent, ...hits] : [...hits, ...recent],
  ).slice(0, limit);
}
