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
 * (:661-692), an **array** value on a `flex`/`grid`/`group` expands one child
 * per item (:741-754, `repeated_child_source_index` / `_normalize_repeated_names`
 * at content.py:12-23 and :764-801), and each generated element type maps its
 * value onto the wire shape (text → first run's style; text-list → items;
 * image → data/prompt; table → cells; chart → camelCase vocabulary;
 * infographic → data/colors).
 *
 * Task D6 closed the two gapped paths named in the C2 report: repeated-children
 * arrays (above) and markdown/LaTeX run parsing (`_template_text_runs_from_markdown`
 * :1131-1169 with `_parse_template_markdown_text` :1195-1245 and
 * `utils/latex_text.py`). The remaining recorded gap is the engine's
 * schema-derived top-level repeated-group expansion
 * (`hydrate_repeated_top_level_groups`, `templates/v2/content.py:26-56`), whose
 * field-name detection is not mapped; the block palette labels those layouts
 * replace-layout-only instead of guessing (`layoutReplaceSupport`).
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

/**
 * The element types generated content can land on (presentation.py:488's set,
 * minus `math`): the wire union and renderer model no math element, so a math
 * value keeps its template default instead of being placed — the C2 report's
 * recorded gap, unchanged by D6.
 */
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
        null,
      );
    }
  });

  return {
    id: layout.id,
    description: layout.description,
    components: components as unknown as SlideComponent[],
  };
}

/**
 * One element list. The engine's `_apply_template_content_to_element_list`
 * (presentation.py:804-822) seeds a fresh occurrence scope when it receives
 * `None`; a scope passed down from an outer list is shared. `null` therefore
 * means "no scope yet", never "empty map".
 */
function hydrateElementList(
  elements: unknown[],
  content: unknown,
  directValue: boolean,
  nameOccurrences: Map<string, number> | null,
): unknown[] {
  const scoped = nameOccurrences ?? new Map<string, number>();
  return elements.map((element) =>
    hydrateElement(element, content, directValue, scoped),
  );
}

function hydrateElement(
  element: unknown,
  content: unknown,
  directValue: boolean,
  nameOccurrences: Map<string, number> | null,
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
    const preferred =
      nameOccurrences !== null
        ? repeatedContentKeys(name, contentValues, nameOccurrences)
        : undefined;
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
    updated.children = hydrateChildren(
      children,
      value,
      nestedContent,
      nestedDirectValue,
      nestedOccurrences,
      elementType === "group",
    );
    return updated;
  }

  return clone(record);
}

/**
 * The engine's `_apply_template_content_to_children` (presentation.py:732-761):
 * when the matched value is an array, the children become one repeated copy per
 * item (each item is the child's direct value); otherwise the element list
 * hydrates normally. `centerWhenReduced` is the engine's group-only centering
 * (`center_repeated_children=element_type == "group"`).
 */
function hydrateChildren(
  children: unknown[],
  value: unknown,
  content: unknown,
  directValue: boolean,
  nameOccurrences: Map<string, number> | null,
  centerWhenReduced: boolean,
): unknown[] {
  if (Array.isArray(value) && children.length > 0) {
    /* The engine's repeated items hydrate with `name_occurrences=None`
       (presentation.py:743-752): no occurrence scope crosses into an item, so
       a nested list starts fresh instead of inheriting the outer count. */
    return value.map((item, index) =>
      hydrateElement(
        repeatedChildForIndex(
          children,
          index,
          value.length,
          centerWhenReduced,
        ),
        item,
        true,
        null,
      ),
    );
  }
  return hydrateElementList(children, content, directValue, nameOccurrences);
}

/** content.py:12-23 — which template child a repeated item copies. */
function repeatedChildSourceIndex(
  index: number,
  templateCount: number,
  contentCount: number,
  centerWhenReduced: boolean,
): number {
  if (centerWhenReduced && contentCount < templateCount) {
    return Math.floor((templateCount - contentCount) / 2) + index;
  }
  return Math.min(index, templateCount - 1);
}

/**
 * The engine's `_repeated_child_for_index` (presentation.py:764-784): deep-copy
 * the source child, drop the manual-position marker, and re-suffix names when
 * the content adds items beyond the template's children.
 */
function repeatedChildForIndex(
  children: unknown[],
  index: number,
  contentCount: number,
  centerWhenReduced: boolean,
): unknown {
  const sourceIndex = repeatedChildSourceIndex(
    index,
    children.length,
    contentCount,
    centerWhenReduced,
  );
  const source = clone(children[sourceIndex]);
  const record = asRecord(source);
  if (!record) return source;
  delete record.__presenton_manual_position;
  if (index >= children.length) normalizeRepeatedNames(source, index);
  return source;
}

