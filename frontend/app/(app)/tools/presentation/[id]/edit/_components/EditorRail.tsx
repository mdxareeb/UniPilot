"use client";

/**
 * The editor's thumbnail rail and structural toolbar (Task C4, spec §8.2/§8.5).
 *
 * The rail is the viewer rail's editor sibling: `MotionListItem` thumbnails in
 * `AnimatePresence` around the selection (lazy stages near the selection), a
 * `listbox` with `aria-activedescendant`, and the shared `MotionSelectionRing`
 * (`layoutId="deck-thumb"`). Below it sits the structural toolbar — add /
 * duplicate / delete / move up / move down.
 *
 * Structural editing is `[!]` gated by the engine's owner scope
 * (`PRESENTON_STRUCTURAL_EDITS`): when the flag is off every structural control
 * renders disabled with the same honest inline reason, and nothing here can
 * fake a structural edit. When the flag is on, Add opens a `MotionPopover`
 * layout chooser; every action hydrates or reorders locally and hands the
 * whole array to the editor's structural save.
 */
import { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Plus,
  Trash2,
} from "lucide-react";
import { AnimatePresence } from "motion/react";
import { MotionListItem } from "@/components/motion/MotionListItem";
import { MotionPopover } from "@/components/motion/MotionPopover";
import { MotionSelectionRing } from "@/components/motion/MotionSelectionRing";
import { DeckStage } from "@/components/presentation/DeckStage";
import { Card } from "@/components/ui/Card";
import { IconButton } from "@/components/ui/IconButton";
import type { PresentationDeck } from "@/lib/presentation/types";

/** Slides either side of the selection that keep a live stage rendered. */
const LAZY_WINDOW = 4;

export const STRUCTURAL_EDITING_REASON =
  "Structural editing needs a presentation engine with matching owner scope — this service doesn't have it, so add, duplicate, delete, reorder and layout stay off. Recorded, not faked.";

export type EditorRailProps = {
  deck: PresentationDeck;
  /** The UniPilot presentation row id (asset-proxy owner). */
  id: string;
  slideIndex: number;
  onSelect: (index: number) => void;
  structuralEditsEnabled: boolean;
  /** Layout choices for the add-slide popover (flag on only). */
  layoutOptions: Array<{ id: string; label: string }>;
  onAddSlide: (layoutId: string) => void;
  onDuplicateSlide: () => void;
  onDeleteSlide: () => void;
  onMoveSlide: (delta: -1 | 1) => void;
  atSlideLimit: boolean;
};

