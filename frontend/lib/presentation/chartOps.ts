/**
 * Pure chart-data operations for the native editor (Task D5, spec §5.4
 * "Charts" row, §6.6).
 *
 * The wire model is `ChartElement` (types.ts): `chart_type`, `title`,
 * `categories`, `series`, `colors`, the four axis/grid booleans, `data_labels`
 * and the styling colors. This module is the only place the editor changes
 * those fields — every function is immutable, bounds-safe and answers the same
 * element reference when the write would be a no-op, so `slide_update` never
 * fires for a non-edit.
 *
 * Semantics mirror the renderer's `chartConfig` (elements.ts), which reads the
 * same fields:
 *
 * - `readChartSeries` applies the renderer's normalization (named, finite
 *   values; malformed entries surface honestly through it);
 * - row count follows `chartLabels`: the longest of categories and every
 *   series' values, capped at 24 (the fork's bound);
 * - pie and donut render only the first series (`chartSeriesSupportsMultiple`),
 *   so adding series is refused for them;
 * - `chartHasAxes` is false for pie, donut and polar_area — the renderer draws
 *   no scales, so the editor disables the toggles and says so;
 * - the palette precedence is the renderer's: explicit `colors`, then the
 *   theme's `graph_0…graph_9` roles, then the fork's defaults. `setChartColor`
 *   seeds the context around a written slot from that same precedence, so
 *   writing one color never changes how any other slot renders.
 *
 * Malformed values are never fabricated into chart data: only the edited
 * field is materialized (with the renderer's own fallback label where a gap
 * must be filled), and everything else is left byte-for-byte.
 */
import { DEFAULT_CHART_COLORS, normalizeChartColor } from "./elements";
import type {
  ChartElement,
  ChartSeries,
  ChartType,
  DataLabelPosition,
  DeckThemeColors,
} from "./types";

/** The fork's text bound (`CHART_TEXT_MAX_LENGTH` in its `chart-data.ts`). */
export const CHART_TEXT_MAX_LENGTH = 128;
/** The fork's data-grid bounds: 24 rows, 12 series, 12 palette slots. */
export const CHART_ROW_LIMIT = 24;
export const CHART_SERIES_LIMIT = 12;
export const CHART_COLOR_LIMIT = 12;

/** Every wire `chart_type` with the fork's own label. */
export const CHART_TYPE_OPTIONS: ReadonlyArray<{
  value: ChartType;
  label: string;
}> = [
  { value: "bar", label: "Bar chart" },
  { value: "horizontal_bar", label: "Horizontal bar" },
  { value: "stacked_bar", label: "Stacked bar" },
  { value: "horizontal_stacked_bar", label: "Horizontal stacked bar" },
  { value: "line", label: "Line chart" },
  { value: "area", label: "Area chart" },
  { value: "pie", label: "Pie chart" },
  { value: "donut", label: "Donut chart" },
  { value: "scatter", label: "Scatter chart" },
  { value: "radar", label: "Radar chart" },
  { value: "polar_area", label: "Polar area" },
];

/** The four `data_labels` positions the wire can store, plus the off state. */
export const DATA_LABEL_OPTIONS: ReadonlyArray<{
  value: DataLabelPosition;
  label: string;
}> = [
  { value: "base", label: "Base" },
  { value: "mid", label: "Middle" },
  { value: "top", label: "Top" },
  { value: "outside", label: "Outside" },
];

/** The element fields `applyChartField` may write (the editor's direct set). */
export type ChartFieldPatch =
  | { field: "title"; value: string | null }
  | { field: "chart_type"; value: ChartType }
  | { field: "data_labels"; value: DataLabelPosition | null }
  | {
      field: "x_axis" | "y_axis" | "x_axis_grid" | "y_axis_grid";
      value: boolean | null;
    };

/**
 * Applies one scalar field write. Title whitespace normalizes to `null`
 * (the renderer trims and treats empty as no title); every other field is
 * stored exactly as given. Same-value writes return the element untouched.
 */
