/**
 * The caller's image scope, server-side (Task D3 review fix).
 *
 * The engine's image store belongs to the API key's whole engine account, not
 * to a UniPilot user, so the only ownership proof UniPilot can build is
 * reference-based: an engine image is "the caller's" when one of the caller's
 * own stored decks references its path — the same membership rule the
 * owner-gated asset proxy enforces. This module assembles that union and the
 * short-lived insert permits minted by the caller's own upload/generate.
 *
 * **Mitigation, not isolation.** The permit and union caches are process-local
 * (`globalThis`) and the union is a snapshot with a short TTL, so this is a
 * single-owner-deployment mitigation; the real fix is per-owner engine
 * accounts (or an isolated image library). Recorded in the task report.
 *
 * Reads use the request-scoped cookie client (owner RLS), so a caller can only
 * ever see their own rows. A deck the engine cannot answer is skipped
 * conservatively — a failure never widens the scope.
 */
import { getPresentationDeck } from "@/lib/integrations/presenton";
import { collectAssetPaths } from "@/lib/presentation/elements";
import { isSafeAssetPath } from "@/lib/presentation/assets";
import type { ImageScope } from "@/lib/presentation/imageScope";
import { createClient } from "@/lib/supabase/server";

/**
 * How many of the caller's decks one union scan reads. Newest first: a recent
 * image is almost always referenced by a recent deck, and the bound keeps one
 * action's engine reads finite (they are also cached below).
 */
export const IMAGE_SCOPE_DECK_LIMIT = 50;

/** How long a computed union is reused for one user (process-local). */
export const IMAGE_SCOPE_CACHE_TTL_MS = 30_000;

/** How long an upload/generate permit lets its path be inserted. */
export const IMAGE_PERMIT_TTL_MS = 15 * 60_000;

/** The permit map's hard cap; oldest entries are evicted first. */
const IMAGE_PERMIT_LIMIT = 1_000;

type UnionCacheEntry = { expiresAt: number; paths: Set<string> };

/* `globalThis` rather than module locals: the upload route and the Server
   Actions can be separate production chunks, but the process is one. */
function globalMap<K, V>(key: string): Map<K, V> {
  const scope = globalThis as unknown as Record<string, unknown>;
  const existing = scope[key];
  if (existing instanceof Map) return existing as Map<K, V>;
  const store = new Map<K, V>();
  scope[key] = store;
  return store;
}

const SCOPE_CACHE_KEY = "__unipilotImageScopeCache";
const PERMIT_STORE_KEY = "__unipilotImageInsertPermits";

/** The referenced union over the caller's own decks, cached 30 s per user. */
export async function loadReferencedImagePaths(
  userId: string,
): Promise<Set<string>> {
  const cache = globalMap<string, UnionCacheEntry>(SCOPE_CACHE_KEY);
  const now = Date.now();
  const cached = cache.get(userId);
  if (cached !== undefined && cached.expiresAt > now) return cached.paths;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("presentations")
    .select("presenton_presentation_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(IMAGE_SCOPE_DECK_LIMIT);
  if (error) throw new Error("Failed to load the presentation image scope.");

  const paths = new Set<string>();
  const seen = new Set<string>();
  for (const row of data ?? []) {
    const engineDeckId = row.presenton_presentation_id;
    if (
      typeof engineDeckId !== "string" ||
      engineDeckId === "" ||
      seen.has(engineDeckId)
    ) {
      continue;
    }
    seen.add(engineDeckId);
    try {
      const deck = await getPresentationDeck(engineDeckId);
      for (const path of collectAssetPaths(deck)) paths.add(path);
    } catch {
      // Conservative: an unreadable deck grants nothing.
    }
  }

  cache.set(userId, { expiresAt: now + IMAGE_SCOPE_CACHE_TTL_MS, paths });
  return paths;
}

/** Mints a permit for one engine path this caller's own action just created. */
export function grantImageInsertPermit(userId: string, fileUrl: unknown): void {
  if (typeof fileUrl !== "string" || !isSafeAssetPath(fileUrl)) return;
  const store = globalMap<string, Map<string, number>>(PERMIT_STORE_KEY);
  let permits = store.get(userId);
  if (permits === undefined) {
    permits = new Map<string, number>();
    store.set(userId, permits);
  }
  const now = Date.now();
  permits.set(fileUrl, now + IMAGE_PERMIT_TTL_MS);
  if (permits.size > IMAGE_PERMIT_LIMIT) {
    for (const key of permits.keys()) {
      if (permits.size <= IMAGE_PERMIT_LIMIT) break;
      permits.delete(key);
    }
  }
}

/** The caller's unexpired permits (expired entries are pruned as met). */
export function permittedImagePaths(userId: string): Set<string> {
  const store = globalMap<string, Map<string, number>>(PERMIT_STORE_KEY);
  const permits = store.get(userId);
  const paths = new Set<string>();
  if (permits === undefined) return paths;
  const now = Date.now();
  for (const [fileUrl, expiresAt] of permits) {
    if (expiresAt <= now) {
      permits.delete(fileUrl);
      continue;
    }
    paths.add(fileUrl);
  }
  return paths;
}

/** The referenced union + fresh permits in one scope object. */
export async function imageScopeFor(userId: string): Promise<ImageScope> {
  const referenced = await loadReferencedImagePaths(userId);
  return { referenced, permitted: permittedImagePaths(userId) };
}
