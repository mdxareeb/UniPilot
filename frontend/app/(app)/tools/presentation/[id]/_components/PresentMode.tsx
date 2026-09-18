"use client";

/**
 * Fullscreen present mode (Task B4, spec §5.1 row 5, §8.5).
 *
 * A fixed overlay over the viewer — the shared scrim backdrop (Modal's
 * fullscreen-preview precedent) so slides of any theme stay framed: the
 * current slide on a fit-to-screen stage, auto-hiding inverted chrome (top:
 * deck title, notes toggle, exit; bottom: prev/next, counter, determinate
 * progress), edge click zones, the presenter keyboard set (←→↑↓ Space
 * PageUp/PageDown Home End Esc, N for notes) and a focus trap while it is
 * open.
 *
 * Fullscreen is real when the browser offers it (`requestFullscreen` on the
 * overlay) and an honest no-op when it does not: the overlay still presents
 * windowed and only a successful entry arms the browser-level exit path
 * (`fullscreenchange` → exit), so a rejected request never leaves a trap.
 * Reduced motion zeroes the chrome fade and the notes popover through the
 * shared primitives; nothing here animates layout.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, StickyNote, X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { MotionPopover } from "@/components/motion/MotionPopover";
import { DURATION, EASE_OUT, railFillIn } from "@/components/motion/presets";
import { DeckStage } from "@/components/presentation/DeckStage";
import { IconButton } from "@/components/ui/IconButton";
import type { PresentationDeck } from "@/lib/presentation/types";
import { targetOwnsSpace } from "./presentationKeys";

/** How long the chrome stays after the last pointer/key action. */
const CHROME_HIDE_MS = 2_500;

type PresentModeProps = {
  deck: PresentationDeck;
  /** The UniPilot presentation row id (asset-proxy owner). */
  id: string;
  /** Deck name, shown in the chrome. */
  title: string;
  slideIndex: number;
  /** Clamped by the viewer; the presenter only names the target. */
  onIndexChange: (index: number) => void;
  onExit: () => void;
};

