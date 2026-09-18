/**
 * Icon-element helpers (Task D4, spec §5.4 "Icons", §6.5, §7.4).
 *
 * Presenton's icon catalog is a vector store over SVG icon files served from
 * `/static/icons/<weight>/<name>[-<weight>].svg` (weights: bold, duotone, fill,
 * light, regular, thin — the engine's default is bold). An icon is an image
 * element with `is_icon: true` and an optional `color`; the fork recolours
 * through the engine's own SVG route, but the native path fetches the SVG
 * through the owner-gated asset proxy and rewrites `fill`/`stroke` client-side
 * (spec §6.5: "fetch the SVG through the asset proxy and recolor client-side").
 *
 * Everything here is pure, DOM-free and client-safe. The transform is a
 * conservative string rewrite mirroring the fork's `transformSvgMarkup`
 * (`presenton-ui/lib/svg-color.ts`), restricted to the one option the native
 * UI needs (`color`), plus a defensive sanitize: the result is only ever
 * rendered from a data URI in an `<img>`, where scripts cannot run, but the
 * markup is still stripped of script/event surfaces before it is re-served.
 */
import { isSafeAssetPath } from "./assets";
import type { IconType, ImageElement } from "./types";

/** The engine's `ALLOWED_ICON_WEIGHTS` (`utils/icon_weights.py`), in its order. */
export const ICON_WEIGHTS = [
  "bold",
  "duotone",
  "fill",
  "light",
  "regular",
  "thin",
] as const;

/** The engine's `DEFAULT_ICON_WEIGHT`; an unknown weight normalizes to it. */
export const DEFAULT_ICON_WEIGHT: IconType = "bold";

/** Every icon asset lives under this engine-public mount (spec §6.9). */
const ICON_ASSET_PREFIX = "/static/icons/";

/** The files the catalog serves (`_icon_filename_for_weight`). */
const ICON_FILE_PATTERN = /\.(?:svg|png)$/i;

/** True for each of the six wire weights. */
export function isIconWeight(value: unknown): value is IconType {
  return (
    typeof value === "string" &&
    (ICON_WEIGHTS as readonly string[]).includes(value)
  );
}

/**
 * The engine's `normalize_icon_weight`: trim, lowercase, `_` → `-`; anything
 * unrecognized reads as the default (`bold`), never as a guess.
 */
export function normalizeIconWeight(value: unknown): IconType {
  if (typeof value !== "string") return DEFAULT_ICON_WEIGHT;
  const normalized = value.trim().toLowerCase().replace(/_/g, "-");
  return isIconWeight(normalized) ? normalized : DEFAULT_ICON_WEIGHT;
}

/** The weight embedded in an icon path, or null when the path carries none. */
export function iconWeightFromPath(path: unknown): IconType | null {
  if (typeof path !== "string") return null;
  const match = /^\/static\/icons\/([^/]+)\//.exec(path);
  if (match === null) return null;
  const weight = match[1];
  return isIconWeight(weight) ? weight : null;
}

/**
 * Normalize one search result to an engine-relative icon path. The engine may
 * answer absolute URLs when its public base is configured (`absolute_fastapi_
 * asset_url`); the native proxy needs the path. Only `/static/icons/**` paths
 * ending in `.svg`/`.png` survive, and the shared asset guard rejects
 * traversal/encoding shapes before any caller can build a proxy request from
 * the value.
 */
export function normalizeIconPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (raw === "") return null;

  let path = raw;
  if (/^https?:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      return null;
    }
  } else if (path.startsWith("//")) {
    try {
      path = new URL(`https:${path}`).pathname;
    } catch {
      return null;
    }
  }

  if (!path.startsWith(ICON_ASSET_PREFIX) || !ICON_FILE_PATTERN.test(path)) {
    return null;
  }
  const weight = path.slice(ICON_ASSET_PREFIX.length).split("/", 1)[0] ?? "";
  if (!isIconWeight(weight)) return null;
  if (!isSafeAssetPath(path)) return null;
  return path;
}

/** Absolute/data sources that are not engine icon assets never get recolored. */
const PASSTHROUGH_SOURCE = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i;

/**
 * True for sources whose bytes are SVG text this module can rewrite: engine
 * `.svg` paths (with any query/fragment) and inline `data:image/svg+xml`
 * sources. Raster icons and external URLs read false and render as today.
 */
