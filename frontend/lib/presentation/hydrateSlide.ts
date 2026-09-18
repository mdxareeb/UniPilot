/**
 * Task C2 — the pure hydration module (spec §7.6): content + template layout →
 * slide `ui`.
 *
 * The mechanic behind add-slide and per-slide layout changes: clone a template
 * layout's components and place an existing slide's `content` values into the
 * elements by `name` where `decorative === false`, preserving component
 * positions and decorative elements. Server-safe and I/O-free — nothing here
 * fetches, renders, or touches global state.
 *
 * The merge mirrors Presenton's documented behavior, not its code
 * (`_apply_template_content_to_ui` / `_apply_template_content_to_element` in
 * `servers/fastapi/api/v1/ppt/endpoints/presentation.py:560-694` and the
 * per-type appliers at `:839-1403`, with the shared helpers in
 * `templates/v2/content.py`): component content is keyed by component `id`
 * (zero-based `_<n>` suffixes when an id repeats, :523-557), element values are
 * looked up by name candidates (:697-729), repeated names prefer `name_<n>`
 * (:825-836), `container.child` / `flex|grid|group.children` recurse
 * (:661-692), and each generated element type maps its value onto the wire
 * shape (text → first run's style; text-list → items; image → data/prompt;
 * table → cells; chart → camelCase vocabulary; infographic → data/colors).
 * Cases the engine handles that this module deliberately does not map are
 * recorded in the Task C2 report.
 */
import type {
  SlideComponent,
  SlideUi,
  TemplateLayout,
} from "./types";

/** JSON object view of the wire structures this module hydrates. */
type JsonRecord = Record<string, unknown>;

export type HydrateSlideInput = {
  /** The template layout whose components the `ui` is built from. */
  layout: TemplateLayout;
  /** Generated/existing values keyed by component id, then element name. */
  content: Record<string, unknown>;
};

/** The element types the engine generates content for (presentation.py:488). */
const GENERATED_VALUE_ELEMENT_TYPES = new Set([
  "text",
  "image",
  "text-list",
  "table",
  "chart",
  "infographic",
]);

/**
 * The chart-type vocabulary the engine accepts in content
 * (presentation.py:1349-1362). The engine also accepts `bubble`; our wire
 * union and renderer do not model it, so that one value is deliberately left
 * unmapped (recorded in the C2 report).
 */
const SUPPORTED_CHART_TYPES = new Set([
  "area",
  "bar",
  "donut",
  "horizontal_bar",
  "horizontal_stacked_bar",
  "line",
  "pie",
  "polar_area",
  "radar",
  "scatter",
  "stacked_bar",
]);

/** The engine's generated-table cell defaults (presentation.py:497-514). */
const GENERATED_TABLE_TEXT_FONT: JsonRecord = {
  family: "Sniglet",
  size: 12,
  color: "#082314",
};
const GENERATED_TABLE_HEADER_FONT: JsonRecord = {
  ...GENERATED_TABLE_TEXT_FONT,
  bold: true,
};
const GENERATED_TABLE_CELL_FILL: JsonRecord = { color: "#F8F4E9", opacity: 1 };
const GENERATED_TABLE_CELL_STROKE: JsonRecord = {
  color: "#D8D3C4",
  opacity: 1,
  width: 1,
};

const CHART_STRING_KEYS: Array<[string, string]> = [
  ["axisColor", "axis_color"],
  ["axis_color", "axis_color"],
  ["gridColor", "grid_color"],
  ["grid_color", "grid_color"],
  ["legendColor", "legend_color"],
  ["legend_color", "legend_color"],
  ["xAxisTitle", "x_axis_title"],
  ["x_axis_title", "x_axis_title"],
  ["yAxisTitle", "y_axis_title"],
  ["y_axis_title", "y_axis_title"],
  ["source", "source"],
];

const CHART_BOOLEAN_KEYS: Array<[string, string]> = [
  ["xAxis", "x_axis"],
  ["x_axis", "x_axis"],
  ["yAxis", "y_axis"],
  ["y_axis", "y_axis"],
  ["xAxisGrid", "x_axis_grid"],
  ["x_axis_grid", "x_axis_grid"],
  ["yAxisGrid", "y_axis_grid"],
  ["y_axis_grid", "y_axis_grid"],
];

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

