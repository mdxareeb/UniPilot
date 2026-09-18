/**
 * The owner-gated asset proxy's pure policy (Task B2, spec §6.9).
 *
 * Three mounts may be proxied — `/app_data/`, `/static/` and `/vendor/` — and
 * every other module asks this one place what a requested `src` may reach:
 *
 * | requested path                              | verdict          | why |
 * | --- | --- | --- |
 * | not a `/`-rooted string, or carrying `..`, `\`, `//`, `%`, `?`, `#` | `unsafe` | traversal / host / encoding escape attempt; answer 400 |
 * | outside the three mounts                    | `unsafe`          | not an engine asset at all |
 * | `/app_data/fonts/**`                        | `allowed`         | engine-public (no user data) |
 * | `/app_data/templates/<deck template>/…`     | `allowed`         | engine-public, but only the deck's own template id |
 * | any other `/app_data/templates/…`           | `not-referenced`  | another template's assets are not this deck's |
 * | other `/app_data/**` (images, uploads, exports, pptx-to-*, mem0) | `allowed` only when the deck references the exact path | membership, not just a prefix |
 * | (all other `/app_data/**`)                  | `not-referenced`  | not referenced by this deck |
 * | `/static/**`, `/vendor/**`                  | `allowed`         | engine-public packaged resources |
 *
 * Pure by design — no fetch, no environment, no DOM — so the route and the
 * adapter share the exact guard and the policy is unit-testable directly.
 * `templateId` is the deck's template id as resolved by the caller from the
 * deck's slides (`layout_group`); the deck's own layout groups are re-checked
 * here as well, so a caller bug can only narrow access, never widen it, and a
 * deck with no slides never exposes template-static assets.
 */
import { collectAssetPaths } from "./elements";
import type { PresentationDeck } from "./types";

/** The three mounts the proxy may reach (spec §6.9). */
const ASSET_PREFIXES = ["/app_data/", "/static/", "/vendor/"] as const;

const TEMPLATE_PREFIX = "/app_data/templates/";
const FONTS_PREFIX = "/app_data/fonts/";

/** The proxy's verdict for one requested `src` (see the module table). */
export type AssetPathVerdict = "allowed" | "unsafe" | "not-referenced";

/** Extension → content type; everything else is an honest octet stream. */
const ASSET_CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  ttf: "font/ttf",
  otf: "font/otf",
  woff: "font/woff",
  woff2: "font/woff2",
};

/**
 * The guard both the classifier and the adapter enforce before any fetch:
 * a `/`-rooted, single-slash path under one of the three mounts whose segments
 * cannot traverse (`..`, `\`, `//`), carry percent-encoding of any kind, or
 * smuggle a query/fragment (`%`, `?`, `#`). Deck asset paths are stored
 * literally, so nothing legitimate under the three mounts needs an escaped
 * byte — and percent-encoding must be rejected at the source: `fetch()`
 * canonicalizes `%2e%2e` as dot segments, so an encoded traversal that passed
 * here would become an authenticated GET to an arbitrary engine path with the
 * shared bearer. This is the path counterpart to `assertSafeSegment`'s
 * posture for ids.
 */
export function isSafeAssetPath(src: unknown): src is string {
  if (typeof src !== "string" || src === "") return false;
  if (!src.startsWith("/")) return false;
  if (
    src.includes("..") ||
    src.includes("\\") ||
    src.includes("//") ||
    src.includes("%") ||
    src.includes("?") ||
    src.includes("#")
  ) {
    return false;
  }
  return ASSET_PREFIXES.some((prefix) => src.startsWith(prefix));
}

/** The content type to answer with, resolved from the path's extension only. */
export function assetContentType(path: string): string {
  const dot = path.lastIndexOf(".");
  const extension = dot >= 0 ? path.slice(dot + 1).toLowerCase() : "";
  return ASSET_CONTENT_TYPES[extension] ?? "application/octet-stream";
}

/** The distinct, non-empty `layout_group` values the deck's slides carry. */
function deckTemplateIds(deck: PresentationDeck): string[] {
  const ids = new Set<string>();
  for (const slide of Array.isArray(deck.slides) ? deck.slides : []) {
    const group = slide?.layout_group;
    if (typeof group === "string" && group.trim() !== "") ids.add(group);
  }
  return [...ids];
}

/**
 * Classify one requested `src` against the deck. `templateId` is the deck's
 * template id resolved by the caller (`deck.slides[0]?.layout_group ?? null`);
 * a null template id means the deck has no template, so no
 * `/app_data/templates/**` path can match.
 */
export function classifyAssetPath(
  src: unknown,
  deck: PresentationDeck,
  templateId: string | null,
): AssetPathVerdict {
  if (!isSafeAssetPath(src)) return "unsafe";

  if (src.startsWith(TEMPLATE_PREFIX)) {
    if (templateId === null) return "not-referenced";
    const segment = src.slice(TEMPLATE_PREFIX.length).split("/", 1)[0] ?? "";
    if (segment !== templateId) return "not-referenced";
    return deckTemplateIds(deck).includes(templateId) ? "allowed" : "not-referenced";
  }

  if (src.startsWith(FONTS_PREFIX)) return "allowed";

  if (src.startsWith("/app_data/")) {
    return collectAssetPaths(deck).includes(src) ? "allowed" : "not-referenced";
  }

  return "allowed";
}
