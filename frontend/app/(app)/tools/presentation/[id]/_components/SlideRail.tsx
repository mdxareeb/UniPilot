"use client";

/**
 * The viewer's thumbnail rail (Task B4, spec §8.2).
 *
 * A glass `Card` rail of `MotionListItem` thumbnails, one scaled `DeckStage`
 * per slide, the selected one carrying the shared `MotionSelectionRing`
 * (`layoutId="deck-thumb"`, `rounded-nested`). Slide numbers are mono
 * (`font-mono text-label-sm`) and the whole rail is a `listbox` control:
 * `aria-activedescendant` names the selected option, arrow keys are handled by
 * the viewer's navigation (selection is the current slide), and every option
 * is a pointer target while the stage inside it stays display-only.
 *
 * Thumbnails render their stage lazily around the selection (±`LAZY_WINDOW`),
 * Presenton's near-viewport behaviour — a 30-slide deck does not build 30
 * full element trees at once. Beyond the window an honest empty frame (the
 * stage's own muted background) holds the row's geometry.
 */
import { AnimatePresence } from "motion/react";
import { Card } from "@/components/ui/Card";
import { MotionListItem } from "@/components/motion/MotionListItem";
import { MotionSelectionRing } from "@/components/motion/MotionSelectionRing";
import { DeckStage } from "@/components/presentation/DeckStage";
import type { PresentationDeck } from "@/lib/presentation/types";

/** Slides either side of the selection that keep a live stage rendered. */
const LAZY_WINDOW = 4;

type SlideRailProps = {
  deck: PresentationDeck;
  /** The UniPilot presentation row id (asset-proxy owner). */
  id: string;
  slideIndex: number;
  onSelect: (index: number) => void;
};

export function SlideRail({ deck, id, slideIndex, onSelect }: SlideRailProps) {
  const slides = Array.isArray(deck.slides) ? deck.slides : [];

  return (
    <Card className="bg-glass p-2 backdrop-blur-md lg:w-44 lg:shrink-0">
      <div
        role="listbox"
        aria-label="Slides"
        aria-activedescendant={
          slides.length > 0 ? `deck-thumb-${slideIndex}` : undefined
        }
        tabIndex={0}
        data-slide-rail=""
        className="flex gap-2 overflow-x-auto p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background lg:max-h-[60vh] lg:flex-col lg:overflow-y-auto"
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
                <div className="relative w-36 overflow-hidden rounded-nested border border-border lg:w-full">
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
    </Card>
  );
}

export type { SlideRailProps };