export function applyChartField(
  element: ChartElement,
  patch: ChartFieldPatch,
): ChartElement {
  switch (patch.field) {
    case "title": {
      const next =
        typeof patch.value === "string" && patch.value.trim() !== ""
          ? patch.value
          : null;
      const current =
        typeof element.title === "string" && element.title.trim() !== ""
          ? element.title
          : null;
      return next === current ? element : { ...element, title: next };
    }
    case "chart_type": {
      if ((element.chart_type as unknown) === patch.value) return element;
      return { ...element, chart_type: patch.value };
    }
    case "data_labels": {
      if ((element.data_labels ?? null) === patch.value) return element;
      return { ...element, data_labels: patch.value };
    }
    default: {
      if ((element[patch.field] ?? null) === patch.value) return element;
      return { ...element, [patch.field]: patch.value };
    }
  }
}

/** The renderer's multiple-series rule (pie and donut use the first series). */
export function chartSeriesSupportsMultiple(chartType: ChartType): boolean {
  return chartType !== "pie" && chartType !== "donut";
}

/** Whether the chart type draws scales the axis/grid toggles control. */
export function chartHasAxes(chartType: ChartType): boolean {
  return (
    chartType !== "pie" && chartType !== "donut" && chartType !== "polar_area"
  );
}

/**
 * The toggle labels for a chart type: radar maps the same wire fields onto its
 * radial parts (the fork's "category labels"/"spokes"/"value labels"/"rings"),
 * every other axis-bearing type onto the cartesian pair.
 */
export function chartAxisLabels(chartType: ChartType): {
  xAxis: string;
  xGrid: string;
  yAxis: string;
  yGrid: string;
} {
  if (chartType === "radar") {
    return {
      xAxis: "Category labels",
      xGrid: "Spokes",
      yAxis: "Value labels",
      yGrid: "Rings",
    };
  }
  return {
    xAxis: "Show X axis",
    xGrid: "Show X grid",
    yAxis: "Show Y axis",
    yGrid: "Show Y grid",
  };
}

/** A series as the renderer normalizes it (named, finite values kept in order). */
export type ChartSeriesView = { name: string; values: number[] };

/** The renderer's `readOptionalNumber`: finite numbers and numeric strings. */
function readSeriesValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/** The renderer's `normalizeChartData` series pass, plus empty-valued entries. */
export function readChartSeries(element: ChartElement): ChartSeriesView[] {
  const raw = Array.isArray(element.series) ? element.series : [];
  const series: ChartSeriesView[] = [];
  raw.forEach((entry, index) => {
    if (typeof entry !== "object" || entry === null) return;
    const record = entry as ChartSeries;
    series.push({
      name:
        typeof record.name === "string" && record.name.trim() !== ""
          ? record.name.trim()
          : `Series ${index + 1}`,
      values: Array.isArray(record.values)
        ? record.values.map((value) => readSeriesValue(value))
        : [],
    });
  });
  return series;
}

/** The raw category strings at their stored positions; non-strings read empty. */
export function readChartCategories(element: ChartElement): string[] {
  const raw = Array.isArray(element.categories) ? element.categories : [];
  return raw.map((value) => (typeof value === "string" ? value : ""));
}

/** The renderer's fallback label for a category that stores no text. */
export function categoryPlaceholder(index: number): string {
  return `Value ${index + 1}`;
}

/**
 * The stored row width (categories vs the longest series), uncapped. The
 * renderer caps its label count at 24 and the editor exposes the same 24 rows
 * (`chartRowCount`); row writers use this raw width so a series that stores
 * more values than the renderer draws is never truncated by an unrelated
 * edit.
 */
function rawChartRowCount(element: ChartElement): number {
  const categoryCount = readChartCategories(element).length;
  const valueCount = Math.max(
    0,
    ...readChartSeries(element).map((entry) => entry.values.length),
  );
  return Math.max(categoryCount, valueCount);
}

