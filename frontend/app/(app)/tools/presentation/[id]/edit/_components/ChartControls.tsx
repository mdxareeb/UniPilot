"use client";

/**
 * The chart element's inspector controls (Task D5, spec §5.4 charts row,
 * §6.6, §8.2 "Element toolbars": `MotionPopover` + `IconButton` + `Select` +
 * `Input`).
 *
 * The inspector shows a summary of the selected chart and one trigger that
 * opens the data editor: chart type, title, data labels, the category/series
 * grid, the palette slots and the axis/grid toggles. Every control commits one
 * pure `chartOps` write through the editor's single-slide `slide_update` path
 * with the same autosave + undo as every other edit, so the stage chart
 * re-renders from `chartConfig` on each commit.
 *
 * Honest states (the wire model and the renderer bound what is editable):
 * - pie and donut render only the first series, so adding a series is
 *   disabled and said so;
 * - pie, donut and polar_area draw no scales, so the axis/grid toggles are
 *   disabled with the reason;
 * - a stored `chart_type` outside the eleven-member enum renders as a bar
 *   (the renderer's own fallback) and is labelled, never silently corrected;
 * - category cells the wire does not store show the renderer's fallback label
 *   as a placeholder and are written only when edited;
 * - palette slots seed from the element's explicit colors, then the theme's
 *   `graph_0…graph_9` roles, then the fork defaults.
 *
 * The popover is portalled with fixed positioning computed from the trigger
 * (the editor surface is a `backdrop-blur` glass card where a nested backdrop
 * filter cannot sample the page), like the run toolbar.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { BarChart3, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { MotionPopover } from "@/components/motion/MotionPopover";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import {
  addChartRow,
  addChartSeries,
  applyChartField,
  categoryPlaceholder,
  chartAxisLabels,
  chartColorSlots,
  chartHasAxes,
  chartRowCount,
  chartSeriesSupportsMultiple,
  chartThemePalette,
  CHART_ROW_LIMIT,
  CHART_SERIES_LIMIT,
  CHART_TEXT_MAX_LENGTH,
  CHART_TYPE_OPTIONS,
  DATA_LABEL_OPTIONS,
  readChartCategories,
  readChartSeries,
  removeChartRow,
  removeChartSeries,
  setCategory,
  setChartColor,
  setSeriesName,
  setSeriesValue,
} from "@/lib/presentation/chartOps";
import type {
  ChartElement,
  ChartType,
  DataLabelPosition,
  DeckThemeColors,
} from "@/lib/presentation/types";

export type ChartControlsProps = {
  element: ChartElement;
  /** The deck theme's colors; the graph roles seed the palette editor. */
  themeColors: Partial<DeckThemeColors> | null;
  onUpdate: (
    reason: string,
    updater: (element: ChartElement) => ChartElement,
  ) => void;
};

