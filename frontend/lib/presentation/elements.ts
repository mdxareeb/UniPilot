/**
 * Pure helpers over the deck/template wire JSON (Tasks B1 and B3).
 *
 * No fetch, no DOM, no environment: these functions are the shared vocabulary
 * between the owner-gated asset proxy (B2, which asks `collectAssetPaths`
 * whether a deck references a path) and the stage renderer (B3/B5, which asks
 * `elementBox` where an element sits and `infographicRenderer` whether a type
 * renders natively). The deck's `ui` is unvalidated service JSON, so every
 * helper defaults on absent geometry instead of throwing.
 *
 * B3's geometry is calibrated against the fork's reference converter
 * (`presenton-ui/lib/template-v2-json-to-html.ts`): `elementBox` mirrors
 * `readBox`, `vectorGeometry` mirrors `polygonPoints`/`polygonBox` (including
 * the stroke-width floor), `flexFrameSize` mirrors `flexExpandedSize`, the
 * grid templates mirror `gridColumnTemplate`/`gridRowTemplate`, and the font
 * helpers mirror the deck-font-map handling in `local-fonts.ts`. The evidence
 * table lives in the B3 report.
 */
import type { ChartConfiguration } from "chart.js";
import type {
  ChartElement,
  ChartType,
  DataLabelPosition,
  DeckTheme,
  DeckThemeColors,
  DeckThemePackage,
  FlexElement,
  Font,
  GridElement,
  InfographicElement,
  PresentationDeck,
  PresentationTemplate,
  SlideComponent,
  SlideElement,
  TableCell,
  VectorElement,
  VectorShape,
} from "./types";

/** The three mounts the native asset proxy may fetch through (spec §6.9). */
const ASSET_PREFIXES = ["/app_data/", "/static/", "/vendor/"] as const;

/** Canvas-space frame of one element inside its component (1280×720 stage). */
export type ElementFrame = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Infographic types Phase B renders natively (spec §6.7). */
export type InfographicRenderer = "gauge" | "progress_bar" | "vertical_funnel";

function isAssetPath(value: string): boolean {
  return ASSET_PREFIXES.some((prefix) => value.startsWith(prefix));
}

function collectAssetStrings(
  value: unknown,
  paths: string[],
  seen: Set<string>,
): void {
  if (typeof value === "string") {
    if (isAssetPath(value) && !seen.has(value)) {
      seen.add(value);
      paths.push(value);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectAssetStrings(item, paths, seen);
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) {
      collectAssetStrings(child, paths, seen);
    }
  }
}

/**
 * Every engine asset path the deck references, de-duplicated and in first-seen
 * order. The whole deck JSON is walked — `ui`, `content`, `html_content`,
 * `theme` and `fonts` are the fields that carry paths; other strings simply
 * never match a mount prefix.
 */
export function collectAssetPaths(deck: PresentationDeck): string[] {
  const paths: string[] = [];
  collectAssetStrings(deck, paths, new Set<string>());
  return paths;
}

/** The same scan for a template JSON (thumbnail, layouts, merged, fonts). */
export function collectTemplateAssetPaths(
  template: PresentationTemplate,
): string[] {
  const paths: string[] = [];
  collectAssetStrings(template, paths, new Set<string>());
  return paths;
}

/**
 * The element's stage frame: the component origin offsets the whole component,
 * the element's own position is relative to it, and width/height come from the
 * element's explicit `size` (vectors carry only `points`). Absent geometry
 * reads as zero — an honest placeholder rather than a guess.
 */
export function elementFrame(
  element: SlideElement,
  component: SlideComponent,
): ElementFrame {
  return {
    x: (component.position?.x ?? 0) + (element.position?.x ?? 0),
    y: (component.position?.y ?? 0) + (element.position?.y ?? 0),
    width: element.size?.width ?? 0,
    height: element.size?.height ?? 0,
  };
}

/**
 * A run-shaped value: an object with a string `text` field. Used to split
 * styled runs from plain strings safely — LaTeX runs carry `latex`, not
 * `text`, and are therefore not text runs (spec §6.4).
 */
export function isTextRun(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { text?: unknown }).text === "string"
  );
}

/**
 * The native renderer for an infographic `data.type`, or `null` for the
 * honest "Infographic type not yet rendered" placeholder (spec §6.7).
 */
export function infographicRenderer(type: string): InfographicRenderer | null {
  return type === "gauge" || type === "progress_bar" || type === "vertical_funnel"
    ? type
    : null;
}

// ---------------------------------------------------------------------------
// B3 — theme resolution
// ---------------------------------------------------------------------------

function isDeckTheme(value: unknown): value is DeckTheme {
  if (typeof value !== "object" || value === null) return false;
  const record = value as { colors?: unknown; fonts?: unknown };
  return (
    typeof record.colors === "object" &&
    record.colors !== null &&
    typeof record.fonts === "object" &&
    record.fonts !== null
  );
}

/**
 * The resolved theme behind either wire shape (B1 review): templates carry a
 * flat `DeckTheme`, generated decks store the `{data: DeckTheme}` package, and
 * absent or malformed values read as `null` rather than throwing. The stage
 * applies the result as CSS variables and a default text font (spec §6.8).
 */
export function resolveDeckTheme(
  theme: DeckTheme | DeckThemePackage | null | undefined,
): DeckTheme | null {
  if (theme === null || theme === undefined) return null;
  if (isDeckTheme(theme)) return theme;
  const data = (theme as DeckThemePackage).data;
  return isDeckTheme(data) ? data : null;
}

// ---------------------------------------------------------------------------
// B3 — box math (fork `readBox` / `childrenBounds` / `flexExpandedSize`)
// ---------------------------------------------------------------------------

/** Stage-local box of an element; `width`/`height` absent means auto. */
export type ElementBox = { x: number; y: number; width?: number; height?: number };

export type VectorPoint = { x: number; y: number };

/** Everything `VectorElement` needs to draw: sampled points plus their box. */
export type VectorGeometry = {
  shape: VectorShape;
  closed: boolean;
  points: VectorPoint[];
  box: ElementFrame;
};

/** The fork's `readNumber`: finite numbers and numeric strings only. */
function readOptionalNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** The fork's `polygonSourcePoints`: only finite x/y pairs survive. */
function vectorSourcePoints(element: VectorElement): VectorPoint[] {
  const raw = Array.isArray(element.points) ? element.points : [];
  const points: VectorPoint[] = [];
  for (const point of raw) {
    const x = readOptionalNumber(point?.x);
    const y = readOptionalNumber(point?.y);
    if (x !== null && y !== null) points.push({ x, y });
  }
  return points;
}

