"use server";

/**
 * The search Server Action (Task 25.10): the global search panel's read path.
 * The gate runs first (a guest is prompted before any query), the query is
 * validated server-side, and only sanitized copy travels back.
 */
import { requireOnboardedUser } from "@/lib/onboarding/gate";
import { SEARCH_ERROR } from "./searchErrors";
import {
  SEARCH_QUERY_MAX_LENGTH,
  SEARCH_QUERY_MIN_LENGTH,
  searchDocumentChunks,
  semanticSearchStatus,
  type SearchHit,
  type SemanticSearchStatus,
} from "./search";

export type SearchActionResult = {
  error: string | null;
  hits: SearchHit[];
  semantic: SemanticSearchStatus;
};

export async function searchAction(query: unknown): Promise<SearchActionResult> {
  await requireOnboardedUser("/documents");

  const parsed = typeof query === "string" ? query.trim() : "";
  if (
    parsed.length < SEARCH_QUERY_MIN_LENGTH ||
    parsed.length > SEARCH_QUERY_MAX_LENGTH
  ) {
    return { error: null, hits: [], semantic: semanticSearchStatus() };
  }

  try {
    const hits = await searchDocumentChunks({ query: parsed });
    return { error: null, hits, semantic: semanticSearchStatus() };
  } catch {
    return { error: SEARCH_ERROR, hits: [], semantic: semanticSearchStatus() };
  }
}