/** The first non-empty record among the arguments, else `null`. */
function firstRecord(...values: unknown[]): JsonRecord | null {
  for (const value of values) {
    const record = asRecord(value);
    if (record && Object.keys(record).length > 0) return record;
  }
  return null;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

// ---------------------------------------------------------------------------
// Component content keys (presentation.py:523-557, 581-586)
// ---------------------------------------------------------------------------

/**
 * The content key each component reads: its `id`, or `id_<occurrence>` when
 * the id repeats (zero-based, engine order), with the engine's collision
 * suffixing for ids that themselves collide with a generated key.
 */
function componentContentKeys(
  components: Array<{ id?: unknown }>,
): string[] {
  const ids = components.map((component, index) =>
    typeof component?.id === "string" ? component.id : `component_${index}`,
  );
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);

  const occurrences = new Map<string, number>();
  const used = new Set<string>();
  return ids.map((id) => {
    const occurrence = occurrences.get(id) ?? 0;
    occurrences.set(id, occurrence + 1);
    const base = (counts.get(id) ?? 0) > 1 ? `${id}_${occurrence}` : id;
    let key = base;
    let suffix = 1;
    while (used.has(key)) {
      key = `${base}_${suffix}`;
      suffix += 1;
    }
    used.add(key);
    return key;
  });
}

// ---------------------------------------------------------------------------
// Element name matching (presentation.py:697-729, 825-836)
// ---------------------------------------------------------------------------

/** `name`, minus `_<digits>` tokens, minus the first `_`-prefix segment. */
function contentNameCandidates(name: string): string[] {
  const withoutNumericToken = name.replace(/_\d+(?=_|$)/g, "");
  const withoutPrefix = withoutNumericToken.includes("_")
    ? withoutNumericToken.slice(withoutNumericToken.indexOf("_") + 1)
    : withoutNumericToken;
  const candidates: string[] = [];
  for (const candidate of [name, withoutNumericToken, withoutPrefix]) {
    if (candidate && !candidates.includes(candidate)) candidates.push(candidate);
  }
  return candidates;
}

/**
 * The preferred key for the second-and-later element of the same `name` in one
 * list: `name_<n>` when the content carries it (the engine's repeated-element
 * suffix rule). Counts the occurrence even when nothing is found.
 */
function repeatedContentKeys(
  name: string,
  content: JsonRecord,
  occurrences: Map<string, number>,
): string[] | undefined {
  const occurrenceIndex = occurrences.get(name) ?? 0;
  occurrences.set(name, occurrenceIndex + 1);
  if (occurrenceIndex === 0) return undefined;
  const suffixed = `${name}_${occurrenceIndex + 1}`;
  return suffixed in content ? [suffixed] : undefined;
}

function templateContentValue(
  content: JsonRecord,
  name: string,
  preferred: string[] | undefined,
): [boolean, unknown] {
  const candidates: string[] = [];
  for (const candidate of [
    ...(preferred ?? []),
    ...contentNameCandidates(name),
  ]) {
    if (candidate && !candidates.includes(candidate)) candidates.push(candidate);
  }
  for (const candidate of candidates) {
    if (candidate in content) return [true, content[candidate]];
  }
  return [false, undefined];
}

// ---------------------------------------------------------------------------
// The merge walk (presentation.py:560-694)
// ---------------------------------------------------------------------------

/**
 * Hydrate one template layout with the slide's content. Pure: the layout and
 * content are never mutated, and every returned component/element is a fresh
 * clone. Content keys that match no component or element are dropped; elements
 * without a matching value keep their template defaults.
 */
export function hydrateSlide({ layout, content }: HydrateSlideInput): SlideUi {
  const components = layout.components.map(
    (component) => clone(component) as unknown as JsonRecord,
  );
  const keys = componentContentKeys(components);

  components.forEach((component, index) => {
    const componentId = typeof component.id === "string" ? component.id : null;
    let componentContent = asRecord(content[keys[index]]);
    if (!componentContent && componentId) {
      componentContent = asRecord(content[componentId]);
    }
    const elements = component.elements;
    if (Array.isArray(elements)) {
      component.elements = hydrateElementList(
        elements,
        componentContent ?? {},
        false,
        new Map(),
      );
    }
  });

  return {
    id: layout.id,
    description: layout.description,
    components: components as unknown as SlideComponent[],
  };
}

function hydrateElementList(
  elements: unknown[],
  content: unknown,
  directValue: boolean,
  nameOccurrences: Map<string, number>,
): unknown[] {
  return elements.map((element) =>
    hydrateElement(element, content, directValue, nameOccurrences),
  );
}