function vectorShapeOf(element: VectorElement): VectorShape {
  return element.shape === "ellipse" ? "ellipse" : "polygon";
}

function vectorClosed(element: VectorElement, points: VectorPoint[]): boolean {
  const value: unknown = element.closed;
  if (value === false || value === "false" || value === "0") return false;
  if (value === true || value === "true" || value === "1") return true;
  return points.length > 2;
}

function vectorCornerRadii(element: VectorElement, pointCount: number): number[] {
  const raw = Array.isArray(element.corner_radii) ? element.corner_radii : [];
  return raw
    .map((value) => readOptionalNumber(value))
    .filter((value): value is number => value !== null)
    .slice(0, pointCount)
    .map((value) => Math.max(0, value));
}

/** The fork's `roundedPolygonPoints` (quadratic corners, 8 segments each). */
function roundedPolygonPoints(
  points: VectorPoint[],
  radii: number[],
  segments = 8,
): VectorPoint[] {
  if (points.length < 3 || radii.length === 0) return points;
  const pointAt = (index: number) =>
    points[((index % points.length) + points.length) % points.length];
  const lerp = (start: VectorPoint, end: VectorPoint, t: number): VectorPoint => ({
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
  });
  const rounded: VectorPoint[] = [];
  points.forEach((point, index) => {
    const radius = radii[index] ?? 0;
    const previous = pointAt(index - 1);
    const next = pointAt(index + 1);
    const prevDistance = Math.hypot(point.x - previous.x, point.y - previous.y);
    const nextDistance = Math.hypot(point.x - next.x, point.y - next.y);
    const safeRadius = Math.min(radius, prevDistance / 2, nextDistance / 2);
    if (safeRadius <= 0 || prevDistance === 0 || nextDistance === 0) {
      rounded.push(point);
      return;
    }
    const from = lerp(point, previous, safeRadius / prevDistance);
    const to = lerp(point, next, safeRadius / nextDistance);
    rounded.push(from);
    for (let step = 1; step < segments; step += 1) {
      const t = step / segments;
      rounded.push({
        x: (1 - t) * (1 - t) * from.x + 2 * (1 - t) * t * point.x + t * t * to.x,
        y: (1 - t) * (1 - t) * from.y + 2 * (1 - t) * t * point.y + t * t * to.y,
      });
    }
    rounded.push(to);
  });
  return rounded;
}

function curveSettings(
  element: VectorElement,
): { tension: number; segments: number } | null {
  const curve = element.curve;
  if (!curve || curve.type !== "smooth") return null;
  return {
    tension: clamp(readOptionalNumber(curve.tension) ?? 0.4, 0, 1),
    segments: Math.max(
      1,
      Math.min(96, Math.round(readOptionalNumber(curve.segments) ?? 16)),
    ),
  };
}

/** The fork's `sampleSmoothCurve` (Hermite sampling of the control polygon). */
function sampleSmoothCurve(
  points: VectorPoint[],
  closed: boolean,
  tension: number,
  segments: number,
): VectorPoint[] {
  if (points.length < 3 || tension <= 0) return points;
  const pointAt = (index: number) =>
    points[((index % points.length) + points.length) % points.length];
  const sampled: VectorPoint[] = [];
  const segmentCount = closed ? points.length : points.length - 1;
  const hermite = (
    start: VectorPoint,
    end: VectorPoint,
    startTangent: VectorPoint,
    endTangent: VectorPoint,
    t: number,
  ): VectorPoint => {
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    return {
      x:
        h00 * start.x + h10 * startTangent.x + h01 * end.x + h11 * endTangent.x,
      y:
        h00 * start.y + h10 * startTangent.y + h01 * end.y + h11 * endTangent.y,
    };
  };
  for (let index = 0; index < segmentCount; index += 1) {
    const p0 = closed ? pointAt(index - 1) : points[Math.max(0, index - 1)];
    const p1 = pointAt(index);
    const p2 = pointAt(index + 1);
    const p3 = closed
      ? pointAt(index + 2)
      : points[Math.min(points.length - 1, index + 2)];
    if (index === 0) sampled.push(p1);
    const tangentScale = tension * 0.5;
    const startTangent = {
      x: (p2.x - p0.x) * tangentScale,
      y: (p2.y - p0.y) * tangentScale,
    };
    const endTangent = {
      x: (p3.x - p1.x) * tangentScale,
      y: (p3.y - p1.y) * tangentScale,
    };
    for (let step = 1; step <= segments; step += 1) {
      sampled.push(hermite(p1, p2, startTangent, endTangent, step / segments));
    }
  }
  return sampled;
}

/** The fork's `polygonPoints`: corner rounding, then smooth-curve sampling. */
function vectorPolylinePoints(element: VectorElement): VectorPoint[] {
  const points = vectorSourcePoints(element);
  if (vectorShapeOf(element) === "ellipse") return points;
  const closed = vectorClosed(element, points);
  const rounded = closed
    ? roundedPolygonPoints(points, vectorCornerRadii(element, points.length))
    : points;
  const curve = curveSettings(element);
  return curve
    ? sampleSmoothCurve(rounded, closed, curve.tension, curve.segments)
    : rounded;
}

/** The fork's `polygonBox`: point extremes, floored at the stroke width. */
function vectorBoxFromPoints(
  element: VectorElement,
  points: VectorPoint[],
): ElementFrame {
  if (points.length === 0) return { x: 0, y: 0, width: 1, height: 1 };
  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxX = Math.max(...points.map((point) => point.x));
  const maxY = Math.max(...points.map((point) => point.y));
  const strokeWidth = Math.max(1, readOptionalNumber(element.stroke?.width) ?? 1);
  return {
    x: minX,
    y: minY,
    width: Math.max(maxX - minX, strokeWidth, 1),
    height: Math.max(maxY - minY, strokeWidth, 1),
  };
}

/**
 * A vector's drawable geometry: the sampled polyline/ellipse source points and
 * the frame derived from them. Vectors ignore `position`/`size` on the wire —
 * the frame *is* the points' bounds (fork `readBox`), so coordinates stay in
 * the component's local space.
 */
export function vectorGeometry(element: VectorElement): VectorGeometry {
  const shape = vectorShapeOf(element);
  if (shape === "ellipse") {
    const points = vectorSourcePoints(element);
    return {
      shape,
      closed: true,
      points,
      box: vectorBoxFromPoints(element, points),
    };
  }
  const points = vectorPolylinePoints(element);
  return {
    shape,
    closed: vectorClosed(element, points),
    points,
    box: vectorBoxFromPoints(element, points),
  };
}