/** presentation.py:787-801 — `_<digits>` tokens become the item's number. */
function normalizeRepeatedNames(value: unknown, index: number): void {
  if (Array.isArray(value)) {
    for (const item of value) normalizeRepeatedNames(item, index);
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  if (typeof record.name === "string") {
    record.name = record.name.replace(/_\d+(?=_|$)/g, `_${index + 1}`);
  }
  for (const nested of Object.values(record)) {
    normalizeRepeatedNames(nested, index);
  }
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

/** The engine's inline-markdown delimiters (presentation.py:515-520). */
const STRONG_MARKDOWN_DELIMITERS = ["**", "__"];
const EMPHASIS_MARKDOWN_DELIMITERS = ["*", "_"];
const MARKDOWN_DELIMITERS = [
  ...STRONG_MARKDOWN_DELIMITERS,
  ...EMPHASIS_MARKDOWN_DELIMITERS,
];

/** latex_text.py:134-148 — the engine's stored LaTeX normalization. */
function normalizeLatex(value: string): string {
  const normalized = value.trim();
  if (
    normalized.startsWith("$$") &&
    normalized.endsWith("$$") &&
    normalized.length > 4
  ) {
    return normalized.slice(2, -2).trim().slice(0, 4000);
  }
  if (
    normalized.startsWith("\\[") &&
    normalized.endsWith("\\]") &&
    normalized.length > 4
  ) {
    return normalized.slice(2, -2).trim().slice(0, 4000);
  }
  return normalized.slice(0, 4000);
}

const TAG_NAME_END = /[\t\n\r\f />]/;

type ScannedStartTag = {
  name: string;
  raw: string;
  selfClosing: boolean;
  end: number;
};

/** The tolerant whole-start-tag scan (html.parser `locatetagend`). */
function readStartTag(text: string, i: number): ScannedStartTag | null {
  const n = text.length;
  let j = i + 1;
  if (j >= n || !/[a-zA-Z]/.test(text[j])) return null;
  const nameStart = j;
  j += 1;
  while (j < n && !TAG_NAME_END.test(text[j])) j += 1;
  const name = text.slice(nameStart, j).toLowerCase();
  while (j < n) {
    let k = j;
    while (
      k < n &&
      /[\t\n\r\f /]/.test(text[k]) &&
      !(text[k] === "/" && text[k + 1] === ">")
    ) {
      k += 1;
    }
    if (k >= n) return null;
    if (text[k] === ">") {
      return { name, raw: text.slice(i, k + 1), selfClosing: false, end: k + 1 };
    }
    if (text[k] === "/" && text[k + 1] === ">") {
      return { name, raw: text.slice(i, k + 2), selfClosing: true, end: k + 2 };
    }
    let nameEnd = k + 1;
    while (nameEnd < n && !/[\t\n\r\f /=>]/.test(text[nameEnd])) nameEnd += 1;
    let p = nameEnd;
    while (p < n && /[\t\n\r\f ]/.test(text[p])) p += 1;
    let valueEnd = nameEnd;
    if (p < n && text[p] === "=") {
      p += 1;
      while (p < n && /[\t\n\r\f ]/.test(text[p])) p += 1;
      if (p >= n) return null;
      if (text[p] === "'" || text[p] === '"') {
        const close = text.indexOf(text[p], p + 1);
        if (close === -1) return null;
        valueEnd = close + 1;
      } else {
        valueEnd = p;
        while (valueEnd < n && !/[>\t\n\r\f ]/.test(text[valueEnd])) valueEnd += 1;
      }
    }
    j = valueEnd;
  }
  return null;
}

type ScannedEndTag = {
  name?: string;
  ignored?: boolean;
  bogus?: boolean;
  data?: string;
  end: number;
};

/** The tolerant end-tag scan (html.parser `parse_endtag`). */
function readEndTag(text: string, i: number): ScannedEndTag | null {
  const n = text.length;
  const gt = text.indexOf(">", i + 2);
  if (gt === -1) return null;
  const first = text[i + 2];
  if (first === undefined) return null;
  if (!/[a-zA-Z]/.test(first)) {
    if (first === ">") return { ignored: true, end: i + 3 };
    return { bogus: true, data: text.slice(i + 2, gt), end: gt + 1 };
  }
  let j = i + 3;
  while (j < n && !/[\t\n\r\f />]/.test(text[j])) j += 1;
  return { name: text.slice(i + 2, j).toLowerCase(), end: gt + 1 };
}

/**
 * The engine's `parse_latex_tags` (latex_text.py:8-89), a bounded port of the
 * HTMLParser walk it uses: `<latex>…</latex>` spans become latex runs,
 * surrounding/other tags stay raw text, nested or unclosed latex is invalid
 * (null) exactly like the engine, and an input with no latex tag answers null.
 */
function parseLatexTags(text: string): JsonRecord[] | null {
  const runs: JsonRecord[] = [];
  const buffer: string[] = [];
  let inLatex = false;
  let sawLatex = false;
  let invalid = false;

  const isLatexRun = (run: JsonRecord): boolean => run.type === "latex";
  const pushRun = (run: JsonRecord): void => {
    const previous = runs.length > 0 ? runs[runs.length - 1] : null;
    if (previous !== null && isLatexRun(previous) === isLatexRun(run)) {
      const key = isLatexRun(run) ? "latex" : "text";
      previous[key] = String(previous[key] ?? "") + String(run[key] ?? "");
      return;
    }
    runs.push(run);
  };
  const flush = (): void => {
    const content = buffer.join("");
    buffer.length = 0;
    if (content === "") return;
    if (inLatex) {
      const latex = normalizeLatex(content);
      if (latex === "") {
        invalid = true;
        return;
      }
      pushRun({ type: "latex", latex });
      return;
    }
    pushRun({ text: content });
  };

  const n = text.length;
  let i = 0;
  while (i < n) {
    const lt = text.indexOf("<", i);
    if (lt === -1) {
      buffer.push(text.slice(i));
      break;
    }
    if (lt > i) buffer.push(text.slice(i, lt));
    i = lt;

    if (/[a-zA-Z]/.test(text[i + 1] ?? "")) {
      const tag = readStartTag(text, i);
      if (tag === null) {
        i = n; // Incomplete start tag: the parse drops the remainder.
        continue;
      }
      i = tag.end;
      if (tag.selfClosing || tag.name !== "latex") {
        buffer.push(tag.raw);
      } else if (inLatex) {
        invalid = true;
      } else {
        flush();
        inLatex = true;
        sawLatex = true;
      }
      continue;
    }

    if (text.startsWith("</", i)) {
      const tag = readEndTag(text, i);
      if (tag === null) {
        if (i + 2 === n) buffer.push("</");
        else if (!/[a-zA-Z]/.test(text[i + 2] ?? "")) {
          buffer.push(`<!--${text.slice(i + 2)}-->`);
        }
        i = n;
        continue;
      }
      i = tag.end;
      if (tag.ignored) continue;
      if (tag.bogus) {
        buffer.push(`<!--${tag.data}-->`);
        continue;
      }
      if (tag.name === "latex") {
        if (!inLatex) invalid = true;
        else {
          flush();
          inLatex = false;
        }
      } else {
        buffer.push(`</${tag.name}>`);
      }
      continue;
    }

    if (text.startsWith("<!--", i)) {
      const rest = text.slice(i + 4);
      const close = /--!?>/.exec(rest);
      if (close !== null) {
        buffer.push(`<!--${rest.slice(0, close.index)}-->`);
        i = i + 4 + close.index + close[0].length;
        continue;
      }
      const abrupt = /-?>/.exec(rest);
      if (abrupt !== null && abrupt.index === 0) {
        buffer.push("<!---->");
        i = i + 4 + abrupt[0].length;
        continue;
      }
      let j = n;
      for (const suffix of ["--!", "--", "-"]) {
        if (text.endsWith(suffix) && text.length - suffix.length >= i + 4) {
          j = text.length - suffix.length;
          break;
        }
      }
      buffer.push(`<!--${text.slice(i + 4, j)}-->`);
      i = n;
      continue;
    }

    if (text.startsWith("<![CDATA[", i)) {
      const close = text.indexOf("]]>", i + 9);
      i = close === -1 ? n : close + 3; // unknown_decl drops the section
      continue;
    }

    if (text.slice(i, i + 9).toLowerCase() === "<!doctype") {
      const gt = text.indexOf(">", i + 9);
      if (gt === -1) {
        buffer.push(`<!${text.slice(i + 2)}>`);
        i = n;
      } else {
        buffer.push(`<!${text.slice(i + 2, gt)}>`);
        i = gt + 1;
      }
      continue;
    }

    if (text.startsWith("<!", i)) {
      const gt = text.indexOf(">", i + 2);
      if (gt === -1) {
        buffer.push(`<!--${text.slice(i + 2)}-->`);
        i = n;
      } else {
        buffer.push(`<!--${text.slice(i + 2, gt)}-->`);
        i = gt + 1;
      }
      continue;
    }

    if (text.startsWith("<?", i)) {
      const gt = text.indexOf(">", i + 2);
      i = gt === -1 ? n : gt + 1; // handle_pi drops the instruction
      continue;
    }

    buffer.push("<");
    i += 1;
  }

  if (inLatex) invalid = true;
  flush();
  if (invalid || !sawLatex) return null;
  return runs;
}

/** latex_text.py:151-211 — `replace_text_runs` and its run builders. */
function isLatexRun(run: JsonRecord): boolean {
  return run.type === "latex";
}

function applyFallbackFont(run: JsonRecord, fallbackFont: unknown): void {
  if (asRecord(fallbackFont) && !asRecord(run.font)) {
    run.font = clone(fallbackFont as JsonRecord);
  }
}

function replaceSingleRun(
  template: JsonRecord | null,
  value: string,
  fallbackFont: unknown,
): JsonRecord {
  const run = template ? clone(template) : {};
  applyFallbackFont(run, fallbackFont);
  if (isLatexRun(run)) {
    run.latex = normalizeLatex(value);
    delete run.text;
  } else {
    run.text = value;
  }
  return run;
}

function matchingTemplateRun(
  templates: JsonRecord[],
  parsedRun: JsonRecord,
  index: number,
): JsonRecord | null {
  const latex = isLatexRun(parsedRun);
  if (index < templates.length && isLatexRun(templates[index]) === latex) {
    return templates[index];
  }
  for (const template of templates) {
    if (isLatexRun(template) === latex) return template;
  }
  if (index < templates.length) return templates[index];
  return templates.length > 0 ? templates[0] : null;
}

function buildParsedRun(
  parsedRun: JsonRecord,
  template: JsonRecord | null,
  fallbackFont: unknown,
): JsonRecord {
  const run = template ? clone(template) : {};
  applyFallbackFont(run, fallbackFont);
  if (isLatexRun(parsedRun)) {
    const wasLatex = isLatexRun(run);
    run.type = "latex";
    run.latex = parsedRun.latex;
    delete run.text;
    if (!wasLatex) run.display_mode = false;
  } else {
    delete run.type;
    delete run.latex;
    delete run.display_mode;
    run.text = parsedRun.text;
  }
  return run;
}

function replaceTextRuns(
  existingRuns: unknown,
  value: string,
  fallbackFont: unknown,
): JsonRecord[] {
  const parsedRuns = parseLatexTags(value);
  const templates = Array.isArray(existingRuns)
    ? existingRuns.filter((run) => asRecord(run) !== null)
    : [];
  if (parsedRuns === null) {
    return [
      replaceSingleRun(templates.length > 0 ? templates[0] : null, value, fallbackFont),
    ];
  }
  return parsedRuns.map((parsedRun, index) =>
    buildParsedRun(
      parsedRun,
      matchingTemplateRun(templates, parsedRun, index),
      fallbackFont,
    ),
  );
}

/** presentation.py:1195-1245 — `_parse_template_markdown_text`. */
function parseTemplateMarkdownText(
  text: string,
): Array<[string, Record<string, boolean>]> {
  const parsed: Array<[string, Record<string, boolean>]> = [];
  let index = 0;
  const readDelimiter = (delimiters: string[]): string | null => {
    for (const delimiter of delimiters) {
      if (text.startsWith(delimiter, index)) return delimiter;
    }
    return null;
  };
  while (index < text.length) {
    const strong = readDelimiter(STRONG_MARKDOWN_DELIMITERS);
    if (strong !== null) {
      const close = text.indexOf(strong, index + strong.length);
      if (close > index + strong.length) {
        parsed.push([text.slice(index + strong.length, close), { bold: true }]);
        index = close + strong.length;
        continue;
      }
    }
    const emphasis = readDelimiter(EMPHASIS_MARKDOWN_DELIMITERS);
    if (emphasis !== null) {
      const close = text.indexOf(emphasis, index + emphasis.length);
      if (close > index + emphasis.length) {
        parsed.push([
          text.slice(index + emphasis.length, close),
          { italic: true },
        ]);
        index = close + emphasis.length;
        continue;
      }
    }
    let next = -1;
    for (const delimiter of MARKDOWN_DELIMITERS) {
      const found = text.indexOf(delimiter, index + 1);
      if (found !== -1 && (next === -1 || found < next)) next = found;
    }
    parsed.push([text.slice(index, next === -1 ? text.length : next), {}]);
    index = next === -1 ? text.length : next;
  }
  return parsed;
}

/** Key-order-insensitive JSON equality (the engine compares dicts). */
function sameJsonValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((value, index) => sameJsonValue(value, b[index]));
  }
  const recordA = asRecord(a);
  const recordB = asRecord(b);
  if (recordA || recordB) {
    if (!recordA || !recordB) return false;
    const keys = Object.keys(recordA);
    if (keys.length !== Object.keys(recordB).length) return false;
    return keys.every(
      (key) => key in recordB && sameJsonValue(recordA[key], recordB[key]),
    );
  }
  return false;
}