function hydrateElement(
  element: unknown,
  content: unknown,
  directValue: boolean,
  nameOccurrences: Map<string, number>,
): unknown {
  const record = asRecord(element);
  if (!record) return element;

  const contentValues = asRecord(content) ?? {};
  const elementType = typeof record.type === "string" ? record.type : "";
  const name =
    typeof record.name === "string" && record.name ? record.name : null;

  let hasValue = false;
  let value: unknown;
  if (name) {
    const preferred = repeatedContentKeys(name, contentValues, nameOccurrences);
    [hasValue, value] = templateContentValue(contentValues, name, preferred);
  }

  if (
    record.decorative === false &&
    name &&
    hasValue &&
    GENERATED_VALUE_ELEMENT_TYPES.has(elementType)
  ) {
    return applyTemplateContentValue(record, value);
  }

  // Repeated flex/grid schemas omit the child-name wrapper when an item is a
  // direct generated value (presentation.py:648-659).
  if (
    directValue &&
    !hasValue &&
    record.decorative === false &&
    GENERATED_VALUE_ELEMENT_TYPES.has(elementType)
  ) {
    return applyTemplateContentValue(record, content);
  }

  const nestedContent = asRecord(value) ?? contentValues;
  const nestedDirectValue = directValue && !hasValue;
  const nestedOccurrences =
    hasValue && asRecord(value) ? new Map<string, number>() : nameOccurrences;

  if (elementType === "container") {
    const updated = clone(record);
    updated.child = hydrateElement(
      record.child,
      nestedContent,
      nestedDirectValue,
      nestedOccurrences,
    );
    return updated;
  }

  if (
    elementType === "flex" ||
    elementType === "grid" ||
    elementType === "group"
  ) {
    const updated = clone(record);
    const children = Array.isArray(record.children) ? record.children : [];
    updated.children = hydrateElementList(
      children,
      nestedContent,
      nestedDirectValue,
      nestedOccurrences,
    );
    return updated;
  }

  return clone(record);
}

// ---------------------------------------------------------------------------
// Per-type value appliers (presentation.py:839-1403)
// ---------------------------------------------------------------------------

function applyTemplateContentValue(
  element: JsonRecord,
  value: unknown,
): JsonRecord {
  switch (element.type) {
    case "text":
      return applyTextContent(element, value);
    case "image":
      return applyImageContent(element, value);
    case "text-list":
      return applyTextListContent(element, value);
    case "table":
      return applyTableContent(element, value);
    case "chart":
      return applyChartContent(element, value);
    case "infographic":
      return applyInfographicContent(element, value);
    default:
      return clone(element);
  }
}

/** The engine's `_read_template_text`: strings, numbers, `{text: …}`. */
function readTemplateText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  const record = asRecord(value);
  if (record) {
    const text = record.text;
    if (typeof text === "string") return text;
    if (typeof text === "number") return String(text);
  }
  return null;
}

function firstTextRun(runs: unknown): JsonRecord {
  if (Array.isArray(runs) && runs.length > 0) {
    return asRecord(runs[0]) ?? {};
  }
  return {};
}

/**
 * The engine's `_template_base_run_for_markdown` + run assembly for plain
 * text: the first run's style (with the element font merged underneath it),
 * the value as its text. Markdown/Latex parsing is deliberately not mapped.
 */
function templateTextRuns(
  text: string,
  firstRun: unknown,
  fallbackFont: unknown,
): JsonRecord[] {
  const base = asRecord(firstRun) ? clone(firstRun as JsonRecord) : {};
  const fallback = asRecord(fallbackFont);
  if (fallback) {
    base.font = {
      ...clone(fallback),
      ...(asRecord(base.font) ? clone(base.font as JsonRecord) : {}),
    };
  } else if (asRecord(base.font)) {
    base.font = clone(base.font);
  }
  return [{ ...base, text }];
}

function applyTextContent(element: JsonRecord, value: unknown): JsonRecord {
  const text = readTemplateText(value);
  if (text === null || text === "") return clone(element);
  const updated = clone(element);
  updated.runs = templateTextRuns(text, firstTextRun(element.runs), element.font);
  delete updated.text;
  return updated;
}

