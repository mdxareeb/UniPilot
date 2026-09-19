"use client";

/**
 * The editor's inspector (Task C4, spec §8.2: inspector panel from `Card`,
 * `Select`, `Input`, `Textarea`). Four groups, each a direct mapping to one
 * mutation:
 *
 * - deck: the engine title (rename) and the theme picker — the deck's stored
 *   theme verbatim, or the template's own theme; both saves send the theme
 *   object as-is (never flattened);
 * - slide: the per-slide layout picker, `[!]` gated like every structural
 *   control (hydration for the new layout is the editor's job);
 * - notes: the slide's speaker script (a `slide_update`);
 * - text: the selected text element's plain-text value (run-preserving), with
 *   a picker over every text element the slide renders, nested ones included.
 */
import type { ReactNode, RefObject } from "react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";

export type InspectorPanelProps = {
  title: string;
  onTitleChange: (value: string) => void;
  themeOptions: Array<{ value: string; label: string }>;
  themeValue: string;
  onThemeChange: (value: string) => void;
  /** Swatch colors of the currently applied theme (content preview, not chrome). */
  themeSwatches: string[];
  notes: string;
  onNotesChange: (value: string) => void;
  layoutOptions: Array<{ value: string; label: string }>;
  layoutValue: string;
  onLayoutChange: (value: string) => void;
  layoutDisabledReason: string | null;
  /** The add-only layout count line (D6), else null. */
  layoutAddOnlyNote?: string | null;
  /** Why the last layout choice was refused (D6), else null. */
  layoutChangeNote?: string | null;
  /**
   * The block/layout palette (D6): the template's layouts grouped via
   * `Collapsible`, each insertable as a new slide or applicable to this one.
   */
  blocks?: ReactNode;
  /**
   * The infographic insertion palette (D9): the three implemented renderers as
   * add actions plus every unsupported type disabled with the honest note.
   */
  elements?: ReactNode;
  elementOptions: Array<{ value: string; label: string }>;
  elementValue: string | null;
  onElementChange: (value: string) => void;
  elementText: string;
  onElementTextChange: (value: string) => void;
  elementHint: string;
  /** Focus target for nested elements selected from the stage (Tab navigation). */
  elementTextRef?: RefObject<HTMLTextAreaElement | null>;
  /**
   * The selected image element's controls (D3). Present only when the primary
   * selection is an image; the Image section renders exactly then.
   */
  imageControls?: ReactNode;
  /**
   * The selected chart element's controls (D5). Present only when the primary
   * selection is a chart.
   */
  chartControls?: ReactNode;
  /**
   * The selected table element's controls (D5). Present only when the primary
   * selection is a table.
   */
  tableControls?: ReactNode;
};

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2 border-t border-border px-1 pt-3 first:border-t-0 first:pt-0">
      <header className="flex flex-col gap-0.5">
        <h3 className="font-heading text-label-sm font-semibold text-foreground">
          {title}
        </h3>
        {description ? (
          <p className="text-label-sm text-muted-foreground">{description}</p>
        ) : null}
      </header>
      {children}
    </section>
  );
}