/** presentation.py:1271-1287 — `_append_template_text_run` (merge adjacent). */
function appendTemplateTextRun(textRuns: JsonRecord[], run: JsonRecord): void {
  const text = run.text;
  if (typeof text !== "string" || text === "") return;
  const previous = textRuns.length > 0 ? textRuns[textRuns.length - 1] : null;
  if (previous !== null && typeof previous.text === "string") {
    const previousStyle: JsonRecord = {};
    for (const [key, value] of Object.entries(previous)) {
      if (key !== "text") previousStyle[key] = value;
    }
    const nextStyle: JsonRecord = {};
    for (const [key, value] of Object.entries(run)) {
      if (key !== "text") nextStyle[key] = value;
    }
    if (sameJsonValue(previousStyle, nextStyle)) {
      previous.text += text;
      return;
    }
  }
  textRuns.push(run);
}

/** presentation.py:1172-1192 — `_template_base_run_for_markdown`. */
function templateBaseRunForMarkdown(
  baseRun: JsonRecord,
  fallbackFont: unknown,
  stripInlineEmphasis: boolean,
): JsonRecord {
  const font = baseRun.font;
  const fallback = asRecord(fallbackFont);
  if (fallback) {
    baseRun.font = {
      ...clone(fallback),
      ...(asRecord(font) ? clone(font as JsonRecord) : {}),
    };
  } else if (asRecord(font)) {
    baseRun.font = clone(font as JsonRecord);
  }
  if (stripInlineEmphasis && asRecord(baseRun.font)) {
    delete (baseRun.font as JsonRecord).bold;
    delete (baseRun.font as JsonRecord).italic;
  }
  return baseRun;
}

