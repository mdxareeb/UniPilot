"use client";

/**
 * The rail's dialog-popover wiring (Task D6; shared by D9's element menu).
 *
 * `MotionPopover` owns the animation only. A panel declared `role="dialog"`
 * owes its role real behavior, and both rail palettes (the deck's layout
 * palette and the infographic element menu) are the same surface: focus moves
 * into the panel on open, Escape closes and returns focus to the trigger, and
 * an outside pointer press dismisses the panel without stealing focus from
 * where the press landed. The hook keeps that wiring in one place instead of
 * duplicating it per menu.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

export type DialogPopoverController = {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Closes the panel; focus returns to the trigger unless asked otherwise. */
  close: (returnFocus?: boolean) => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
  panelRef: RefObject<HTMLDivElement | null>;
};

export function useDialogPopover(): DialogPopoverController {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    if (returnFocus) {
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const focusFrame = window.requestAnimationFrame(() => {
      panelRef.current
        ?.querySelector<HTMLElement>(
          "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
        )
        ?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      close();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target === null) return;
      if (panelRef.current?.contains(target)) return;
      if (triggerRef.current?.parentElement?.contains(target)) return;
      close(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [close, open]);

  return { open, setOpen, close, triggerRef, panelRef };
}