export function EditorRail({
  deck,
  id,
  slideIndex,
  onSelect,
  structuralEditsEnabled,
  layoutOptions,
  onAddSlide,
  onDuplicateSlide,
  onDeleteSlide,
  onMoveSlide,
  atSlideLimit,
}: EditorRailProps) {
  const slides = Array.isArray(deck.slides) ? deck.slides : [];
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false);
  const gatedTitle = structuralEditsEnabled
    ? undefined
    : STRUCTURAL_EDITING_REASON;

  const canDelete = structuralEditsEnabled && slides.length > 1;
  const canAdd = structuralEditsEnabled && !atSlideLimit;
  const canMove = structuralEditsEnabled && slides.length > 1;

  return (
    <Card className="flex min-w-0 flex-col gap-3 bg-glass p-2 backdrop-blur-md xl:w-44 xl:shrink-0">
      <div
        role="listbox"
        aria-label="Slides"
        aria-activedescendant={
          slides.length > 0 ? `deck-thumb-${slideIndex}` : undefined
        }
        tabIndex={0}
        data-slide-rail=""
        className="flex gap-2 overflow-x-auto p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background xl:max-h-[52vh] xl:flex-col xl:overflow-y-auto"
      >
        <AnimatePresence initial={false}>
          {slides.map((slide, index) => {
            const selected = index === slideIndex;
            const near = Math.abs(index - slideIndex) <= LAZY_WINDOW;
            const key =
              typeof slide.id === "string" && slide.id !== "" ? slide.id : index;
            return (
              <MotionListItem
                as="div"
                key={key}
                id={`deck-thumb-${index}`}
                role="option"
                aria-selected={selected}
                aria-label={`Slide ${index + 1}`}
                tabIndex={-1}
                data-deck-thumb={index}
                onClick={() => onSelect(index)}
                className="flex shrink-0 cursor-pointer flex-col gap-1 rounded-nested"
              >
                <div className="relative w-36 overflow-hidden rounded-nested border border-border xl:w-full">
                  {near ? (
                    <DeckStage
                      deck={deck}
                      id={id}
                      slideIndex={index}
                      scale="fit-width"
                    />
                  ) : (
                    <div
                      aria-hidden="true"
                      className="aspect-video w-full bg-muted"
                    />
                  )}
                  {selected ? (
                    <MotionSelectionRing
                      layoutId="deck-thumb"
                      radiusClass="rounded-nested"
                    />
                  ) : null}
                </div>
                <span
                  className={`text-center font-mono text-label-sm ${
                    selected ? "text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {index + 1}
                </span>
              </MotionListItem>
            );
          })}
        </AnimatePresence>
      </div>

      <div className="flex flex-col gap-2 border-t border-border p-1 pt-3">
        <div
          data-editor-structural-toolbar=""
          className="flex flex-wrap items-center gap-1"
        >
          <div className="relative">
            <IconButton
              type="button"
              variant="outline"
              size="sm"
              aria-label="Add slide"
              aria-haspopup={structuralEditsEnabled ? "menu" : undefined}
              aria-expanded={structuralEditsEnabled ? layoutMenuOpen : undefined}
              disabled={!canAdd}
              title={
                !structuralEditsEnabled
                  ? gatedTitle
                  : atSlideLimit
                    ? "Slide limit reached (50)"
                    : "Add slide"
              }
              data-editor-add-slide=""
              onClick={() =>
                structuralEditsEnabled && setLayoutMenuOpen((open) => !open)
              }
            >
              <Plus aria-hidden="true" className="size-4" />
            </IconButton>
            {structuralEditsEnabled ? (
              <MotionPopover
                open={layoutMenuOpen}
                direction="down"
                className="absolute left-0 top-full z-40 mt-2 w-56"
              >
                <div
                  role="menu"
                  aria-label="Add slide from layout"
                  className="rounded-card border border-border bg-glass p-1 shadow-overlay backdrop-blur-md"
                >
                  {layoutOptions.length === 0 ? (
                    <p className="px-2 py-1.5 text-label-sm text-muted-foreground">
                      The template&rsquo;s layouts weren&rsquo;t available, so
                      no layout can be chosen.
                    </p>
                  ) : (
                    layoutOptions.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        role="menuitem"
                        className="block w-full min-w-0 truncate rounded-base px-2.5 py-2 text-left text-label-sm text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => {
                          setLayoutMenuOpen(false);
                          onAddSlide(option.id);
                        }}
                      >
                        {option.label}
                      </button>
                    ))
                  )}
                </div>
              </MotionPopover>
            ) : null}
          </div>

          <IconButton
            type="button"
            variant="outline"
            size="sm"
            aria-label="Duplicate slide"
            disabled={!structuralEditsEnabled || atSlideLimit}
            title={
              !structuralEditsEnabled
                ? gatedTitle
                : atSlideLimit
                  ? "Slide limit reached (50)"
                  : "Duplicate slide"
            }
            data-editor-duplicate-slide=""
            onClick={onDuplicateSlide}
          >
            <Copy aria-hidden="true" className="size-4" />
          </IconButton>

          <IconButton
            type="button"
            variant="outline"
            size="sm"
            aria-label="Move slide up"
            disabled={!canMove || slideIndex <= 0}
            title={!structuralEditsEnabled ? gatedTitle : "Move slide up"}
            data-editor-move-up=""
            onClick={() => onMoveSlide(-1)}
          >
            <ArrowUp aria-hidden="true" className="size-4" />
          </IconButton>

          <IconButton
            type="button"
            variant="outline"
            size="sm"
            aria-label="Move slide down"
            disabled={!canMove || slideIndex >= slides.length - 1}
            title={!structuralEditsEnabled ? gatedTitle : "Move slide down"}
            data-editor-move-down=""
            onClick={() => onMoveSlide(1)}
          >
            <ArrowDown aria-hidden="true" className="size-4" />
          </IconButton>

          <IconButton
            type="button"
            variant="outline"
            size="sm"
            aria-label="Delete slide"
            disabled={!canDelete}
            title={
              !structuralEditsEnabled
                ? gatedTitle
                : slides.length <= 1
                  ? "A deck keeps at least one slide"
                  : "Delete slide"
            }
            data-editor-delete-slide=""
            onClick={onDeleteSlide}
          >
            <Trash2 aria-hidden="true" className="size-4" />
          </IconButton>
        </div>

        {!structuralEditsEnabled ? (
          <p
            data-editor-structural-note=""
            className="text-label-sm text-muted-foreground"
          >
            [!] {STRUCTURAL_EDITING_REASON}
          </p>
        ) : (
          <p className="text-label-sm text-muted-foreground">
            {slides.length >= 50
              ? "Slide limit reached (50)."
              : `${slides.length} slides · structural saves use fresh slide ids.`}
          </p>
        )}
      </div>
    </Card>
  );
}