/**
 * The rendered row count: the longest of categories and series values, capped
 * at the renderer's 24-label bound (`chartLabels` in elements.ts). A chart
 * with no categories and no values answers 0 — the editor shows its honest
 * empty state, since the renderer draws no data for it.
 */
export function chartRowCount(element: ChartElement): number {
  return Math.min(CHART_ROW_LIMIT, rawChartRowCount(element));
}

function isIndex(value: number, length: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < length;
}

/**
 * Writes one category. An index at or past the stored array materializes the
 * gaps with the renderer's own fallback labels (`Value N`), so filling a
 * rendered-but-unstored cell writes exactly what was displayed. The new text
 * is capped at the fork's 128 characters.
 */
export function setCategory(
  element: ChartElement,
  index: number,
  text: string,
): ChartElement {
  if (!Number.isInteger(index) || index < 0 || index >= CHART_ROW_LIMIT) {
    return element;
  }
  const next = (typeof text === "string" ? text : "").slice(
    0,
    CHART_TEXT_MAX_LENGTH,
  );
  const categories = readChartCategories(element);
  if (index < categories.length && categories[index] === next) return element;
  const padded = Array.from(
    { length: Math.max(categories.length, index + 1) },
    (_, position) => categories[position] ?? categoryPlaceholder(position),
  );
  padded[index] = next;
  return { ...element, categories: padded };
}

/** Writes one series name (capped like every other chart text field). */
export function setSeriesName(
  element: ChartElement,
  seriesIndex: number,
  name: string,
): ChartElement {
  const series = readChartSeries(element);
  if (!isIndex(seriesIndex, series.length)) return element;
  const next = (typeof name === "string" ? name : "").slice(
    0,
    CHART_TEXT_MAX_LENGTH,
  );
  if (series[seriesIndex].name === next) return element;
  return {
    ...element,
    series: series.map((entry, index) =>
      index === seriesIndex ? { ...entry, name: next } : entry,
    ),
  };
}

/**
 * Writes one series value. The addressable range is the rendered grid
 * (`chartRowCount`): an index at or past a series' stored value list pads that
 * series with the zeros the renderer already draws, exactly like
 * `setCategory` materializes its gaps — so a cell the grid shows as `0` can
 * be edited instead of silently discarding the write. Only finite numbers and
 * addresses inside the rendered grid are representable; anything else is
 * refused with the same reference.
 */
export function setSeriesValue(
  element: ChartElement,
  seriesIndex: number,
  valueIndex: number,
  value: number,
): ChartElement {
  if (typeof value !== "number" || !Number.isFinite(value)) return element;
  const series = readChartSeries(element);
  const entry = series[seriesIndex];
  if (entry === undefined) return element;
  if (!Number.isInteger(valueIndex) || valueIndex < 0) return element;
  if (valueIndex >= chartRowCount(element)) return element;
  if (entry.values[valueIndex] === value) return element;
  const nextValues = entry.values.slice();
  while (nextValues.length <= valueIndex) nextValues.push(0);
  nextValues[valueIndex] = value;
  return {
    ...element,
    series: series.map((candidate, index) =>
      index === seriesIndex ? { ...candidate, values: nextValues } : candidate,
    ),
  };
}

function padValues(values: number[], length: number): number[] {
  return Array.from({ length }, (_, index) => values[index] ?? 0);
}

/**
 * Appends one data row: a new category (`Item N`, the fork's own add-row
 * label) and a zero on every series, so the stored arrays stay rectangular.
 * Refused at the fork's 24-row bound. With no series stored the category row
 * is still appended — the editor states that no series exist rather than
 * inventing one.
 */
