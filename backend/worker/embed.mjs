/**
 * Tasks 25.3/25.6 — the embedding provider seam.
 *
 * The column and index exist (`extensions.vector(1536)`, HNSW cosine); the
 * provider client does not. Status, stated exactly:
 *
 *   [!] BLOCKED BY provider access: generating vectors requires an embedding
 *   provider and credential. This build has no provider client, and no vector
 *   is ever fabricated — `document_chunks.embedding` stays NULL and
 *   `search_document_chunks` runs its keyword branch only.
 *
 * The chosen model family is OpenAI `text-embedding-3-small` (1536 dims,
 * the 20.6 deferral resolved in the migration). When a provider lands, this
 * file grows `embedTexts` (batch, retry, per-model dimensions) and nothing
 * else changes: the reindex handler already calls `embedTexts` and already
 * knows how to store what it returns.
 */

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;

export const EMBEDDING_DEPENDENCY = `An embedding provider credential for ${EMBEDDING_MODEL} (e.g. OPENAI_API_KEY).`;

export class EmbeddingUnavailableError extends Error {
  constructor(reason) {
    super(reason);
    this.name = "EmbeddingUnavailableError";
  }
}

/**
 * Whether a provider could be used. Always false in this build: without a
 * key nothing can run, and with a key there is still no client to call —
 * returning true would promise vectors the code cannot produce.
 */
export function embeddingProviderStatus() {
  if (!process.env.OPENAI_API_KEY) {
    return {
      available: false,
      reason: `No embedding provider is configured. Required: ${EMBEDDING_DEPENDENCY}`,
    };
  }
  return {
    available: false,
    reason:
      "An OPENAI_API_KEY is present, but no embedding provider client is implemented in this build; no vectors are generated.",
  };
}

/** The one call a provider must implement. Throws until one exists. */
export async function embedTexts(_texts) {
  throw new EmbeddingUnavailableError(embeddingProviderStatus().reason);
}
