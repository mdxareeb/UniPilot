"use client";

/**
 * The native deck viewer (Task B4, spec §8.1/§8.2).
 *
 * Two movements on a glass panel: the full-size `DeckStage` (fit to width,
 * interactive) with its chrome-free stage inside, and the thumbnail rail
 * beside it. Navigation is the viewer keyboard set (← → Space PageUp
 * PageDown Home End — ignored while a text field has focus), the prev/next
 * `IconButton`s, the slide counter in mono, a read-only speaker-notes
 * availability indicator, and present mode. The deck's slide count and order
 * come from the engine read; nothing here edits.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Play, StickyNote } from "lucide-react";
import { motionIndex } from "@/components/motion/stagger";
import { DeckStage } from "@/components/presentation/DeckStage";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { IconButton } from "@/components/ui/IconButton";
import type { PresentationDeck } from "@/lib/presentation/types";
import { PresentMode } from "./PresentMode";
import { targetOwnsSpace } from "./presentationKeys";
import { SlideRail } from "./SlideRail";

type DeckViewerProps = {
  deck: PresentationDeck;
  /** The UniPilot presentation row id (asset-proxy owner). */
  id: string;
  /** Deck name for present mode's chrome. */
  title: string;
};

function clamp(index: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(Math.max(index, 0), total - 1);
}

/** Text fields keep their keys; navigation never steals them. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

export function DeckViewer({ deck, id, title }: DeckViewerProps) {
  const slides = Array.isArray(deck.slides) ? deck.slides : [];
  const total = slides.length;
  const [slideIndex, setSlideIndex] = useState(0);
  const [presenting, setPresenting] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  /* The test/QA hydration marker: set directly so it never renders on the
     server (a server attribute would claim interactivity that is not there). */
  useEffect(() => {
    rootRef.current?.setAttribute("data-viewer-ready", "true");
  }, []);

  const goTo = useCallback(
    (index: number) => {
      setSlideIndex(() => clamp(index, total));
    },
    [total],
  );

  const step = useCallback(
    (delta: number) => {
      setSlideIndex((current) => clamp(current + delta, total));
    },
    [total],
  );

  useEffect(() => {
    if (presenting) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      if (isEditableTarget(event.target)) return;
      switch (event.key) {
        case "ArrowRight":
        case "PageDown":
          event.preventDefault();
          step(1);
          break;
        case " ":
          if (targetOwnsSpace(event.target)) return;
          event.preventDefault();
          step(1);
          break;
        case "ArrowLeft":
        case "PageUp":
          event.preventDefault();
          step(-1);
          break;
        case "Home":
          event.preventDefault();
          goTo(0);
          break;
        case "End":
          event.preventDefault();
          goTo(total - 1);
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goTo, presenting, step, total]);

  const enterPresent = useCallback(() => setPresenting(true), []);
  const exitPresent = useCallback(() => setPresenting(false), []);

  const currentNote = slides[slideIndex]?.speaker_note;
  const hasNotes =
    typeof currentNote === "string" && currentNote.trim() !== "";

  return (
    <div
      ref={rootRef}
      className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start"
    >
      <div data-enter="scale" style={motionIndex(1)} className="min-w-0 flex-1">
        <Card className="flex min-w-0 flex-col gap-4 bg-glass p-4 backdrop-blur-md md:p-5">
          <div
            data-viewer-stage=""
            className="relative overflow-hidden rounded-nested border border-border bg-muted"
          >
            <DeckStage
              deck={deck}
              id={id}
              slideIndex={slideIndex}
              scale="fit-width"
              interactive
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-1.5">
              <IconButton
                aria-label="Previous slide"
                variant="outline"
                size="sm"
                disabled={slideIndex <= 0}
                onClick={() => step(-1)}
              >
                <ChevronLeft aria-hidden="true" className="size-4" />
              </IconButton>
              <IconButton
                aria-label="Next slide"
                variant="outline"
                size="sm"
                disabled={slideIndex >= total - 1}
                onClick={() => step(1)}
              >
                <ChevronRight aria-hidden="true" className="size-4" />
              </IconButton>
              <p
                data-slide-counter=""
                aria-live="polite"
                className="ml-1 font-mono text-label-sm text-muted-foreground"
              >
                {total > 0 ? slideIndex + 1 : 0} / {total}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <span
                data-notes-indicator={hasNotes ? "available" : "none"}
                title={
                  hasNotes
                    ? "This slide has speaker notes (read-only)"
                    : "This slide has no speaker notes"
                }
                className="inline-flex items-center gap-1.5 text-label-sm text-muted-foreground"
              >
                <StickyNote aria-hidden="true" className="size-3.5" />
                {hasNotes ? "Speaker notes" : "No notes"}
              </span>
              <Button
                variant="outline"
                disabled={total === 0}
                onClick={enterPresent}
              >
                <Play aria-hidden="true" className="size-4" />
                Present
              </Button>
            </div>
          </div>
        </Card>
      </div>

      <div data-enter style={motionIndex(2)} className="min-w-0">
        <SlideRail
          deck={deck}
          id={id}
          slideIndex={slideIndex}
          onSelect={goTo}
        />
      </div>

      {presenting ? (
        <PresentMode
          deck={deck}
          id={id}
          title={title}
          slideIndex={slideIndex}
          onIndexChange={goTo}
          onExit={exitPresent}
        />
      ) : null}
    </div>
  );
}

export type { DeckViewerProps };