export function addChartRow(element: ChartElement): ChartElement {
  const rowCount = rawChartRowCount(element);
  if (rowCount >= CHART_ROW_LIMIT) return element;
  const categories = readChartCategories(element);
  const nextCategories = Array.from(
    { length: rowCount + 1 },
    (_, index) =>
      categories[index] ??
      (index === rowCount ? `Item ${rowCount + 1}` : categoryPlaceholder(index)),
  );
  const series = readChartSeries(element).map((entry) => ({
    name: entry.name,
    values: [...padValues(entry.values, rowCount), 0],
  }));
  return {
    ...element,
    categories: nextCategories,
    ...(series.length > 0 ? { series } : {}),
  };
}

/**
 * Removes one data row from categories and every series. The last remaining
 * row is kept (a chart with no rows has nothing to render or edit). Rows past
 * a shorter series' length simply have no value to drop.
 */
export function removeChartRow(
  element: ChartElement,
  rowIndex: number,
): ChartElement {
  const rowCount = rawChartRowCount(element);
  if (rowCount <= 1) return element;
  if (!isIndex(rowIndex, rowCount)) return element;
  const categories = readChartCategories(element);
  const removedCategory = rowIndex < categories.length;
  const series = readChartSeries(element);
  let changed = removedCategory;
  const nextSeries = series.map((entry) => {
    if (rowIndex >= entry.values.length) return entry;
    changed = true;
    return {
      ...entry,
      values: entry.values.filter((_, index) => index !== rowIndex),
    };
  });
  if (!changed) return element;
  return {
    ...element,
    categories: removedCategory
      ? categories.filter((_, index) => index !== rowIndex)
      : categories,
    ...(series.length > 0 ? { series: nextSeries } : {}),
  };
}

/**
 * Appends one series (`Series N`) with zero values across the current rows.
 * Refused for pie and donut (only the first series renders) and at the fork's
 * 12-series bound. With no rows the series stores an empty value list — the
 * renderer skips it until a row exists, honestly.
 */
export function addChartSeries(element: ChartElement): ChartElement {
  if (!chartSeriesSupportsMultiple(element.chart_type)) return element;
  const series = readChartSeries(element);
  if (series.length >= CHART_SERIES_LIMIT) return element;
  const rowCount = chartRowCount(element);
  return {
    ...element,
    series: [
      ...series,
      {
        name: `Series ${series.length + 1}`,
        values: padValues([], rowCount),
      },
    ],
  };
}

/** Removes one series; the last remaining series is kept. */
export function removeChartSeries(
  element: ChartElement,
  seriesIndex: number,
): ChartElement {
  const series = readChartSeries(element);
  if (series.length <= 1) return element;
  if (!isIndex(seriesIndex, series.length)) return element;
  return {
    ...element,
    series: series.filter((_, index) => index !== seriesIndex),
  };
}

