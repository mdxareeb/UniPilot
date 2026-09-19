"use client";

/**
 * Task D6 — the deck template's layout palette (spec §5.4 "Blocks", plan D6).
 *
 * A `Collapsible` group per layout group (today: the deck's one template) whose
 * entries each offer two honest actions:
 *
 * - **Add as a new slide** — hydrates the layout with empty content, so the
 *   template defaults are the truth (no mapping gap can apply).
 * - **Use on this slide** — replaces the current slide's layout, hydrating the
 *   slide's existing content where the module can (`hydrateSlide`). An entry
 *   the module cannot map faithfully (top-level repeated-item groups, the
 *   shape the engine's schema expansion consumes) stays visibly add-only with
 *   its reason instead of silently dropping content; the 50-slide cap disables
 *   every add with the existing "Slide limit reached (50)" copy.
 *
 * Rendered by both the rail's Add popover and the inspector's Blocks section —
 * same component, same behavior, distinguished only by `source` for tests.
 * Motion is the shared `Collapsible`; no new animation vocabulary.
 */
import { useId, useState } from "react";
import { ChevronDown, Plus, Replace } from "lucide-react";
import { Collapsible } from "@/components/motion/Collapsible";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import {
  paletteAddState,
  SLIDE_LIMIT_NOTE,
  type LayoutPaletteGroup,
  type PaletteLayoutEntry,
} from "./layoutPaletteModel";

export type LayoutPaletteProps = {
  groups: LayoutPaletteGroup[];
  atSlideLimit: boolean;
  /** The structural gate / layouts-unavailable reason; null when usable. */
  disabledReason: string | null;
  onAddSlide: (layoutId: string) => void;
  onApplyLayout: (layoutId: string) => void;
  /** Distinguishes the rail popover and the inspector instances (tests). */
  source: "rail" | "inspector";
};

export function LayoutPalette({
  groups,
  atSlideLimit,
  disabledReason,
  onAddSlide,
  onApplyLayout,
  source,
}: LayoutPaletteProps) {
  const idPrefix = useId();
  /* Groups start open: the deck has one template, so hiding its layouts behind
     a second click would be friction without information. Every group can be
     collapsed on demand. */
  const [closedGroups, setClosedGroups] = useState<string[]>([]);
  const add = paletteAddState(atSlideLimit);
  const layoutCount = groups.reduce(
    (total, group) => total + group.layouts.length,
    0,
  );

  const toggleGroup = (groupId: string) => {
    setClosedGroups((current) =>
      current.includes(groupId)
        ? current.filter((id) => id !== groupId)
        : [...current, groupId],
    );
  };

  if (groups.length === 0 || layoutCount === 0) {
    return (
      <p
        data-layout-palette={source}
        className="px-2 py-1.5 text-label-sm text-muted-foreground"
      >
        The template&rsquo;s layouts weren&rsquo;t available, so no layout can
        be chosen.
      </p>
    );
  }

  return (
    <div data-layout-palette={source} className="flex flex-col gap-1">
      {disabledReason !== null ? (
        <p
          data-layout-palette-note=""
          className="px-1 text-label-sm text-muted-foreground"
        >
          [!] {disabledReason}
        </p>
      ) : null}

      {groups.map((group) => {
        const open = !closedGroups.includes(group.id);
        const panelId = `${idPrefix}-${group.id}`;
        return (
          <section key={group.id} data-layout-group={group.id}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              aria-expanded={open}
              aria-controls={panelId}
              data-layout-group-toggle={group.id}
              onClick={() => toggleGroup(group.id)}
            >
              <span className="flex w-full min-w-0 items-center justify-between gap-3">
                <span className="min-w-0 truncate text-left">{group.label}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="font-mono text-label-caps text-muted-foreground">
                    {group.layouts.length}
                  </span>
                  <ChevronDown
                    aria-hidden="true"
                    className={`icon-turn size-4${open ? " rotate-180" : ""}`}
                  />
                </span>
              </span>
            </Button>
            <Collapsible id={panelId} open={open} variant="fade">
              <ul className="mt-1 flex flex-col gap-0.5">
                {group.layouts.map((layout) => (
                  <PaletteEntry
                    key={layout.id}
                    layout={layout}
                    source={source}
                    addDisabled={disabledReason !== null || add.disabled}
                    addTitle={disabledReason ?? add.title}
                    applyDisabled={disabledReason !== null || !layout.replaceable}
                    applyTitle={
                      disabledReason ??
                      layout.replaceReason ??
                      "Use this layout on the current slide"
                    }
                    onAddSlide={onAddSlide}
                    onApplyLayout={onApplyLayout}
                  />
                ))}
              </ul>
            </Collapsible>
          </section>
        );
      })}

      {atSlideLimit ? (
        <p
          data-layout-limit-note=""
          className="px-1 text-label-sm text-muted-foreground"
        >
          {SLIDE_LIMIT_NOTE}
        </p>
      ) : null}
    </div>
  );
}

function PaletteEntry({
  layout,
  source,
  addDisabled,
  addTitle,
  applyDisabled,
  applyTitle,
  onAddSlide,
  onApplyLayout,
}: {
  layout: PaletteLayoutEntry;
  source: "rail" | "inspector";
  addDisabled: boolean;
  addTitle: string;
  applyDisabled: boolean;
  applyTitle: string;
  onAddSlide: (layoutId: string) => void;
  onApplyLayout: (layoutId: string) => void;
}) {
  return (
    <li
      data-layout-entry={layout.id}
      className="flex flex-col gap-0.5 rounded-nested px-1 py-1 hover:bg-muted/60"
    >
      <div className="flex min-w-0 items-start justify-between gap-1">
        <div className="flex min-w-0 flex-col">
          <span className="min-w-0 text-label-sm text-foreground">
            {layout.label}
          </span>
          <span className="min-w-0 truncate font-mono text-label-sm text-muted-foreground">
            {layout.id}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <IconButton
            type="button"
            variant="outline"
            size="sm"
            aria-label={`Add ${layout.id} as a new slide`}
            title={addTitle}
            disabled={addDisabled}
            data-layout-add={layout.id}
            data-layout-add-source={source}
            onClick={() => onAddSlide(layout.id)}
          >
            <Plus aria-hidden="true" className="size-4" />
          </IconButton>
          <IconButton
            type="button"
            variant="outline"
            size="sm"
            aria-label={`Use ${layout.id} on this slide`}
            title={applyTitle}
            disabled={applyDisabled}
            data-layout-apply={layout.id}
            data-layout-apply-source={source}
            onClick={() => onApplyLayout(layout.id)}
          >
            <Replace aria-hidden="true" className="size-4" />
          </IconButton>
        </div>
      </div>
      {!layout.replaceable && layout.replaceReason !== null ? (
        <p
          data-layout-replace-note={layout.id}
          className="text-label-sm text-muted-foreground"
        >
          [!] {layout.replaceReason}
        </p>
      ) : null}
    </li>
  );
}