/** The fork's `readBox` without fallbacks: position, size, vector points. */
function rawBox(element: SlideElement): ElementBox {
  if (element.type === "vector") return vectorGeometry(element).box;
  return {
    x: readOptionalNumber(element.position?.x) ?? 0,
    y: readOptionalNumber(element.position?.y) ?? 0,
    width: readOptionalNumber(element.size?.width) ?? undefined,
    height: readOptionalNumber(element.size?.height) ?? undefined,
  };
}

/**
 * The fork's `childrenBounds`: the right/bottom edge of every child, starting
 * at 1×1, measured with each child's own raw box (no nested-group recursion,
 * exactly like `readBox(child)` in the reference).
 */
export function childrenBounds(children: SlideElement[]): {
  width: number;
  height: number;
} {
  const list = Array.isArray(children) ? children : [];
  let width = 1;
  let height = 1;
  for (const child of list) {
    const box = rawBox(child);
    width = Math.max(width, box.x + (box.width ?? 1));
    height = Math.max(height, box.y + (box.height ?? 1));
  }
  return { width, height };
}

/**
 * The element's component-local box. Groups without an explicit size fall back
 * to their children's bounds (fork `renderGroup`); every other type keeps the
 * fork's `readBox` semantics — absent `size` means auto, never a guess.
 */
export function elementBox(element: SlideElement): ElementBox {
  const box = rawBox(element);
  if (element.type === "group") {
    const bounds = childrenBounds(element.children);
    return {
      ...box,
      width: box.width ?? bounds.width,
      height: box.height ?? bounds.height,
    };
  }
  return box;
}

/**
 * A component's stage frame: its `position` offsets the whole component and
 * the frame grows to the elements' right/bottom edges (fork renders components
 * as groups and ignores their declared size).
 */
export function componentFrame(component: SlideComponent): ElementBox {
  const bounds = childrenBounds(
    Array.isArray(component.elements) ? component.elements : [],
  );
  return {
    x: readOptionalNumber(component.position?.x) ?? 0,
    y: readOptionalNumber(component.position?.y) ?? 0,
    width: bounds.width,
    height: bounds.height,
  };
}

/** The fork's `flowChildSize`: a child's size in a flex/grid layout, floored at 1. */
export function flowChildSize(element: SlideElement): {
  width: number;
  height: number;
} {
  const base = rawBox(element);
  const box =
    element.type === "group" ||
    element.type === "flex" ||
    element.type === "grid"
      ? (() => {
          const bounds = childrenBounds(
            Array.isArray(element.children) ? element.children : [],
          );
          return {
            ...base,
            width: base.width ?? bounds.width,
            height: base.height ?? bounds.height,
          };
        })()
      : base;
  return { width: box.width ?? 1, height: box.height ?? 1 };
}

function layoutGaps(element: FlexElement | GridElement): {
  gap: number;
  rowGap: number;
  columnGap: number;
} {
  const gap = readOptionalNumber(element.gap) ?? 0;
  return {
    gap,
    rowGap: readOptionalNumber(element.row_gap) ?? gap,
    columnGap: readOptionalNumber(element.column_gap) ?? gap,
  };
}

/** The fork's `flexExpandedSize`, minus the padding the engine model lacks. */
function flexContentSize(element: FlexElement): {
  width?: number;
  height?: number;
} {
  const children = Array.isArray(element.children) ? element.children : [];
  if (children.length === 0) return {};
  const direction = element.direction === "row" ? "row" : "column";
  const wrap = element.wrap === true;
  const { rowGap, columnGap } = layoutGaps(element);
  const sizes = children.map(flowChildSize);

  if (!wrap) {
    if (direction === "row") {
      return {
        width:
          sizes.reduce((sum, size) => sum + size.width, 0) +
          columnGap * Math.max(0, sizes.length - 1),
      };
    }
    return {
      height:
        sizes.reduce((sum, size) => sum + size.height, 0) +
        rowGap * Math.max(0, sizes.length - 1),
    };
  }

  const box = rawBox(element);
  const mainLimit =
    direction === "row"
      ? box.width == null
        ? null
        : Math.max(1, box.width)
      : box.height == null
        ? null
        : Math.max(1, box.height);
  if (mainLimit === null) return {};

  const lines: Array<{ main: number; cross: number }> = [];
  const mainGap = direction === "row" ? columnGap : rowGap;
  const crossGap = direction === "row" ? rowGap : columnGap;
  for (const size of sizes) {
    const childMain = direction === "row" ? size.width : size.height;
    const childCross = direction === "row" ? size.height : size.width;
    let line = lines[lines.length - 1];
    if (!line || (line.main > 0 && line.main + mainGap + childMain > mainLimit)) {
      line = { main: 0, cross: 0 };
      lines.push(line);
    }
    line.main += (line.main > 0 ? mainGap : 0) + childMain;
    line.cross = Math.max(line.cross, childCross);
  }
  const requiredCross =
    lines.reduce((sum, line) => sum + line.cross, 0) +
    crossGap * Math.max(0, lines.length - 1);
  return direction === "row" ? { height: requiredCross } : { width: requiredCross };
}

/**
 * A flex frame's final width/height: the declared size, grown to the content
 * only when the content is larger (fork `flexFrameStyle`).
 */
export function flexFrameSize(element: FlexElement): {
  width?: number;
  height?: number;
} {
  const box = rawBox(element);
  const expanded = flexContentSize(element);
  let width = box.width;
  let height = box.height;
  if (expanded.width != null && (width == null || expanded.width > width)) {
    width = expanded.width;
  }
  if (expanded.height != null && (height == null || expanded.height > height)) {
    height = expanded.height;
  }
  return { width, height };
}

/** The fork's `gridColumnTemplate`: fixed columns only with an explicit width. */
export function gridColumnTemplate(element: GridElement): string {
  const columns = Math.max(1, Math.floor(readOptionalNumber(element.columns) ?? 1));
  const { columnGap } = layoutGaps(element);
  const width = readOptionalNumber(element.size?.width);
  if (width == null) return `repeat(${columns},minmax(0,1fr))`;
  const columnWidth = Math.max(1, (width - columnGap * (columns - 1)) / columns);
  return `repeat(${columns},${columnWidth}px)`;
}

/**
 * The fork's `gridRowTemplate`: `null` until the wire declares rows, at least
 * as many tracks as the children render into, fixed heights with a height.
 */