function applyImageContent(element: JsonRecord, value: unknown): JsonRecord {
  const record = asRecord(value);
  if (!record) return clone(element);

  let url: string | null = null;
  for (const key of [
    "image_url",
    "icon_url",
    "__image_url__",
    "__icon_url__",
    "url",
  ]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate) {
      url = candidate;
      break;
    }
  }
  if (!url) return clone(element);

  const updated = clone(element);
  updated.data = url;
  normalizeGeneratedImageFit(updated, url);
  const prompt = assetPrompt(record, element.is_icon === true);
  if (prompt) updated.prompt = prompt;
  return updated;
}

/** `slide_ui_helpers.py:412-439` (used at presentation.py:958) — images default to `cover`. */
function normalizeGeneratedImageFit(element: JsonRecord, url: string): void {
  if (element.is_icon === true || element.fit === "cover") return;
  if (hasImageClipPath(element)) return;
  if (looksLikeSvgAssetReference(url)) return;
  element.fit = "cover";
}

function hasImageClipPath(element: JsonRecord): boolean {
  for (const key of ["clip_path", "clipPath", "clippath"]) {
    const value = element[key];
    if (
      typeof value === "string" &&
      value.trim() &&
      value.trim().toLowerCase() !== "none"
    ) {
      return true;
    }
  }
  return false;
}

function looksLikeSvgAssetReference(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith("data:image/svg+xml")) return true;
  return normalized.split("?", 1)[0].split("#", 1)[0].endsWith(".svg");
}

/** presentation.py:965-978 — the first non-empty prompt key for the type. */
function assetPrompt(value: JsonRecord, isIcon: boolean): string | null {
  const keys = isIcon
    ? ["icon_query", "__icon_query__", "query", "prompt"]
    : ["image_prompt", "__image_prompt__", "prompt", "query"];
  for (const key of keys) {
    const prompt = value[key];
    if (typeof prompt === "string" && prompt.trim()) return prompt;
  }
  return null;
}

function applyTextListContent(
  element: JsonRecord,
  value: unknown,
): JsonRecord {
  if (!Array.isArray(value)) return clone(element);
  const existing = Array.isArray(element.items) ? element.items : [];
  const items: unknown[] = [];
  value.forEach((item, index) => {
    const text = readTemplateText(item);
    if (text === null || text === "") return;
    const existingRuns = Array.isArray(existing[index])
      ? (existing[index] as unknown[])
      : null;
    const firstRun =
      existingRuns && existingRuns.length > 0 ? existingRuns[0] : {};
    items.push(templateTextRuns(text, firstRun, element.font));
  });
  const updated = clone(element);
  updated.items = items;
  return updated;
}

function applyTableContent(element: JsonRecord, value: unknown): JsonRecord {
  const record = asRecord(value);
  if (!record) return clone(element);

  const templateColumns = Array.isArray(element.columns)
    ? element.columns
    : [];
  const templateRows = (Array.isArray(element.rows) ? element.rows : []).filter(
    (row) => Array.isArray(row),
  );

  const generatedColumns = Array.isArray(record.columns)
    ? record.columns.map(readTemplateTableText)
    : [];
  const generatedRows = Array.isArray(record.rows)
    ? record.rows
        .filter((row) => Array.isArray(row))
        .map((row) => (row as unknown[]).map(readTemplateTableText))
    : [];
  const fallbackRow =
    templateRows.length > 0
      ? templateRows[templateRows.length - 1]
      : templateColumns;

  const updated = clone(element);
  updated.columns =
    generatedColumns.length > 0
      ? mergeTemplateTableRowToLength(templateColumns, generatedColumns, true)
      : clone(templateColumns);
  updated.rows =
    generatedRows.length > 0
      ? generatedRows.map((row, index) =>
          mergeTemplateTableRowToLength(
            index < templateRows.length ? templateRows[index] : fallbackRow,
            row,
            false,
          ),
        )
      : clone(templateRows);
  return updated;
}

/** presentation.py:1290-1323 — the string a generated table cell carries. */
function readTemplateTableText(value: unknown): string | null {
  const primitive = readPrimitiveTableText(value);
  if (primitive !== null) return primitive.slice(0, 80);

  const record = asRecord(value);
  if (!record) return null;

  const runs = record.runs;
  if (Array.isArray(runs)) {
    const runText = runs
      .filter((run) => asRecord(run) !== null)
      .map((run) => {
        const text = (run as JsonRecord).text;
        return typeof text === "string" ? text : "";
      })
      .join("");
    if (runText) return runText.slice(0, 80);
  }

  for (const key of ["text", "value"]) {
    const text = readPrimitiveTableText(record[key]);
    if (text !== null) return text.slice(0, 80);
  }
  return null;
}

