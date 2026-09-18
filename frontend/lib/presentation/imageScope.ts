/**
 * Image-library scoping rules (Task D3 review fix).
 *
 * The engine has one image store for its whole API-key account, and that
 * account is shared by every UniPilot deck, so "the engine listed it" cannot
 * mean "this caller owns it". These pure rules define what counts as the
 * caller's own image scope:
 *
 * - **external** — an absolute http(s) URL (a stock-provider result). It never
 *   touches the owner-gated asset proxy, so it is always insertable;
 * - **public** — an engine-public asset path (`/static/**`, `/vendor/**`,
 *   `/app_data/fonts/**`): packaged service resources that carry no user data
 *   and that the asset proxy serves with the traversal guard alone (spec §6.9).
 *   The icon catalog lives under `/static/icons/**`, so a searched icon is
 *   insertable before any deck references it;
 * - **referenced** — an engine mount path (`/app_data|/static|/vendor`) that
 *   appears in the union of the caller's own stored decks (exactly the
 *   membership rule the asset proxy uses), so the proxy can already serve it;
 * - **permitted** — an engine path this process just returned to the caller
 *   from its own upload route or generation action, before the slide save that
 *   will reference it lands;
 * - **denied** — anything else, including another account's engine path,
 *   traversal shapes and relative strings. Denial is the default.
 *
 * Pure and client-safe: the server helper in
 * `lib/data/presentationImageScope.ts` builds the scope, the Server Actions and
 * the picker ask these functions.
 */
import { isSafeAssetPath } from "./assets";

/** Absolute http(s) only — the provider URLs search/generate return. */
const EXTERNAL_HTTP_SOURCE = /^https?:\/\//i;

/** The engine mounts the proxy serves without a deck-membership check. */
const ENGINE_PUBLIC_PREFIXES = [
  "/static/",
  "/vendor/",
  "/app_data/fonts/",
] as const;

/** True for an absolute http(s) URL (never proxied, always insertable). */
export function isExternalImageSource(source: unknown): source is string {
  return (
    typeof source === "string" && EXTERNAL_HTTP_SOURCE.test(source.trim())
  );
}

/** True for a safe engine-public asset path (icons, vendored fonts, static). */
export function isEnginePublicImageSource(source: unknown): source is string {
  if (typeof source !== "string" || !isSafeAssetPath(source)) return false;
  return ENGINE_PUBLIC_PREFIXES.some((prefix) => source.startsWith(prefix));
}

/** The caller's own image paths: their decks' union and their fresh permits. */
export type ImageScope = {
  /** `collectAssetPaths` union over the caller's own stored decks. */
  referenced: ReadonlySet<string>;
  /** Engine paths this process just returned to this caller. */
  permitted: ReadonlySet<string>;
};

export type ImageSourceVerdict =
  | "external"
  | "public"
  | "referenced"
  | "permitted"
  | "denied";

/**
 * The insert rule, in one place: external http(s) URLs, engine-public asset
 * paths, engine paths in the caller's referenced union, or engine paths
 * covered by a fresh permit. Every other source — another account's engine
 * path included — is denied.
 */
export function classifyImageSource(
  source: unknown,
  scope: ImageScope,
): ImageSourceVerdict {
  if (typeof source !== "string") return "denied";
  const value = source.trim();
  if (value === "") return "denied";
  if (isExternalImageSource(value)) return "external";
  if (isEnginePublicImageSource(value)) return "public";
  if (!isSafeAssetPath(value)) return "denied";
  if (scope.referenced.has(value)) return "referenced";
  if (scope.permitted.has(value)) return "permitted";
  return "denied";
}

/** True unless the source is outside the caller's image scope. */
export function isImageInScope(source: unknown, scope: ImageScope): boolean {
  return classifyImageSource(source, scope) !== "denied";
}

/**
 * The library list filter: keep only rows the caller's own decks (or own
 * fresh permits) cover. Foreign engine images are hidden, never previewed and
 * never deletable.
 */
export function filterScopedImages<T extends { fileUrl: string }>(
  images: readonly T[],
  scope: ImageScope,
): T[] {
  return images.filter((image) => isImageInScope(image.fileUrl, scope));
}