export function gridRowTemplate(element: GridElement): string | null {
  const declaredRows = readOptionalNumber(element.rows);
  if (declaredRows === null) return null;
  const rows = Math.max(1, Math.floor(declaredRows));
  const columns = Math.max(1, Math.floor(readOptionalNumber(element.columns) ?? 1));
  const children = Array.isArray(element.children) ? element.children : [];
  const renderedRows = Math.max(1, Math.ceil(children.length / columns));
  const total = Math.max(rows, renderedRows);
  const { rowGap } = layoutGaps(element);
  const height = readOptionalNumber(element.size?.height);
  if (height == null) return `repeat(${total},minmax(0,1fr))`;
  const rowHeight = Math.max(1, (height - rowGap * (rows - 1)) / rows);
  return `repeat(${total},${rowHeight}px)`;
}

// ---------------------------------------------------------------------------
// B3 — table cell font precedence (fork `tableCellFont`/`cellText`)
// ---------------------------------------------------------------------------

/** The first run's font, if the cell's first run carries one. */
function firstRunFont(cell: TableCell | null | undefined): Font | null {
  const runs = Array.isArray(cell?.runs) ? cell.runs : [];
  const first: unknown = runs[0];
  if (typeof first !== "object" || first === null) return null;
  const font = (first as { font?: unknown }).font;
  return typeof font === "object" && font !== null ? (font as Font) : null;
}

/**
 * The font every table run merges its own font over: table base ← cell font ←
 * the header-bold patch. The cell's *first run's* font is deliberately
 * excluded — the fork merges per run (`{...tableFont, ...cell.font,
 * ...run.font}`), so a styled first run must not bleed into its siblings.
 * The header patch only appears when neither the cell nor the first run
 * declares `bold` (an explicit value, even `false`, wins).
 */
export function tableCellBaseFont(
  tableFont: Font,
  cell: TableCell | null | undefined,
  header: boolean,
): Font {
  const base: Font = { ...tableFont, ...(cell?.font ?? {}) };
  const hasExplicitBold =
    cell?.font?.bold != null || firstRunFont(cell)?.bold != null;
  return header && !hasExplicitBold ? { ...base, bold: true } : base;
}

/**
 * The cell div's own frame font (the fork's `tableCellFont`): the base plus
 * the first run's font, so an un-run-styled cell frame still reads the run's
 * color/size while later runs merge over `tableCellBaseFont` instead.
 */
export function tableCellFrameFont(
  baseFont: Font,
  cell: TableCell | null | undefined,
): Font {
  return { ...baseFont, ...(firstRunFont(cell) ?? {}) };
}

/** One run's effective font: its own declarations over the block/cell base. */
export function mergeRunFont(
  base: Font | null | undefined,
  run: Font | null | undefined,
): Font {
  return { ...(base ?? {}), ...(run ?? {}) };
}

// ---------------------------------------------------------------------------
// B3 — asset URLs and deck fonts
// ---------------------------------------------------------------------------

/** Absolute (`https://…`, `//…`) or `data:` sources never touch the proxy. */
const PASSTHROUGH_SOURCE = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i;

/**
 * The browser URL for one element/font source. Engine mounts go through the
 * owner-gated asset proxy (B2, spec §6.9); absolute, protocol-relative and
 * `data:` sources pass through; anything else is unresolvable — the caller
 * renders nothing rather than a broken URL.
 */
export function deckAssetUrl(id: string, src: string): string | null {
  const source = typeof src === "string" ? src.trim() : "";
  if (!source) return null;
  if (PASSTHROUGH_SOURCE.test(source) || source.startsWith("data:")) {
    return source;
  }
  if (
    source.startsWith("/app_data/") ||
    source.startsWith("/static/") ||
    source.startsWith("/vendor/")
  ) {
    return `/api/presentation/${encodeURIComponent(id)}/asset?src=${encodeURIComponent(source)}`;
  }
  return null;
}

/** A deck-font URL is either a stylesheet (`<link>`) or a font file (`@font-face`). */
export type DeckFontKind = "stylesheet" | "file";

export type DeckFontEntry = {
  /** The `deck.fonts` map key, how runs/theme name the family. */
  family: string;
  url: string;
  kind: DeckFontKind;
  /** The family name to use inside the stage (namespaced for file fonts). */
  cssFamily: string;
};

const GOOGLE_FONTS_HOST = /^https?:\/\/fonts\.googleapis\.com\//i;
const STYLESHEET_PATH = /\/(?:css|css2)$/i;

/**
 * Stylesheet URLs are deck content loaded with `<link>` and are never proxied;
 * everything else (engine-relative files, absolute font-file URLs) becomes an
 * `@font-face` source. Engine-relative files go through the asset proxy.
 */
export function deckFontKind(url: string): DeckFontKind {
  const value = typeof url === "string" ? url.trim() : "";
  if (!value) return "file";
  if (GOOGLE_FONTS_HOST.test(value)) return "stylesheet";
  const withoutFragment = value.split("#", 1)[0];
  const path = withoutFragment.split("?", 1)[0];
  return /^https?:\/\//i.test(value) &&
    (STYLESHEET_PATH.test(path) || /\.css$/i.test(path))
    ? "stylesheet"
    : "file";
}

function fontFamilySlug(family: string): string {
  const slug = family
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "font";
}

/**
 * The deck's `{family: url}` map as an ordered entry list. File families get a
 * stage-scoped, namespaced family name (`updeck-<index>-<slug>`) so they can
 * never collide with UniPilot chrome fonts (spec §6.5, §8.4); stylesheet
 * families keep their declared name. Entries with an empty family or URL are
 * skipped rather than rendered broken.
 */
export function deckFontEntries(
  fonts: Record<string, string> | null | undefined,
): DeckFontEntry[] {
  const entries: DeckFontEntry[] = [];
  if (typeof fonts !== "object" || fonts === null) return entries;
  for (const [key, value] of Object.entries(fonts)) {
    const family = typeof key === "string" ? key.trim() : "";
    const url = typeof value === "string" ? value.trim() : "";
    if (!family || !url) continue;
    const kind = deckFontKind(url);
    entries.push({
      family,
      url,
      kind,
      cssFamily:
        kind === "file" ? `updeck-${entries.length}-${fontFamilySlug(family)}` : family,
    });
  }
  return entries;
}