/**
 * The engine's `_template_text_runs_from_markdown` (presentation.py:1131-1169):
 * a LaTeX-tagged (or LaTeX-typed) value keeps the run's style through
 * `replace_text_runs`; otherwise inline `**`/`__`/`*`/`_` emphasis splits the
 * text into runs over the first run's style (emphasis stripped from the base
 * when any style applies), adjacent equal-style runs merge, and an empty parse
 * falls back to a single space run.
 */
function templateTextRunsFromMarkdown(
  text: string,
  firstRun: unknown,
  fallbackFont: unknown,
): JsonRecord[] {
  const first = asRecord(firstRun) ?? {};
  const parsedLatex = parseLatexTags(text);
  if (parsedLatex !== null || first.type === "latex") {
    return replaceTextRuns([first], text, fallbackFont);
  }

  const parsed = parseTemplateMarkdownText(text);
  const hasMarkdownStyle = parsed.some(
    ([, style]) => Object.keys(style).length > 0,
  );
  const base = templateBaseRunForMarkdown(
    clone(first),
    fallbackFont,
    hasMarkdownStyle,
  );

  const textRuns: JsonRecord[] = [];
  for (const [parsedText, style] of parsed) {
    const run = clone(base);
    run.text = parsedText;
    if (Object.keys(style).length > 0) {
      run.font = {
        ...(asRecord(run.font) ? clone(run.font as JsonRecord) : {}),
        ...clone(style),
      };
    }
    appendTemplateTextRun(textRuns, run);
  }
  if (textRuns.length > 0) return textRuns;
  return [{ ...base, text: " " }];
}

function applyTextContent(element: JsonRecord, value: unknown): JsonRecord {
  const text = readTemplateText(value);
  if (text === null || text === "") return clone(element);
  const updated = clone(element);
  updated.runs = templateTextRunsFromMarkdown(text, firstTextRun(element.runs), element.font);
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
    items.push(templateTextRunsFromMarkdown(text, firstRun, element.font));
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
      runs: templateTextRunsFromMarkdown(text, { font: clone(defaultFont) }, null),
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
  updated.runs = templateTextRunsFromMarkdown(text, firstRun, nextFont);
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