function readPrimitiveTableText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return String(value).toLowerCase();
  if (typeof value === "number") return String(value);
  return null;
}

function mergeTemplateTableRowToLength(
  templateCells: unknown[],
  generatedTexts: Array<string | null>,
  isHeader: boolean,
): unknown[] {
  const fallbackCell =
    templateCells.length > 0 ? templateCells[templateCells.length - 1] : null;
  return generatedTexts.map((text, index) =>
    replaceTemplateTableCellText(
      index < templateCells.length ? templateCells[index] : fallbackCell,
      text ?? "",
      isHeader,
    ),
  );
}

function replaceTemplateTableCellText(
  cell: unknown,
  text: string,
  isHeader: boolean,
): JsonRecord {
  const defaultFont = isHeader
    ? GENERATED_TABLE_HEADER_FONT
    : GENERATED_TABLE_TEXT_FONT;
  const cellRecord = asRecord(cell);
  if (!cellRecord) {
    return {
      color: clone(GENERATED_TABLE_CELL_FILL),
      stroke: clone(GENERATED_TABLE_CELL_STROKE),
      font: clone(defaultFont),
      runs: templateTextRuns(text, { font: clone(defaultFont) }, null),
    };
  }

  const updated = clone(cellRecord);
  const firstRun = firstTextRun(cellRecord.runs);
  const nextFont =
    firstRecord(firstRun.font, cellRecord.font) ?? defaultFont;
  updated.color =
    firstRecord(cellRecord.color, cellRecord.fill) ??
    clone(GENERATED_TABLE_CELL_FILL);
  updated.stroke =
    firstRecord(cellRecord.stroke) ?? clone(GENERATED_TABLE_CELL_STROKE);
  updated.font = firstRecord(cellRecord.font) ?? nextFont;
  updated.runs = templateTextRuns(text, firstRun, nextFont);
  delete updated.text;
  delete updated.fill;
  return updated;
}

/** presentation.py:1326-1335 — legacy `true` reads as `"top"`. */
function readDataLabels(value: unknown): string | null {
  if (value === true) return "top";
  if (value === false || value === null || value === undefined) return null;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (
      normalized === "base" ||
      normalized === "mid" ||
      normalized === "top" ||
      normalized === "outside"
    ) {
      return normalized;
    }
  }
  return null;
}

function applyChartContent(element: JsonRecord, value: unknown): JsonRecord {
  const updated = clone(element);
  delete updated.data_labels_color;
  delete updated.grid;
  const record = asRecord(value);
  if (!record) return updated;

  const chartType = "chartType" in record ? record.chartType : record.chart_type;
  if (typeof chartType === "string" && SUPPORTED_CHART_TYPES.has(chartType)) {
    updated.chart_type = chartType;
  }
  if (typeof record.title === "string") updated.title = record.title;
  if (Array.isArray(record.categories) && record.categories.length > 0) {
    updated.categories = clone(record.categories);
  }
  if (Array.isArray(record.series) && record.series.length > 0) {
    updated.series = clone(record.series);
  }
  if (Array.isArray(record.colors) && record.colors.length > 0) {
    updated.colors = clone(record.colors);
  }
  for (const [source, target] of CHART_STRING_KEYS) {
    if (typeof record[source] === "string") updated[target] = record[source];
  }
  for (const [source, target] of CHART_BOOLEAN_KEYS) {
    if (typeof record[source] === "boolean") updated[target] = record[source];
  }
  for (const key of ["dataLabels", "data_labels"]) {
    if (key in record) updated.data_labels = readDataLabels(record[key]);
  }
  return updated;
}

function applyInfographicContent(
  element: JsonRecord,
  value: unknown,
): JsonRecord {
  const updated = clone(element);
  const record = asRecord(value);
  if (!record) return updated;

  const data = asRecord(record.data);
  if (data) {
    const current = asRecord(updated.data);
    const incoming = clone(data);
    if (current && typeof current.type === "string") {
      incoming.type = current.type;
    }
    updated.data = current ? { ...clone(current), ...incoming } : incoming;
  }
  if (Array.isArray(record.colors) && record.colors.length > 0) {
    updated.colors = clone(record.colors);
  }
  return updated;
}