const PANEL_WIDTH = 420;
/** The fork's color pattern: `#rgb/#rrggbb` and `rgb()/rgba()`. */
const COLOR_PATTERN =
  /^(?:#[0-9a-f]{3}|#[0-9a-f]{6}|rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+(?:\s*,\s*[\d.]+\s*)?\))$/i;

type ChartTypeOption = { value: string; label: string; disabled?: boolean };

/** The stored type plus a disabled entry when the wire carries a non-enum value. */
function chartTypeOptions(element: ChartElement): ChartTypeOption[] {
  const stored = element.chart_type as unknown;
  const known = CHART_TYPE_OPTIONS.some((option) => option.value === stored);
  if (known) {
    return CHART_TYPE_OPTIONS.map((option) => ({ ...option }));
  }
  return [
    {
      value: String(stored),
      label: `Stored “${String(stored)}” — renders as a bar chart`,
      disabled: true,
    },
    ...CHART_TYPE_OPTIONS.map((option) => ({ ...option })),
  ];
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-label-sm text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/**
 * A chart value field: commits a finite number on blur/Enter and reverts
 * malformed text, so a half-typed value never lands on the wire. Values may be
 * negative and fractional (the wire declares no bounds).
 */
function ChartValueField({
  id,
  value,
  disabled = false,
  onCommit,
  dataValue,
}: {
  id: string;
  value: number;
  disabled?: boolean;
  onCommit: (value: number) => void;
  dataValue: string;
}) {
  const [text, setText] = useState(String(value));
  const [lastValue, setLastValue] = useState(value);
  if (lastValue !== value) {
    setLastValue(value);
    setText(String(value));
  }

  const commit = (raw: string) => {
    const parsed = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(parsed)) {
      setText(String(value));
      return;
    }
    setText(String(parsed));
    onCommit(parsed);
  };

  return (
    <Input
      id={id}
      data-editor-chart-value={dataValue}
      size="sm"
      type="number"
      inputMode="decimal"
      step="any"
      value={text}
      aria-label={`Series value ${dataValue}`}
      disabled={disabled}
      onChange={(event) => setText(event.target.value)}
      onBlur={(event) => commit(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}

/**
 * A palette colour field: commits a valid colour on change, clears on empty
 * and reverts malformed text on blur — the same field the icon colour uses.
 */
function ChartColorField({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (color: string) => void;
}) {
  const [text, setText] = useState(value);
  const [lastValue, setLastValue] = useState(value);
  if (lastValue !== value) {
    setLastValue(value);
    setText(value);
  }

  return (
    <Input
      id="editor-chart-color-input"
      data-editor-chart-color-input=""
      size="sm"
      type="text"
      spellCheck={false}
      maxLength={40}
      placeholder="#111827"
      value={text}
      aria-label="Explicit colour"
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        const trimmed = next.trim();
        if (trimmed !== "" && COLOR_PATTERN.test(trimmed)) onCommit(trimmed);
      }}
      onBlur={() => {
        const trimmed = text.trim();
        if (trimmed !== "" && !COLOR_PATTERN.test(trimmed)) setText(value);
      }}
    />
  );
}

export function ChartControls({
  element,
  themeColors,
  onUpdate,
}: ChartControlsProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<{
    style: CSSProperties;
    direction: "up" | "down";
  }>({
    style: { left: -9999, top: -9999, width: PANEL_WIDTH },
    direction: "up",
  });
  const [activeSlotIndex, setActiveSlotIndex] = useState(0);

  const computePosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(PANEL_WIDTH, window.innerWidth - 16);
    const left = Math.max(
      8,
      Math.min(rect.left, window.innerWidth - width - 8),
    );
    const above = rect.top - 8;
    const below = window.innerHeight - rect.bottom - 8;
    const openUp = above >= below;
    const maxHeight = Math.max(240, Math.min(600, openUp ? above : below));
    setPlacement({
      direction: openUp ? "up" : "down",
      style: openUp
        ? { left, width, bottom: window.innerHeight - rect.top + 8, maxHeight }
        : { left, width, top: rect.bottom + 8, maxHeight },
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const update = () => computePosition();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [computePosition, open]);

  const series = readChartSeries(element);
  const categories = readChartCategories(element);
  const rowCount = chartRowCount(element);
  const rows = Array.from({ length: rowCount }, (_, index) => index);
  const supportsMultiple = chartSeriesSupportsMultiple(element.chart_type);
  const hasAxes = chartHasAxes(element.chart_type);
  const axisLabels = chartAxisLabels(element.chart_type);
  const themePalette = chartThemePalette(themeColors);
  const slots = chartColorSlots(element, themePalette);
  const activeSlot =
    slots[Math.min(Math.max(activeSlotIndex, 0), slots.length - 1)] ??
    slots[0] ??
    null;

  const canAddRow = rowCount < CHART_ROW_LIMIT;
  const canRemoveRow = rowCount > 1;
  const canAddSeries = supportsMultiple && series.length < CHART_SERIES_LIMIT;
  const canRemoveSeries = series.length > 1;

  const typeOptions = chartTypeOptions(element);
  const hasUnknownType = typeOptions[0]?.disabled === true;

  const axisDefs = [
    { key: "x_axis" as const, label: axisLabels.xAxis },
    { key: "x_axis_grid" as const, label: axisLabels.xGrid },
    { key: "y_axis" as const, label: axisLabels.yAxis },
    { key: "y_axis_grid" as const, label: axisLabels.yGrid },
  ];

  const typeLabel =
    CHART_TYPE_OPTIONS.find((option) => option.value === element.chart_type)
      ?.label ?? `Stored “${String(element.chart_type)}”`;
  const title = typeof element.title === "string" ? element.title : "";

  return (
    <div data-editor-chart-controls="" className="flex flex-col gap-2">
      <p className="font-mono text-label-sm text-muted-foreground">
        {typeLabel} · {rows.length}×{series.length}
      </p>
      {title.trim() !== "" ? (
        <p className="truncate text-label-sm text-foreground" title={title}>
          {title}
        </p>
      ) : null}
      <span ref={triggerRef} className="inline-flex">
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-editor-chart-toggle=""
          aria-expanded={open}
          aria-label="Edit chart data"
          onClick={() => {
            if (!open) computePosition();
            setOpen((current) => !current);
          }}
        >
          <BarChart3 aria-hidden="true" className="size-4" />
          {open ? "Close chart editor" : "Edit chart data"}
        </Button>
      </span>

      <MotionPopover
        open={open}
        portal
        direction={placement.direction}
        className="fixed z-50"
        style={placement.style}
      >
        <div
          data-editor-chart-editor=""
          role="dialog"
          aria-label="Chart data editor"
          style={{ maxHeight: "inherit" }}
          className="flex flex-col gap-3 overflow-y-auto rounded-card border border-border bg-card p-3 shadow-overlay"
        >
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-heading text-label-sm font-semibold text-foreground">
              Chart data
            </h3>
            <IconButton
              type="button"
              variant="outline"
              size="sm"
              aria-label="Close chart editor"
              data-editor-chart-close=""
              onClick={() => setOpen(false)}
            >
              <X aria-hidden="true" className="size-4" />
            </IconButton>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Type">
              <div data-editor-chart-type="">
                <Select
                  id="editor-chart-type"
                  size="sm"
                  value={String(element.chart_type)}
                  onChange={(value) =>
                    onUpdate("chart-type", (current) =>
                      applyChartField(current, {
                        field: "chart_type",
                        value: value as ChartType,
                      }),
                    )
                  }
                  options={typeOptions}
                  aria-label="Chart type"
                />
              </div>
            </Field>
            <Field label="Data labels">
              <div data-editor-chart-data-labels="">
                <Select
                  id="editor-chart-data-labels"
                  size="sm"
                  value={element.data_labels ?? ""}
                  onChange={(value) =>
                    onUpdate("chart-data-labels", (current) =>
                      applyChartField(current, {
                        field: "data_labels",
                        value: value === "" ? null : (value as DataLabelPosition),
                      }),
                    )
                  }
                  options={[
                    { value: "", label: "Off" },
                    ...DATA_LABEL_OPTIONS.map((option) => ({ ...option })),
                  ]}
                  aria-label="Data labels"
                />
              </div>
            </Field>
          </div>

          <Field label="Title">
            <Input
              id="editor-chart-title"
              data-editor-chart-title=""
              size="sm"
              type="text"
              maxLength={CHART_TEXT_MAX_LENGTH}
              placeholder="Chart title"
              value={title}
              aria-label="Chart title"
              onChange={(event) =>
                onUpdate("chart-title", (current) =>
                  applyChartField(current, {
                    field: "title",
                    value: event.target.value === "" ? null : event.target.value,
                  }),
                )
              }
            />
          </Field>

          {hasUnknownType ? (
            <p
              data-editor-chart-note=""
              className="text-label-sm text-muted-foreground"
            >
              [!] The stored chart type isn’t one of the eleven the renderer
              knows; it draws as a bar chart. Picking a type above corrects the
              wire.
            </p>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-label-sm font-medium text-foreground">
                Data
              </span>
              <span className="font-mono text-label-sm text-muted-foreground">
                {rows.length} rows · {series.length} series
              </span>
            </div>
            {rows.length === 0 && series.length === 0 ? (
              <p
                data-editor-chart-empty=""
                className="text-label-sm text-muted-foreground"
              >
                This chart stores no categories or series. Add a row or a series
                to write real data — nothing is invented here.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-nested border border-border">
                <div className="min-w-max">
                  <div className="flex">
                    <span className="w-24 shrink-0 border-b border-r border-border bg-muted/40 px-2 py-1.5 text-label-sm text-muted-foreground">
                      Category
                    </span>
                    {series.map((entry, seriesIndex) => (
                      <div
                        key={seriesIndex}
                        className="flex w-32 shrink-0 items-center gap-1 border-b border-border px-1 py-1"
                      >
                        <Input
                          size="sm"
                          className="h-8"
                          type="text"
                          maxLength={CHART_TEXT_MAX_LENGTH}
                          value={entry.name}
                          data-editor-chart-series={seriesIndex}
                          aria-label={`Series ${seriesIndex + 1} name`}
                          disabled={!supportsMultiple && seriesIndex > 0}
                          onChange={(event) =>
                            onUpdate("chart-series-name", (current) =>
                              setSeriesName(current, seriesIndex, event.target.value),
                            )
                          }
                        />
                        <IconButton
                          type="button"
                          variant="outline"
                          size="xs"
                          aria-label={`Remove series ${seriesIndex + 1}`}
                          data-editor-chart-remove-series={seriesIndex}
                          disabled={!canRemoveSeries}
                          onClick={() =>
                            onUpdate("chart-series-remove", (current) =>
                              removeChartSeries(current, seriesIndex),
                            )
                          }
                        >
                          <Trash2 aria-hidden="true" className="size-3.5" />
                        </IconButton>
                      </div>
                    ))}
                  </div>
                  {rows.map((rowIndex) => (
                    <div key={rowIndex} className="flex">
                      <div className="flex w-24 shrink-0 items-center border-b border-r border-border bg-muted/20 px-1 py-1">
                        <Input
                          size="sm"
                          className="h-8"
                          type="text"
                          maxLength={CHART_TEXT_MAX_LENGTH}
                          placeholder={categoryPlaceholder(rowIndex)}
                          value={
                            categories[rowIndex]?.trim()
                              ? categories[rowIndex]
                              : ""
                          }
                          data-editor-chart-category={rowIndex}
                          aria-label={`Category ${rowIndex + 1}`}
                          onChange={(event) =>
                            onUpdate("chart-category", (current) =>
                              setCategory(current, rowIndex, event.target.value),
                            )
                          }
                        />
                      </div>
                      {series.map((entry, seriesIndex) => (
                        <div
                          key={seriesIndex}
                          className="w-32 shrink-0 border-b border-border px-1 py-1"
                        >
                          <ChartValueField
                            id={`editor-chart-value-${seriesIndex}-${rowIndex}`}
                            value={entry.values[rowIndex] ?? 0}
                            dataValue={`${seriesIndex}-${rowIndex}`}
                            disabled={!supportsMultiple && seriesIndex > 0}
                            onCommit={(value) =>
                              onUpdate("chart-value", (current) =>
                                setSeriesValue(current, seriesIndex, rowIndex, value),
                              )
                            }
                          />
                        </div>
                      ))}
                      <div className="flex w-10 shrink-0 items-center justify-center border-b border-border py-1">
                        <IconButton
                          type="button"
                          variant="outline"
                          size="xs"
                          aria-label={`Remove row ${rowIndex + 1}`}
                          data-editor-chart-remove-row={rowIndex}
                          disabled={!canRemoveRow}
                          onClick={() =>
                            onUpdate("chart-row-remove", (current) =>
                              removeChartRow(current, rowIndex),
                            )
                          }
                        >
                          <Trash2 aria-hidden="true" className="size-3.5" />
                        </IconButton>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-editor-chart-add-row=""
                disabled={!canAddRow}
                onClick={() =>
                  onUpdate("chart-row-add", (current) => addChartRow(current))
                }
              >
                <Plus aria-hidden="true" className="size-4" />
                Add row
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-editor-chart-add-series=""
                disabled={!canAddSeries}
                onClick={() =>
                  onUpdate("chart-series-add", (current) =>
                    addChartSeries(current),
                  )
                }
              >
                <Plus aria-hidden="true" className="size-4" />
                Add series
              </Button>
            </div>
            {!supportsMultiple ? (
              <p
                data-editor-chart-note=""
                className="text-label-sm text-muted-foreground"
              >
                [!] Pie and donut charts render only the first series; adding a
                series is disabled and extra stored columns stay read-only.
              </p>
            ) : null}
            {rowCount >= CHART_ROW_LIMIT ? (
              <p
                data-editor-chart-note=""
                className="text-label-sm text-muted-foreground"
              >
                [!] The data grid holds at most {CHART_ROW_LIMIT} rows.
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-label-sm font-medium text-foreground">
              Axes
            </span>
            <div className="flex flex-wrap gap-1.5">
              {axisDefs.map((definition) => {
                const enabled = element[definition.key] !== false;
                return (
                  <Button
                    key={definition.key}
                    type="button"
                    size="sm"
                    variant={enabled && hasAxes ? "primary" : "outline"}
                    aria-pressed={enabled}
                    data-editor-chart-axis={definition.key}
                    disabled={!hasAxes}
                    onClick={() =>
                      onUpdate("chart-axis", (current) =>
                        applyChartField(current, {
                          field: definition.key,
                          value: !enabled,
                        }),
                      )
                    }
                  >
                    {definition.label}
                  </Button>
                );
              })}
            </div>
            {!hasAxes ? (
              <p
                data-editor-chart-note=""
                className="text-label-sm text-muted-foreground"
              >
                [!] This chart type draws without axes; the toggles stay stored
                but do not render.
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-label-sm font-medium text-foreground">
              Colours
            </span>
            <div className="flex flex-wrap gap-1.5">
              {slots.map((slot) => (
                <button
                  key={slot.index}
                  type="button"
                  aria-pressed={slot.index === activeSlot?.index}
                  data-editor-chart-color-slot={slot.index}
                  title={slot.label}
                  className={`flex max-w-32 items-center gap-1.5 rounded-pill border px-2 py-1 text-label-sm transition-colors ${
                    slot.index === activeSlot?.index
                      ? "border-foreground bg-muted text-foreground"
                      : "border-border bg-card text-muted-foreground"
                  }`}
                  onClick={() => setActiveSlotIndex(slot.index)}
                >
                  <span
                    aria-hidden="true"
                    className="size-3 shrink-0 rounded-pill border border-border"
                    style={{ backgroundColor: slot.color }}
                  />
                  <span className="min-w-0 truncate">{slot.label}</span>
                </button>
              ))}
            </div>
            {activeSlot !== null ? (
              <>
                <div className="flex items-end gap-2">
                  <Field label={`Colour — ${activeSlot.label}`}>
                    <ChartColorField
                      value={activeSlot.color}
                      onCommit={(color) =>
                        onUpdate("chart-color", (current) =>
                          setChartColor(
                            current,
                            activeSlot.index,
                            color,
                            themePalette,
                          ),
                        )
                      }
                    />
                  </Field>
                  <IconButton
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label="Reset colour to the theme"
                    data-editor-chart-color-reset=""
                    disabled={!activeSlot.explicit}
                    onClick={() =>
                      onUpdate("chart-color-reset", (current) =>
                        setChartColor(current, activeSlot.index, null, themePalette),
                      )
                    }
                  >
                    <RotateCcw aria-hidden="true" className="size-3.5" />
                  </IconButton>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-label-sm text-muted-foreground">
                    Theme
                  </span>
                  {themePalette.map((color, index) => (
                    <button
                      key={`${color}-${index}`}
                      type="button"
                      aria-label={`Theme colour ${index + 1}`}
                      data-editor-chart-theme-color={index}
                      title={color}
                      className="size-5 rounded-pill border border-border"
                      style={{ backgroundColor: color }}
                      onClick={() =>
                        onUpdate("chart-color", (current) =>
                          setChartColor(
                            current,
                            activeSlot.index,
                            color,
                            themePalette,
                          ),
                        )
                      }
                    />
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </div>
      </MotionPopover>
    </div>
  );
}