/** The palette a chart renders with when the element stores no `colors`. */
export function chartThemePalette(
  themeColors?: Partial<DeckThemeColors> | null,
): string[] {
  const roles = [
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
  const colors = roles
    .map((role) => normalizeChartColor(themeColors?.[role]))
    .filter((color): color is string => color !== null);
  return colors.length > 0 ? colors : [...DEFAULT_CHART_COLORS];
}

function paletteFor(themePalette?: readonly string[] | null): string[] {
  const valid = (themePalette ?? [])
    .map((color) => normalizeChartColor(color))
    .filter((color): color is string => color !== null);
  return valid.length > 0 ? valid : [...DEFAULT_CHART_COLORS];
}

/** The element's stored explicit colors, invalid entries dropped (renderer parity). */
function readExplicitColors(element: ChartElement): string[] {
  const raw = Array.isArray(element.colors) ? element.colors : [];
  return raw
    .map((color) => normalizeChartColor(color))
    .filter((color): color is string => color !== null);
}

/** How the palette indexes: one color per series, or one per category. */
export function chartColorTargetMode(
  element: ChartElement,
): "series" | "category" {
  return chartSeriesSupportsMultiple(element.chart_type) &&
    readChartSeries(element).length > 1
    ? "series"
    : "category";
}

/**
 * The renderer's `seriesColor` precedence at one index: explicit colors cycle
 * **exclusively** when any are stored, otherwise the theme/deck palette does.
 * `chartColorSlots` and `setChartColor` share this rule so a chip always shows
 * the color the dataset actually draws.
 */
function effectivePaletteColor(
  explicit: string[],
  themePalette: readonly string[] | null | undefined,
  index: number,
): string {
  if (explicit.length > 0) return explicit[index % explicit.length];
  const palette = paletteFor(themePalette);
  return palette[index % palette.length];
}

export type ChartColorSlot = {
  index: number;
  /** The series or category the slot colors (the fork's target labels). */
  label: string;
  color: string;
  /** True when the element stores this color explicitly. */
  explicit: boolean;
};

/**
 * The editable palette slots: one per series (multi-series charts) or per
 * category, capped at the fork's 12 slots. The effective color follows the
 * renderer's `seriesColor` precedence — explicit colors (cycling exclusively
 * when present), then the theme's graph roles, then the fork's defaults — so
 * the chip and the drawn dataset always agree. Residual: a rendered slot
 * beyond the 12-chip cap keeps the renderer's own cycling and is not editable
 * here.
 */
export function chartColorSlots(
  element: ChartElement,
  themePalette?: readonly string[] | null,
): ChartColorSlot[] {
  const explicit = readExplicitColors(element);
  const mode = chartColorTargetMode(element);
  const series = readChartSeries(element);
  const categories = readChartCategories(element);
  const needed =
    mode === "series"
      ? series.length
      : Math.max(
          categories.length,
          ...series.map((entry) => entry.values.length),
        );
  const count = Math.min(
    CHART_COLOR_LIMIT,
    Math.max(1, needed, explicit.length),
  );
  return Array.from({ length: count }, (_, index) => ({
    index,
    label:
      mode === "series"
        ? (series[index]?.name ?? `Series ${index + 1}`)
        : categories[index] && categories[index].trim() !== ""
          ? categories[index]
          : categoryPlaceholder(index),
    color: effectivePaletteColor(explicit, themePalette, index),
    explicit: index < explicit.length,
  }));
}

/**
 * Writes one explicit palette slot. `null` removes the slot (later explicit
 * colors shift left, like the fork's delete).
 *
 * A written color materializes the whole exposed slot set
 * (`chartColorSlots(...).length`, at least `index + 1`, capped at
 * `CHART_COLOR_LIMIT`) from the effective palette first: the renderer's
 * non-empty `colors` array cycles exclusively, so an array shorter than the
 * rendered slot count would recolor every later slot. Materializing the full
 * exposed set keeps every other slot's rendered color exactly as it was, and
 * the chip list (which cycles the same way) keeps reporting what is drawn.
 * Slots beyond the 12-slot cap stay under the renderer's own cycling and are
 * not editable here. Invalid colors and out-of-range slots are refused with
 * the same reference.
 */
export function setChartColor(
  element: ChartElement,
  index: number,
  color: string | null,
  themePalette?: readonly string[] | null,
): ChartElement {
  if (!Number.isInteger(index) || index < 0 || index >= CHART_COLOR_LIMIT) {
    return element;
  }
  const explicit = readExplicitColors(element);
  if (color === null) {
    if (index >= explicit.length) return element;
    return {
      ...element,
      colors: explicit.filter((_, position) => position !== index),
    };
  }
  const normalized = normalizeChartColor(color);
  if (normalized === null) return element;
  if (index < explicit.length && explicit[index] === normalized) return element;
  const exposed = chartColorSlots(element, themePalette).length;
  const length = Math.min(
    CHART_COLOR_LIMIT,
    Math.max(index + 1, exposed, explicit.length),
  );
  const next = Array.from({ length }, (_, position) =>
    effectivePaletteColor(explicit, themePalette, position),
  );
  next[index] = normalized;
  return { ...element, colors: next };
}