function fontFamilyKey(family: string): string {
  return family
    .trim()
    .replace(/^(['"])(.*)\1$/, "$2")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/** The fork's `fontFamilyAliases`: strip one trailing weight/style token. */
function fontFamilyAlias(family: string): string | null {
  const trimmed = family.trim();
  const stripped = trimmed
    .replace(
      /\s+(?:thin|extra[-_ ]?light|light|regular|medium|semi[-_ ]?bold|semibold|bold|extra[-_ ]?bold|black)(?:\s+italic)?$/i,
      "",
    )
    .replace(/\s+italic$/i, "")
    .trim();
  return stripped !== "" && stripped !== trimmed ? stripped : null;
}

/**
 * The family name a run/theme font must use inside the stage: exact map hit
 * first, then one alias step (`"Tinos Bold"` → `"Tinos"`), mirroring the
 * fork's catalog aliasing. Unmapped names stay as written so the stylesheet
 * families and system fallbacks still resolve; absent names read as `null`.
 */
export function resolveDeckFontFamily(
  family: string | null | undefined,
  entries: DeckFontEntry[],
): string | null {
  const name = typeof family === "string" ? family.trim() : "";
  if (!name) return null;
  const byKey = new Map(entries.map((entry) => [fontFamilyKey(entry.family), entry]));
  const exact = byKey.get(fontFamilyKey(name));
  if (exact) return exact.cssFamily;
  const alias = fontFamilyAlias(name);
  if (alias) {
    const base = byKey.get(fontFamilyKey(alias));
    if (base) return base.cssFamily;
  }
  return name;
}

// ---------------------------------------------------------------------------
// B5 — Chart.js configuration (spec §6.6)
//
// The wire chart model (`ChartElement`, verified against the served verdant
// template on 2026-09-16) mapped onto a plain Chart.js configuration object.
// This module stays runtime-pure: `ChartConfiguration` is a type-only import,
// nothing here touches the DOM or Chart.js itself — `ChartElement.tsx` owns
// the canvas lifecycle. The mapping mirrors the fork's `chartConfig`
// (`presenton-ui/lib/template-v2-json-to-html.ts`): same defaults, same
// dataset styling, same axis/legend/datalabel semantics. Chart.js animations
// stay off (`animation: false`): deck charts are content rendering, not
// UniPilot UI motion, and must not fight the shared Motion system.
// ---------------------------------------------------------------------------

/** The fork's `DEFAULT_CHART_COLORS`, used only when neither the element nor
 * the deck theme carries a palette. Exported so the editor's palette slots seed
 * from the exact same fallback the renderer uses (`chartOps.ts`). */
export const DEFAULT_CHART_COLORS = [
  "#7F22FE",
  "#155DFC",
  "#F59E0B",
  "#12B76A",
  "#EF4444",
  "#06B6D4",
  "#8B5CF6",
  "#64748B",
] as const;

/** The fork's chart font stack (the stage's deck font applies to text only). */
const CHART_FONT_FAMILY = "Manrope, Arial, sans-serif";

/** The ten graph-role colors a theme contributes to a chart palette. */
const GRAPH_ROLES = [
  "graph_0",
  "graph_1",
  "graph_2",
  "graph_3",
  "graph_4",
  "graph_5",
  "graph_6",
  "graph_7",
  "graph_8",
  "graph_9",
] as const;

/** The theme slice `chartConfig` reads; a full `DeckTheme` is assignable. */
export type ChartTheme = { colors?: Partial<DeckThemeColors> | null } | null;

type ChartJsType =
  | "bar"
  | "line"
  | "pie"
  | "doughnut"
  | "scatter"
  | "radar"
  | "polarArea";

/** Every wire `chart_type` and the Chart.js type it draws as (fork parity). */
const CHART_JS_TYPES: Record<ChartType, ChartJsType> = {
  bar: "bar",
  horizontal_bar: "bar",
  stacked_bar: "bar",
  horizontal_stacked_bar: "bar",
  line: "line",
  area: "line",
  pie: "pie",
  donut: "doughnut",
  scatter: "scatter",
  radar: "radar",
  polar_area: "polarArea",
};

/** The fields `chartDatasets` fills; Chart.js consumes them per chart type. */
type ChartDatasetConfig = {
  label: string;
  data: number[] | Array<{ x: number; y: number }>;
  backgroundColor?: string | string[];
  borderColor?: string | string[];
  borderWidth?: number;
  borderRadius?: number;
  borderSkipped?: false | "start";
  fill?: boolean;
  tension?: number;
  pointBackgroundColor?: string | string[];
  pointBorderColor?: string;
  pointBorderWidth?: number;
  pointRadius?: number;
  pointHoverRadius?: number;
  maxBarThickness?: number;
  hoverOffset?: number;
};

function chartKindFromWire(value: unknown): ChartType {
  return typeof value === "string" && value in CHART_JS_TYPES
    ? (value as ChartType)
    : "bar";
}

function isPieLikeChart(kind: ChartType): boolean {
  return kind === "pie" || kind === "donut";
}

function isBarChart(kind: ChartType): boolean {
  return (
    kind === "bar" ||
    kind === "horizontal_bar" ||
    kind === "stacked_bar" ||
    kind === "horizontal_stacked_bar"
  );
}

function isHorizontalChart(kind: ChartType): boolean {
  return kind === "horizontal_bar" || kind === "horizontal_stacked_bar";
}

function isStackedChart(kind: ChartType): boolean {
  return kind === "stacked_bar" || kind === "horizontal_stacked_bar";
}

/** The fork's `normalizeChartColor`: `#`-optional hex / rgb(a), or null.
 * Exported so the editor writes exactly the color vocabulary `chartConfig`
 * accepts (`chartOps.ts`). */
export function normalizeChartColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const color = value.trim();
  if (!color) return null;
  const normalized =
    color.startsWith("#") || /^rgba?\(/i.test(color) ? color : `#${color}`;
  return /^#[0-9a-f]{3}$/i.test(normalized) ||
    /^#[0-9a-f]{6}$/i.test(normalized) ||
    /^rgba?\(/i.test(normalized)
    ? normalized
    : null;
}

/** Every valid color in a wire color array, in order. */
function readColorList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((color) => normalizeChartColor(color))
    .filter((color): color is string => color !== null);
}

/** The fork's `withAlpha`, hex and rgb(a) inputs alike. */
function withAlpha(color: string, alpha: number): string {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
  if (!hex) {
    const rgb = /^rgba?\(([^)]+)\)$/i.exec(color);
    if (!rgb) return color;
    const channels = rgb[1]
      .split(",")
      .slice(0, 3)
      .map((part) => part.trim());
    return `rgba(${channels.join(", ")}, ${alpha})`;
  }
  const raw =
    hex[1].length === 3
      ? hex[1]
          .split("")
          .map((char) => char + char)
          .join("")
      : hex[1];
  const int = Number.parseInt(raw, 16);
  return `rgba(${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255}, ${alpha})`;
}

/** The fork's `readOptionalBoolean`: `null` means "use the fallback". */
function readOptionalBoolean(value: unknown, fallback: boolean): boolean {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return fallback;
}

/** The fork's `readDataLabelPosition` (legacy `true` reads as `"top"`). */
function readDataLabelPosition(value: unknown): DataLabelPosition | null {
  if (value === true) return "top";
  if (value === false || value == null) return null;
  return value === "base" || value === "mid" || value === "top" || value === "outside"
    ? value
    : null;
}

function chartDataLabelAnchor(position: DataLabelPosition): string {
  if (position === "base") return "start";
  if (position === "mid") return "center";
  return "end";
}

function chartDataLabelAlign(position: DataLabelPosition): string {
  if (position === "base") return "end";
  if (position === "top") return "start";
  if (position === "outside") return "end";
  return "center";
}

type NormalizedChartSeries = { name: string; values: number[] };

/** The fork's `normalizeChartData` series pass: named, numeric, non-empty. */
function normalizeChartSeries(value: unknown): NormalizedChartSeries[] {
  if (!Array.isArray(value)) return [];
  const series: NormalizedChartSeries[] = [];
  value.forEach((entry, index) => {
    if (typeof entry !== "object" || entry === null) return;
    const record = entry as { name?: unknown; values?: unknown };
    const values = Array.isArray(record.values)
      ? record.values.map((item) => readOptionalNumber(item) ?? 0)
      : [];
    if (values.length === 0) return;
    const name =
      typeof record.name === "string" && record.name.trim()
        ? record.name.trim()
        : `Series ${index + 1}`;
    series.push({ name, values });
  });
  return series;
}

/** Categories padded to the longest series, capped at 24 (fork bound). */
function chartLabels(
  element: ChartElement,
  series: NormalizedChartSeries[],
): string[] {
  const raw = Array.isArray(element.categories) ? element.categories : [];
  const valueCount = Math.max(0, ...series.map((item) => item.values.length));
  const length = Math.min(24, Math.max(1, raw.length, valueCount));
  return Array.from({ length }, (_, index) => {
    const value = raw[index];
    return typeof value === "string" && value.trim() ? value : `Value ${index + 1}`;
  });
}

function paddedValues(values: number[], length: number): number[] {
  return Array.from({ length }, (_, index) => values[index] ?? 0);
}

function seriesColor(index: number, palette: string[]): string {
  return (
    palette[index % palette.length] ??
    DEFAULT_CHART_COLORS[index % DEFAULT_CHART_COLORS.length]
  );
}

function categoryColors(values: number[], palette: string[]): string[] {
  return values.map((_, index) => seriesColor(index, palette));
}

/** The fork's `chartDatasets`: per-type dataset styling over the palette. */
function chartDatasets(
  kind: ChartType,
  series: NormalizedChartSeries[],
  labels: string[],
  palette: string[],
): ChartDatasetConfig[] {
  if (isPieLikeChart(kind)) {
    const first = series[0];
    if (!first) return [];
    const values = paddedValues(first.values, labels.length).map((value) =>
      Math.max(0, value),
    );
    return [
      {
        label: first.name,
        data: values,
        backgroundColor: values.map((_, index) => seriesColor(index, palette)),
        borderColor: "#FFFFFF",
        borderWidth: 1,
        hoverOffset: 0,
      },
    ];
  }

  if (kind === "polar_area") {
    const active = series.length
      ? series
      : [{ name: "Series 1", values: paddedValues([0], labels.length) }];
    return active.map((item, index) => {
      const colors =
        active.length === 1
          ? categoryColors(item.values, palette)
          : [seriesColor(index, palette)];
      return {
        label: item.name,
        data: paddedValues(item.values, labels.length),
        backgroundColor: colors.map((color) => withAlpha(color, 0.78)),
        borderColor: colors,
        borderWidth: 1,
      };
    });
  }

  if (kind === "scatter") {
    return series.map((item, index) => {
      const colors =
        series.length === 1
          ? categoryColors(item.values, palette)
          : [seriesColor(index, palette)];
      return {
        label: item.name,
        data: paddedValues(item.values, labels.length).map((value, valueIndex) => ({
          x: valueIndex + 1,
          y: value,
        })),
        backgroundColor: colors.map((color) => withAlpha(color, 0.78)),
        borderColor: colors,
        borderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 4,
      };
    });
  }

  const lineLike = kind === "line" || kind === "area";
  const stacked = isStackedChart(kind);
  return series.map((item, index) => {
    const color = seriesColor(index, palette);
    const perCategory =
      series.length === 1 ? categoryColors(item.values, palette) : null;
    const dataset: ChartDatasetConfig = {
      label: item.name,
      data: paddedValues(item.values, labels.length),
      backgroundColor:
        kind === "area"
          ? withAlpha(color, 0.24)
          : lineLike
            ? color
            : (perCategory ?? color),
      borderColor: color,
      borderWidth: lineLike ? 3 : 0,
      tension: lineLike ? 0.35 : 0,
      pointBackgroundColor: perCategory ?? color,
      pointBorderColor: "#FFFFFF",
      pointBorderWidth: lineLike ? 1.5 : 0,
      pointRadius: lineLike ? 3.5 : 0,
      fill: kind === "area",
      maxBarThickness: 62,
    };
    if (isBarChart(kind)) {
      dataset.borderRadius = 7;
      dataset.borderSkipped = stacked ? "start" : false;
    }
    return dataset;
  });
}

/**
 * The fork's `chartScales`: cartesian scales for bar/line types, a radial
 * scale for radar, linear pairs for scatter, and nothing for pie-like and
 * polar charts (which draw without axes).
 */
function chartScales({
  kind,
  axisColor,
  gridColor,
  fontSize,
  xAxis,
  xAxisGrid,
  xAxisTitle,
  yAxis,
  yAxisGrid,
  yAxisTitle,
}: {
  kind: ChartType;
  axisColor: string;
  gridColor: string;
  fontSize: number;
  xAxis: boolean;
  xAxisGrid: boolean;
  xAxisTitle: string;
  yAxis: boolean;
  yAxisGrid: boolean;
  yAxisTitle: string;
}): Record<string, unknown> | undefined {
  if (isPieLikeChart(kind) || kind === "polar_area") return undefined;

  if (kind === "radar") {
    return {
      r: {
        angleLines: {
          color: withAlpha(gridColor, xAxisGrid ? 0.35 : 0),
          display: xAxisGrid,
        },
        beginAtZero: true,
        grid: {
          color: withAlpha(gridColor, yAxisGrid ? 0.35 : 0),
          display: yAxisGrid,
        },
        pointLabels: {
          color: axisColor,
          display: xAxis,
          font: { family: CHART_FONT_FAMILY, size: fontSize, weight: 600 },
        },
        ticks: {
          backdropColor: "transparent",
          color: axisColor,
          display: yAxis,
          font: { family: CHART_FONT_FAMILY, size: Math.max(8, fontSize - 1) },
        },
      },
    };
  }

  const horizontal = isHorizontalChart(kind);
  const stacked = isStackedChart(kind);
  const showCategoryGrid = horizontal ? xAxisGrid : yAxisGrid;
  const showLinearGrid = horizontal ? yAxisGrid : xAxisGrid;
  const showCategoryAxis = horizontal ? yAxis : xAxis;
  const showLinearAxis = horizontal ? xAxis : yAxis;
  const categoryAxis = {
    display: showCategoryAxis || showCategoryGrid,
    border: { color: axisColor, display: showCategoryAxis },
    grid: {
      color: withAlpha(gridColor, showCategoryGrid ? 0.25 : 0),
      display: showCategoryGrid,
      drawTicks: showCategoryAxis,
    },
    stacked,
    ticks: {
      color: axisColor,
      display: showCategoryAxis,
      font: { family: CHART_FONT_FAMILY, size: fontSize, weight: 600 },
      maxRotation: 0,
      autoSkip: true,
    },
    title: {
      color: axisColor,
      display: showCategoryAxis && Boolean(horizontal ? yAxisTitle : xAxisTitle),
      font: { family: CHART_FONT_FAMILY, size: fontSize, weight: 700 },
      text: horizontal ? yAxisTitle : xAxisTitle,
    },
    type: "category",
  };
  const linearAxis = {
    beginAtZero: true,
    display: showLinearAxis || showLinearGrid,
    border: { color: axisColor, display: showLinearAxis },
    grace: "8%",
    grid: {
      color: withAlpha(gridColor, showLinearGrid ? 0.35 : 0),
      display: showLinearGrid,
      drawTicks: showLinearAxis,
    },
    stacked,
    ticks: {
      color: axisColor,
      display: showLinearAxis,
      font: { family: CHART_FONT_FAMILY, size: Math.max(8, fontSize - 2), weight: 600 },
    },
    title: {
      color: axisColor,
      display: showLinearAxis && Boolean(horizontal ? xAxisTitle : yAxisTitle),
      font: { family: CHART_FONT_FAMILY, size: fontSize, weight: 700 },
      text: horizontal ? xAxisTitle : yAxisTitle,
    },
    type: "linear",
  };

  if (kind === "scatter") {
    return {
      x: {
        ...linearAxis,
        display: xAxis || yAxisGrid,
        border: { ...linearAxis.border, display: xAxis },
        grid: {
          color: withAlpha(gridColor, yAxisGrid ? 0.35 : 0),
          display: yAxisGrid,
          drawTicks: xAxis,
        },
        ticks: { ...linearAxis.ticks, display: xAxis },
        title: {
          ...linearAxis.title,
          display: xAxis && Boolean(xAxisTitle),
          text: xAxisTitle,
        },
      },
      y: {
        ...linearAxis,
        display: yAxis || xAxisGrid,
        border: { ...linearAxis.border, display: yAxis },
        grid: {
          color: withAlpha(gridColor, xAxisGrid ? 0.35 : 0),
          display: xAxisGrid,
          drawTicks: yAxis,
        },
        ticks: { ...linearAxis.ticks, display: yAxis },
        title: {
          ...linearAxis.title,
          display: yAxis && Boolean(yAxisTitle),
          text: yAxisTitle,
        },
      },
    };
  }

  return horizontal
    ? { x: linearAxis, y: categoryAxis }
    : { x: categoryAxis, y: linearAxis };
}

/**
 * The Chart.js configuration for one chart element (spec §6.6).
 *
 * Palette precedence: the element's explicit `colors`, then the theme's
 * `graph_0…graph_9` roles (the stage applies them as CSS variables; the
 * renderer resolves them back to concrete colors), then the fork's default
 * palette. Everything else follows the fork mapping — series styles, axis and
 * grid wiring, legend/title plugins, `data_labels` and `indexAxis`/`cutout`.
 * The returned object is cast because Chart.js's generics cannot express one
 * configuration that narrows its chart type at runtime; every field written
 * here is a real Chart.js option.
 */
export function chartConfig(
  element: ChartElement,
  theme?: ChartTheme | null,
): ChartConfiguration {
  const kind = chartKindFromWire(element.chart_type);
  const series = normalizeChartSeries(element.series);
  const labels = chartLabels(element, series);
  const explicitColors = readColorList(element.colors);
  const themeColors = theme
    ? GRAPH_ROLES.map((role) => normalizeChartColor(theme.colors?.[role])).filter(
        (color): color is string => color !== null,
      )
    : [];
  const palette = explicitColors.length
    ? explicitColors
    : themeColors.length
      ? themeColors
      : [...DEFAULT_CHART_COLORS];

  const height = readOptionalNumber(element.size?.height) ?? 0;
  const fontSize = clamp(height * 0.033, 9, 18);
  const titleFontSize = clamp(height * 0.044, 11, 26);
  const valueFontSize = clamp(height * 0.029, 8, 15);

  const textColor = normalizeChartColor(element.text_color) ?? "#475467";
  const titleColor = normalizeChartColor(element.title_color) ?? "#344054";
  const legendColor = normalizeChartColor(element.legend_color) ?? textColor;
  const axisColor = normalizeChartColor(element.axis_color) ?? "#98A2B3";
  const gridColor = normalizeChartColor(element.grid_color) ?? axisColor;
  const title = typeof element.title === "string" ? element.title.trim() : "";

  const pieLike = isPieLikeChart(kind);
  const autoLegend =
    pieLike ||
    series.length > 1 ||
    Boolean(series[0]?.name && series[0].name !== "Series 1");
  const showLegend = readOptionalBoolean(element.legend, autoLegend);
  const dataLabel = readDataLabelPosition(element.data_labels);

  const options: Record<string, unknown> = {
    color: textColor,
    font: { family: CHART_FONT_FAMILY },
    indexAxis: isHorizontalChart(kind) ? "y" : "x",
    layout: {
      padding: pieLike
        ? { top: 16, right: 20, bottom: 12, left: 20 }
        : { top: 12, right: 22, bottom: 8, left: 12 },
    },
    responsive: false,
    maintainAspectRatio: false,
    animation: false,
    normalized: true,
    plugins: {
      legend: {
        display: showLegend,
        position: "bottom",
        labels: {
          boxWidth: Math.max(8, fontSize * 0.8),
          boxHeight: Math.max(8, fontSize * 0.8),
          color: legendColor,
          font: { family: CHART_FONT_FAMILY, size: fontSize, weight: 600 },
          padding: Math.max(8, fontSize),
          usePointStyle: true,
        },
      },
      title: {
        display: Boolean(title),
        text: title.split(/\r?\n/).filter(Boolean),
        color: titleColor,
        font: { family: CHART_FONT_FAMILY, size: titleFontSize, weight: "700" },
        padding: {
          bottom: Math.max(16, titleFontSize * 0.8),
          top: 0,
        },
      },
      tooltip: { enabled: false },
      datalabels: {
        align: chartDataLabelAlign(dataLabel ?? "top"),
        anchor: chartDataLabelAnchor(dataLabel ?? "top"),
        clamp: true,
        clip: false,
        color: textColor,
        display: dataLabel !== null,
        font: { family: CHART_FONT_FAMILY, size: valueFontSize, weight: 600 },
        offset: dataLabel === "outside" ? 6 : 2,
      },
    },
  };

  if (kind === "donut") {
    options.cutout = "58%";
  } else if (kind === "pie") {
    options.cutout = "0%";
  } else {
    options.scales = chartScales({
      kind,
      axisColor,
      gridColor,
      fontSize,
      xAxis: readOptionalBoolean(element.x_axis, true),
      xAxisGrid: readOptionalBoolean(element.x_axis_grid, true),
      xAxisTitle:
        typeof element.x_axis_title === "string" ? element.x_axis_title.trim() : "",
      yAxis: readOptionalBoolean(element.y_axis, true),
      yAxisGrid: readOptionalBoolean(element.y_axis_grid, true),
      yAxisTitle:
        typeof element.y_axis_title === "string" ? element.y_axis_title.trim() : "",
    });
  }

  return {
    type: CHART_JS_TYPES[kind],
    data: { labels, datasets: chartDatasets(kind, series, labels, palette) },
    options,
  } as ChartConfiguration;
}

// ---------------------------------------------------------------------------
// B5 — infographic geometry and colors (spec §6.7)
//
// The three natively rendered infographic types share the fork's metric
// semantics (`infographicMetrics`) and its color helpers, verified against the
// served verdant template (2026-09-16): `colors[0]` is the track/base,
// `colors[1]` the highlight and `colors[2…]` the funnel stage palette.
// ---------------------------------------------------------------------------

/** The fork's engine-default infographic palette (`colors` minus the base). */
const INFOGRAPHIC_DEFAULT_PALETTE = ["#2563EB", "#7C3AED", "#0EA5E9", "#10B981"];

/** The `min_value`/`max_value`/`value` trio gauge and progress bar carry. */
export type InfographicValueData = {
  min_value?: number | null;
  max_value?: number | null;
  value?: number | null;
};

export type InfographicMetrics = { ratio: number; label: string };

/** The fork's `formatInfographicNumber`: two decimals, `-0` reads "0". */
function formatInfographicNumber(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

/**
 * The fork's `infographicMetrics`: bounds sorted defensively, the value
 * clamped into them, a `0..1` ratio (0 when min equals max) and the formatted
 * label the progress bar prints.
 */
export function infographicMetrics(
  data: InfographicValueData | null | undefined,
): InfographicMetrics {
  const rawMin = readOptionalNumber(data?.min_value) ?? 0;
  const rawMax = readOptionalNumber(data?.max_value) ?? 100;
  const min = Math.min(rawMin, rawMax);
  const max = Math.max(rawMin, rawMax);
  const value = clamp(readOptionalNumber(data?.value) ?? min, min, max);
  return {
    ratio: max === min ? 0 : (value - min) / (max - min),
    label: formatInfographicNumber(value),
  };
}

/** The fork's gauge geometry: center (60,60), radius 48, a 180°→360° arc. */
const GAUGE_CENTER = 60;
const GAUGE_RADIUS = 48;

function gaugeArcNumber(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function gaugeArcPoint(angleDegrees: number): { x: number; y: number } {
  const radians = (angleDegrees * Math.PI) / 180;
  return {
    x: GAUGE_CENTER + GAUGE_RADIUS * Math.cos(radians),
    y: GAUGE_CENTER + GAUGE_RADIUS * Math.sin(radians),
  };
}

/**
 * The SVG path of the gauge arc for a `0..1` ratio (clamped), in the fork's
 * `viewBox="0 0 120 72"` space. Ratio 1 draws the full semicircle baseline;
 * ratio 0 degenerates to a zero-length arc the caller can skip.
 */
export function gaugeArcPath(ratio: number): string {
  const start = gaugeArcPoint(180);
  const end = gaugeArcPoint(180 + clamp(ratio, 0, 1) * 180);
  return `M ${gaugeArcNumber(start.x)} ${gaugeArcNumber(start.y)} A ${GAUGE_RADIUS} ${GAUGE_RADIUS} 0 0 1 ${gaugeArcNumber(end.x)} ${gaugeArcNumber(end.y)}`;
}

/** The fork's `infographicBaseColor`: `colors[0]`, else the neutral track. */
export function infographicBaseColor(
  element: Pick<InfographicElement, "colors">,
): string {
  return readColorList(element.colors)[0] ?? "#E5E7EB";
}

/** The fork's `infographicHighlightColor`: `colors[1]`, else the accent. */
export function infographicHighlightColor(
  element: Pick<InfographicElement, "colors">,
): string {
  return readColorList(element.colors)[1] ?? DEFAULT_CHART_COLORS[0];
}

/** The fork's `infographicPalette`: `colors` minus the base, else defaults. */
export function infographicPalette(
  element: Pick<InfographicElement, "colors">,
): string[] {
  const colors = readColorList(element.colors).slice(1);
  return colors.length ? colors : [...INFOGRAPHIC_DEFAULT_PALETTE];
}

/** The fork's `infographicTextColor`: `text_color`, else the fallback. */
export function infographicTextColor(
  element: Pick<InfographicElement, "text_color">,
  fallback: string,
): string {
  return normalizeChartColor(element.text_color) ?? fallback;
}