export function PresentMode({
  deck,
  id,
  title,
  slideIndex,
  onIndexChange,
  onExit,
}: PresentModeProps) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const exitTimerRef = useRef<number | null>(null);
  const fullscreenRequestedRef = useRef(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [notesOpen, setNotesOpen] = useState(false);
  const reduced = useReducedMotion() ?? false;

  const slides = Array.isArray(deck.slides) ? deck.slides : [];
  const total = slides.length;
  const currentNote =
    typeof slides[slideIndex]?.speaker_note === "string"
      ? (slides[slideIndex]?.speaker_note ?? "").trim()
      : "";

  /* The presenter keyboard set. Slides move through the viewer's clamped
     `onIndexChange`; Esc exits; N toggles the notes panel. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      switch (event.key) {
        case "ArrowRight":
        case "ArrowDown":
        case "PageDown":
          event.preventDefault();
          onIndexChange(slideIndex + 1);
          break;
        case " ":
          if (targetOwnsSpace(event.target)) return;
          event.preventDefault();
          onIndexChange(slideIndex + 1);
          break;
        case "ArrowLeft":
        case "ArrowUp":
        case "PageUp":
          event.preventDefault();
          onIndexChange(slideIndex - 1);
          break;
        case "Home":
          event.preventDefault();
          onIndexChange(0);
          break;
        case "End":
          event.preventDefault();
          onIndexChange(total - 1);
          break;
        case "Escape":
          event.preventDefault();
          onExit();
          break;
        case "n":
        case "N":
          event.preventDefault();
          setNotesOpen((open) => !open);
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onExit, onIndexChange, slideIndex, total]);

  /* Auto-hiding chrome: visible on entry, hidden after the idle window, and
     woken by any pointer movement or key press. The state changes happen in
     timers and event listeners, never synchronously in the effect. */
  useEffect(() => {
    const scheduleHide = () => {
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
      }
      hideTimerRef.current = window.setTimeout(() => {
        hideTimerRef.current = null;
        setChromeVisible(false);
      }, CHROME_HIDE_MS);
    };
    const wake = () => {
      setChromeVisible(true);
      scheduleHide();
    };
    scheduleHide();
    window.addEventListener("pointermove", wake);
    window.addEventListener("keydown", wake);
    return () => {
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
      window.removeEventListener("pointermove", wake);
      window.removeEventListener("keydown", wake);
    };
  }, []);

  /* Real fullscreen when the browser allows it; the overlay presents either
     way. Only a successful entry arms the browser-level exit (Esc consumed by
     the fullscreen UI arrives here as `fullscreenchange`). Layout effect, not
     a passive one: the request must run inside the click's own task, or the
     browser's user-activation check rejects it (this component only ever
     mounts on that interaction). The deferred exit keeps development's
     double-invoked effects from tearing the fullscreen straight back down. */
  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;

    if (exitTimerRef.current !== null) {
      window.clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }

    if (
      !fullscreenRequestedRef.current &&
      document.fullscreenEnabled === true &&
      document.fullscreenElement === null &&
      typeof overlay.requestFullscreen === "function"
    ) {
      fullscreenRequestedRef.current = true;
      overlay.requestFullscreen().catch(() => {
        // Honest no-op: the overlay still presents, windowed.
        fullscreenRequestedRef.current = false;
      });
    }

    const onFullscreenChange = () => {
      if (document.fullscreenElement === null) onExit();
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      exitTimerRef.current = window.setTimeout(() => {
        exitTimerRef.current = null;
        fullscreenRequestedRef.current = false;
        if (document.fullscreenElement !== null) {
          void document.exitFullscreen().catch(() => {
            // Already out; nothing to restore.
          });
        }
      }, 0);
    };
  }, [onExit]);

  /* Focus trap: focus moves into the overlay, Tab cycles its controls, and
     leaving restores focus to the control that opened present mode. */
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const previous =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    overlay.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const focusable = overlay.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      /* The overlay itself is focused on entry (tabIndex={-1}); it is a
         recapture point, not a tab stop, so both its Tab and Shift+Tab must
         land on the first/last control instead of escaping to the page. */
      const outside =
        !(active instanceof Node) || !overlay.contains(active) || active === overlay;
      if (event.shiftKey) {
        if (active === first || outside) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || outside) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      previous?.focus();
    };
  }, []);

  useEffect(() => {
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
  }, []);

  const chromeTransition = reduced
    ? { duration: 0 }
    : { duration: DURATION.panel, ease: EASE_OUT };

  return (
    <div
      ref={overlayRef}
      data-present-mode=""
      role="dialog"
      aria-modal="true"
      aria-label={`Presenting ${title}`}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex flex-col bg-scrim backdrop-blur-md focus:outline-none"
    >
      {/* Edge click zones — the pointer equivalent of the arrows. Real
          controls (buttons and the keyboard) carry the accessible action. */}
      <div
        aria-hidden="true"
        className="absolute inset-y-0 left-0 z-10 w-1/4 cursor-w-resize"
        onClick={() => onIndexChange(slideIndex - 1)}
      />
      <div
        aria-hidden="true"
        className="absolute inset-y-0 right-0 z-10 w-1/4 cursor-e-resize"
        onClick={() => onIndexChange(slideIndex + 1)}
      />

      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div
          className="w-full"
          style={{ maxWidth: "calc((100vh - 2rem) * 16 / 9)" }}
        >
          <DeckStage
            deck={deck}
            id={id}
            slideIndex={slideIndex}
            scale="fit-width"
            interactive
          />
        </div>
      </div>

      <motion.div
        initial={false}
        animate={{ opacity: chromeVisible ? 1 : 0 }}
        transition={chromeTransition}
        className={`absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-3 bg-surface-inverted p-3 text-surface-inverted-foreground sm:p-4 ${
          chromeVisible ? "" : "pointer-events-none"
        }`}
      >
        <p className="min-w-0 truncate font-heading text-label-sm font-semibold">
          {title}
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <IconButton
            aria-label="Toggle speaker notes"
            variant="outline-inverted"
            size="sm"
            aria-pressed={notesOpen}
            onClick={() => setNotesOpen((open) => !open)}
          >
            <StickyNote aria-hidden="true" className="size-4" />
          </IconButton>
          <IconButton
            aria-label="Exit present mode"
            variant="outline-inverted"
            size="sm"
            onClick={onExit}
          >
            <X aria-hidden="true" className="size-4" />
          </IconButton>
        </div>
      </motion.div>

      <motion.div
        initial={false}
        animate={{ opacity: chromeVisible ? 1 : 0 }}
        transition={chromeTransition}
        className={`absolute inset-x-0 bottom-0 z-20 flex flex-col gap-2 bg-surface-inverted p-3 text-surface-inverted-foreground sm:p-4 ${
          chromeVisible ? "" : "pointer-events-none"
        }`}
      >
        <div className="flex items-center gap-2">
          <IconButton
            aria-label="Previous slide"
            variant="outline-inverted"
            size="sm"
            disabled={slideIndex <= 0}
            onClick={() => onIndexChange(slideIndex - 1)}
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
          </IconButton>
          <IconButton
            aria-label="Next slide"
            variant="outline-inverted"
            size="sm"
            disabled={slideIndex >= total - 1}
            onClick={() => onIndexChange(slideIndex + 1)}
          >
            <ChevronRight aria-hidden="true" className="size-4" />
          </IconButton>
          <p
            data-present-counter=""
            className="ml-1 font-mono text-label-sm"
          >
            {slideIndex + 1} / {total}
          </p>
        </div>
        <div
          role="progressbar"
          aria-label="Presentation progress"
          aria-valuemin={1}
          aria-valuemax={Math.max(total, 1)}
          aria-valuenow={Math.min(slideIndex + 1, Math.max(total, 1))}
          className="h-1 w-full overflow-hidden rounded-pill bg-surface-inverted-nested"
        >
          <motion.div
            initial={false}
            animate={{ scaleX: total > 0 ? (slideIndex + 1) / total : 0 }}
            transition={reduced ? { duration: 0 } : railFillIn}
            className="h-full origin-left rounded-pill bg-surface-inverted-foreground"
          />
        </div>
      </motion.div>

      <MotionPopover
        open={notesOpen}
        direction="up"
        origin="right bottom"
        className="absolute bottom-20 right-3 z-30 w-80 max-w-[calc(100vw-1.5rem)] rounded-card border border-border-inverted bg-surface-inverted-nested p-4 text-surface-inverted-foreground shadow-overlay"
      >
        <p className="font-mono text-label-caps uppercase">
          Speaker notes
        </p>
        <p className="mt-2 max-h-64 overflow-y-auto text-body-md">
          {currentNote !== "" ? currentNote : "No notes for this slide."}
        </p>
      </MotionPopover>
    </div>
  );
}

export type { PresentModeProps };