export function isSvgIconSource(source: unknown): boolean {
  if (typeof source !== "string") return false;
  const value = source.trim();
  if (value === "") return false;
  if (/^data:image\/svg\+xml/i.test(value)) return true;
  if (value.startsWith("data:")) return false;
  if (PASSTHROUGH_SOURCE.test(value)) {
    return /\.svg(?:[?#]|$)/i.test(value);
  }
  const path = value.split(/[?#]/, 1)[0] ?? "";
  return /\.svg$/i.test(path);
}

// ---------------------------------------------------------------------------
// SVG recolor (fork `transformSvgMarkup`, `color` option only)
// ---------------------------------------------------------------------------

const UNSAFE_SVG_VALUE_CHARS = /["'<>`{};\r\n]/;
const HEX_COLOR_PATTERN = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const BARE_HEX_COLOR_PATTERN = /^(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const CSS_COLOR_FUNCTION_PATTERN =
  /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|var|calc)\(.+\)$/i;
const SVG_KEYWORD_PATTERN = /^[a-z-]+$/i;

/**
 * The wire `color` as a value safe to place in SVG markup: `#rgb`/`#rrggbb[:aa]`,
 * a bare hex (the fork stores `FFFFFF`), a CSS color function or a keyword.
 * Anything carrying quotes/tags/semicolons — or an unknown shape — reads null,
 * and a null never reaches an attribute.
 */
export function normalizeIconColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "" || UNSAFE_SVG_VALUE_CHARS.test(trimmed)) return null;
  if (HEX_COLOR_PATTERN.test(trimmed)) return trimmed;
  if (BARE_HEX_COLOR_PATTERN.test(trimmed)) return `#${trimmed}`;
  if (CSS_COLOR_FUNCTION_PATTERN.test(trimmed)) return trimmed;
  if (SVG_KEYWORD_PATTERN.test(trimmed)) return trimmed;
  return null;
}

const PRESERVED_PAINT_VALUES = new Set([
  "none",
  "currentcolor",
  "context-fill",
  "context-stroke",
  "inherit",
  "transparent",
]);

/** Paint values a recolor must not overwrite (fork `shouldPreservePaintValue`). */
function shouldPreservePaintValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    PRESERVED_PAINT_VALUES.has(normalized) || normalized.startsWith("url(")
  );
}

/** As above, but an explicit color does replace `currentColor` (fork parity). */
function shouldPreservePaintValueForExplicitColor(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized !== "currentcolor" && shouldPreservePaintValue(value)
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replace one attribute across double-quoted, single-quoted and unquoted
 * forms, optionally keeping values the caller wants preserved.
 */
function replaceAttributeValue(
  input: string,
  attrName: string,
  nextValue: string,
  preserveValue?: (current: string) => boolean,
): string {
  const escaped = escapeRegExp(attrName);
  const patterns = [
    new RegExp(`(\\s${escaped}\\s*=\\s*")(.*?)(")`, "gi"),
    new RegExp(`(\\s${escaped}\\s*=\\s*')(.*?)(')`, "gi"),
    new RegExp(`(\\s${escaped}\\s*=\\s*)([^\\s"'=<>` + "`" + `]+)`, "gi"),
  ];

  return patterns.reduce(
    (output, pattern) =>
      output.replace(
        pattern,
        (match, prefix: string, current: string, suffix?: string) => {
          if (preserveValue?.(current)) return match;
          return suffix ? `${prefix}${nextValue}${suffix}` : `${prefix}${nextValue}`;
        },
      ),
    input,
  );
}

/** The same replacement inside `style="…"` declarations. */
function replaceStyleValue(
  input: string,
  attrName: string,
  nextValue: string,
  preserveValue?: (current: string) => boolean,
): string {
  const escaped = escapeRegExp(attrName);
  const pattern = new RegExp(
    `(${escaped}\\s*:\\s*)([^;"'}]+?)(\\s*)(?=;|}|["']|$)`,
    "gi",
  );
  return input.replace(
    pattern,
    (
      match,
      prefix: string,
      current: string,
      trailingWhitespace: string,
    ) => {
      if (preserveValue?.(current)) return match;
      return `${prefix}${nextValue}${trailingWhitespace}`;
    },
  );
}

function replaceSvgValue(
  input: string,
  attrName: string,
  nextValue: string,
  preserveValue?: (current: string) => boolean,
): string {
  return replaceStyleValue(
    replaceAttributeValue(input, attrName, nextValue, preserveValue),
    attrName,
    nextValue,
    preserveValue,
  );
}

const ROOT_SVG_TAG_PATTERN = /<svg\b([^>]*)>/i;

/** Set an attribute on the root `<svg>`, adding it when absent. */
function upsertRootAttribute(
  input: string,
  attrName: string,
  nextValue: string,
): string {
  return input.replace(ROOT_SVG_TAG_PATTERN, (match, attrs: string) => {
    const escaped = escapeRegExp(attrName);
    const patterns = [
      new RegExp(`(\\s${escaped}\\s*=\\s*")(.*?)(")`, "i"),
      new RegExp(`(\\s${escaped}\\s*=\\s*')(.*?)(')`, "i"),
      new RegExp(`(\\s${escaped}\\s*=\\s*)([^\\s"'=<>` + "`" + `]+)`, "i"),
    ];
    for (const pattern of patterns) {
      if (pattern.test(attrs)) {
        const updated = attrs.replace(
          pattern,
          (inner: string, prefix: string, _current: string, suffix?: string) =>
            suffix ? `${prefix}${nextValue}${suffix}` : `${prefix}${nextValue}`,
        );
        return `<svg${updated}>`;
      }
    }
    return `<svg${attrs} ${attrName}="${nextValue}">`;
  });
}

// ---------------------------------------------------------------------------
// SVG sanitize
// ---------------------------------------------------------------------------

const SCRIPT_BLOCK = /<script\b[\s\S]*?<\/script\s*>/gi;
const SELF_CLOSING_SCRIPT = /<script\b[^>]*\/\s*>/gi;
const FOREIGN_OBJECT_BLOCK = /<foreignObject\b[\s\S]*?<\/foreignObject\s*>/gi;
const EVENT_HANDLER_ATTR =
  /\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const JAVASCRIPT_URL_ATTR =
  /\s(?:href|xlink:href|src)\s*=\s*(?:"[^"]*javascript:[^"]*"|'[^']*javascript:[^']*'|[^\s>]*javascript:[^\s>]*)/gi;

/**
 * Strip the markup surfaces that could execute or embed: `<script>` blocks,
 * `<foreignObject>` subtrees, `on*` event attributes and `javascript:` URLs.
 * Deliberately conservative — it removes only those shapes and leaves the
 * drawing markup byte-for-byte.
 */
export function sanitizeSvgMarkup(svg: string): string {
  return svg
    .replace(SCRIPT_BLOCK, "")
    .replace(SELF_CLOSING_SCRIPT, "")
    .replace(FOREIGN_OBJECT_BLOCK, "")
    .replace(EVENT_HANDLER_ATTR, "")
    .replace(JAVASCRIPT_URL_ATTR, "");
}

/**
 * Recolour one SVG's markup to `color`: the root gets `color`/`fill`, and
 * every `fill`/`stroke` attribute and style declaration is replaced — except
 * `none`, `url(#…)`, `transparent`, `inherit` and the `context-*` paints,
 * which keep their meaning. `currentColor` values are replaced too (the same
 * visual result, since the root `color` is set). An unparseable color returns
 * the input untouched; callers that need a no-injection guarantee use
 * {@link recoloredIconDataUri}, which refuses invalid colors.
 */
export function recolorSvg(svg: string, color: unknown): string {
  const normalized = normalizeIconColor(color);
  if (typeof svg !== "string" || svg.trim() === "" || normalized === null) {
    return svg;
  }

  let output = sanitizeSvgMarkup(svg);
  output = replaceSvgValue(output, "color", normalized);
  output = upsertRootAttribute(output, "color", normalized);
  output = replaceSvgValue(
    output,
    "stroke",
    normalized,
    shouldPreservePaintValueForExplicitColor,
  );
  output = replaceSvgValue(
    output,
    "fill",
    normalized,
    shouldPreservePaintValueForExplicitColor,
  );
  return upsertRootAttribute(output, "fill", normalized);
}

/** One SVG as a UTF-8 data URI (every markup byte percent-encoded). */
export function svgDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * Sanitized, recolored SVG as a data URI, or null for an invalid color /
 * empty source. This is the only path the renderer serves recolored markup
 * through; the returned string is safe to place in an `<img src>`.
 */
export function recoloredIconDataUri(
  svg: string,
  color: unknown,
): string | null {
  if (typeof svg !== "string" || svg.trim() === "") return null;
  const normalized = normalizeIconColor(color);
  if (normalized === null) return null;
  return svgDataUri(recolorSvg(svg, normalized));
}

// ---------------------------------------------------------------------------
// Element operations (the editor's single-slide save path)
// ---------------------------------------------------------------------------

/**
 * Point an image element at a searched icon: `data` becomes the normalized
 * engine path and `is_icon` true, every style field (fit, crop, radius,
 * flips, opacity, color) stays. A non-icon path or an unchanged result returns
 * the same reference so autosave skips a no-op commit.
 */
export function applyIconSource(
  element: ImageElement,
  path: string,
): ImageElement {
  const next = normalizeIconPath(path);
  if (next === null) return element;
  if (next === element.data && element.is_icon === true) return element;
  return { ...element, data: next, is_icon: true };
}

/**
 * Write the icon's `color` (the renderer's recolor input). Empty and null
 * clear the field back to the wire's default; an invalid value is refused by
 * returning the element unchanged; a bare hex is stored canonicalized.
 */
export function applyIconColor(
  element: ImageElement,
  color: string | null,
): ImageElement {
  if (color === null || (typeof color === "string" && color.trim() === "")) {
    return element.color === null || element.color === undefined
      ? element
      : { ...element, color: null };
  }
  const normalized = normalizeIconColor(color);
  if (normalized === null || normalized === element.color) return element;
  return { ...element, color: normalized };
}