export function InspectorPanel({
  title,
  onTitleChange,
  themeOptions,
  themeValue,
  onThemeChange,
  themeSwatches,
  notes,
  onNotesChange,
  layoutOptions,
  layoutValue,
  onLayoutChange,
  layoutDisabledReason,
  layoutAddOnlyNote,
  layoutChangeNote,
  blocks,
  elements,
  elementOptions,
  elementValue,
  onElementChange,
  elementText,
  onElementTextChange,
  elementHint,
  elementTextRef,
  imageControls,
  chartControls,
  tableControls,
}: InspectorPanelProps) {
  return (
    <div
      data-editor-inspector=""
      className="flex min-w-0 flex-col gap-4 rounded-card border border-border bg-glass p-4 backdrop-blur-md"
    >
      <Section
        title="Deck"
        description="The engine title and the theme saved with the deck."
      >
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="editor-deck-title"
            className="text-label-sm font-medium text-foreground"
          >
            Title
          </label>
          <Input
            id="editor-deck-title"
            data-editor-title=""
            size="sm"
            value={title}
            maxLength={200}
            onChange={(event) => onTitleChange(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="editor-deck-theme"
            className="text-label-sm font-medium text-foreground"
          >
            Theme
          </label>
          <div data-editor-theme="">
            <Select
              id="editor-deck-theme"
              size="sm"
              value={themeValue}
              onChange={onThemeChange}
              options={themeOptions}
              disabled={themeOptions.length <= 1}
              aria-label="Deck theme"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {themeSwatches.map((color, index) => (
              <span
                key={`${color}-${index}`}
                aria-hidden="true"
                data-editor-theme-swatch={index}
                title={color}
                className="size-3.5 rounded-pill border border-border"
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        </div>
      </Section>

      <Section title="Slide" description="Layout and speaker notes for this slide.">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="editor-slide-layout"
            className="text-label-sm font-medium text-foreground"
          >
            Layout
          </label>
          <div data-editor-layout="">
            <Select
              id="editor-slide-layout"
              size="sm"
              value={layoutValue}
              onChange={onLayoutChange}
              options={
                layoutOptions.length > 0
                  ? layoutOptions
                  : [{ value: layoutValue, label: "No template layouts available" }]
              }
              disabled={layoutDisabledReason !== null}
              aria-label="Slide layout"
            />
          </div>
          {layoutDisabledReason !== null ? (
            <p
              data-editor-layout-note=""
              className="text-label-sm text-muted-foreground"
            >
              [!] {layoutDisabledReason}
            </p>
          ) : null}
          {layoutDisabledReason === null && layoutAddOnlyNote ? (
            <p
              data-editor-layout-add-only=""
              className="text-label-sm text-muted-foreground"
            >
              [!] {layoutAddOnlyNote}
            </p>
          ) : null}
          {layoutDisabledReason === null && layoutChangeNote ? (
            <p
              data-editor-layout-change-note=""
              className="text-label-sm text-muted-foreground"
            >
              [!] {layoutChangeNote}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="editor-slide-notes"
            className="text-label-sm font-medium text-foreground"
          >
            Speaker notes
          </label>
          <div data-editor-notes="">
            <Textarea
              id="editor-slide-notes"
              data-editor-notes-text=""
              rows={4}
              maxLength={20_000}
              placeholder="Notes for this slide — shown in present mode."
              value={notes}
              onChange={(event) => onNotesChange(event.target.value)}
            />
          </div>
        </div>
      </Section>

      {blocks ? (
        <Section
          title="Blocks"
          description="The deck template's layouts — insert one as a new slide, or use it on this slide."
        >
          {blocks}
        </Section>
      ) : null}

      {elements ? (
        <Section
          title="Add element"
          description="Insert an infographic into this slide — only the types the native renderer implements."
        >
          {elements}
        </Section>
      ) : null}

      <Section
        title="Text"
        description="Plain text, saved with the first run's style — it replaces the run structure. Select text on the slide for the rich-run toolbar (B/I/U and more)."
      >
        <div data-editor-element-select="">
          <Select
            size="sm"
            value={elementValue ?? ""}
            onChange={onElementChange}
            options={
              elementOptions.length > 0
                ? elementOptions
                : [{ value: "", label: "No text elements on this slide" }]
            }
            disabled={elementOptions.length === 0}
            aria-label="Text element"
          />
        </div>
        <Textarea
          ref={elementTextRef}
          data-editor-element-text=""
          aria-label="Selected text element content"
          rows={3}
          value={elementText}
          disabled={elementValue === null}
          placeholder={elementHint}
          onChange={(event) => onElementTextChange(event.target.value)}
        />
        {elementValue === null ? (
          <p className="text-label-sm text-muted-foreground">{elementHint}</p>
        ) : null}
      </Section>

      {imageControls ? (
        <Section
          title="Image"
          description="The source, fit, crop, radius, flips and opacity saved with the slide."
        >
          {imageControls}
        </Section>
      ) : null}

      {chartControls ? (
        <Section
          title="Chart"
          description="Type, title, categories, series, palette and axes saved with the slide."
        >
          {chartControls}
        </Section>
      ) : null}

      {tableControls ? (
        <Section
          title="Table"
          description="Cell text and the row/column grid saved with the slide."
        >
          {tableControls}
        </Section>
      ) : null}
    </div>
  );
}

