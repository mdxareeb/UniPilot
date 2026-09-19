"use client";

/**
 * The editor's thumbnail rail and structural toolbar (Task C4, spec §8.2/§8.5;
 * the Add control's grouped layout palette is Task D6).
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
 * fake a structural edit. When the flag is on, Add opens the deck template's
 * layout palette (`LayoutPalette`, grouped by `Collapsible`): each entry can
 * insert a new slide after the current one or apply the layout to it, with the
 * hydration module's honest add-only label where it cannot map content.
 */
import { useCallback, useEffect, useRef, useState } from "react";
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
import { LayoutPalette } from "./LayoutPalette";
import {
  slideLimitReached,
  SLIDE_LIMIT_NOTE,
  SLIDE_LIMIT_TITLE,
  type LayoutPaletteGroup,
} from "./layoutPaletteModel";

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
  /** The template's grouped layout palette (flag on only). */
  layoutGroups: LayoutPaletteGroup[];
  /** Why the palette cannot act (gate off / layouts unavailable), else null. */
  layoutDisabledReason: string | null;
  onAddSlide: (layoutId: string) => void;
  onApplyLayout: (layoutId: string) => void;
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
  layoutGroups,
  layoutDisabledReason,
  onAddSlide,
  onApplyLayout,
  onDuplicateSlide,
  onDeleteSlide,
  onMoveSlide,
  atSlideLimit,
}: EditorRailProps) {
  const slides = Array.isArray(deck.slides) ? deck.slides : [];
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false);
  const addButtonRef = useRef<HTMLButtonElement | null>(null);
  const palettePanelRef = useRef<HTMLDivElement | null>(null);
  const gatedTitle = structuralEditsEnabled
    ? undefined
    : STRUCTURAL_EDITING_REASON;

  const canDelete = structuralEditsEnabled && slides.length > 1;
  const canAdd = structuralEditsEnabled && !atSlideLimit;
  const canMove = structuralEditsEnabled && slides.length > 1;

  /** Closes the palette popover; focus returns to the trigger when asked. */
  const closeLayoutMenu = useCallback((returnFocus = true) => {
    setLayoutMenuOpen(false);
    if (returnFocus) {
      window.requestAnimationFrame(() => addButtonRef.current?.focus());
    }
  }, []);

  /*
   * The popover is a `role="dialog"` surface, so it carries the behavior that
   * role promises: focus moves into the palette on open, Escape closes and
   * returns focus to the trigger, and a press outside dismisses it (without
   * stealing focus from where the press landed). The shared `MotionPopover`
   * owns only the animation; this is the rail's dialog wiring.
   */
  useEffect(() => {
    if (!layoutMenuOpen) return;
    const focusFrame = window.requestAnimationFrame(() => {
      palettePanelRef.current
        ?.querySelector<HTMLElement>(
          "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
        )
        ?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      closeLayoutMenu();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target === null) return;
      if (palettePanelRef.current?.contains(target)) return;
      if (addButtonRef.current?.parentElement?.contains(target)) return;
      closeLayoutMenu(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [closeLayoutMenu, layoutMenuOpen]);

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
              ref={addButtonRef}
              type="button"
              variant="outline"
              size="sm"
              aria-label="Add slide"
              aria-haspopup={structuralEditsEnabled ? "dialog" : undefined}
              aria-expanded={structuralEditsEnabled ? layoutMenuOpen : undefined}
              disabled={!canAdd}
              title={
                !structuralEditsEnabled
                  ? gatedTitle
                  : atSlideLimit
                    ? SLIDE_LIMIT_TITLE
                    : "Add slide"
              }
              data-editor-add-slide=""
              onClick={() =>
                structuralEditsEnabled &&
                (layoutMenuOpen
                  ? closeLayoutMenu()
                  : setLayoutMenuOpen(true))
              }
            >
              <Plus aria-hidden="true" className="size-4" />
            </IconButton>
            {structuralEditsEnabled ? (
              <MotionPopover
                open={layoutMenuOpen}
                direction="down"
                role="dialog"
                aria-label="Layout palette"
                className="absolute left-0 top-full z-40 mt-2 max-h-[70vh] w-80 overflow-y-auto"
              >
                <div
                  ref={palettePanelRef}
                  className="rounded-card border border-border bg-glass p-1 shadow-overlay backdrop-blur-md"
                >
                  <LayoutPalette
                    source="rail"
                    groups={layoutGroups}
                    atSlideLimit={atSlideLimit}
                    disabledReason={layoutDisabledReason}
                    onAddSlide={(layoutId) => {
                      closeLayoutMenu(false);
                      onAddSlide(layoutId);
                    }}
                    onApplyLayout={(layoutId) => {
                      closeLayoutMenu(false);
                      onApplyLayout(layoutId);
                    }}
                  />
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
            {slideLimitReached(slides.length)
              ? SLIDE_LIMIT_NOTE
              : `${slides.length} slides · structural saves use fresh slide ids.`}
          </p>
        )}
      </div>
    </Card>
  );
}

