"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { DURATION, EASE_OUT, popoverVariants, scrimVariants } from "@/components/motion/presets";
import { IconButton } from "./IconButton";

type ModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  showClose?: boolean;
  closeOnBackdropClick?: boolean;
  /**
   * Extra header controls, rendered just before the close button. Used by the
   * document preview's expand/collapse toggle.
   */
  headerActions?: ReactNode;
  /**
   * The panel fills the viewport — no outer padding, no radius, no border and a
   * single tight content gutter — instead of the compact centred dialog. The
   * caller toggles this (the document preview's expand state); everything else
   * stays the same, including focus trapping and the scrim.
   */
  fullscreen?: boolean;
  /**
   * Layout-animate the panel when its geometry changes (the expand/collapse
   * toggle). Uses Motion's shared layout transition; instant under reduced
   * motion. Off by default so other dialogs keep their exact behaviour.
   */
  animateLayout?: boolean;
  /**
   * When provided, the dialog's cancel (Escape) runs this instead of closing —
   * the preview collapses first and closes on a second press. The caller owns
   * the close decision; the native `close` path still reports through
   * `onOpenChange`.
   */
  onEscape?: () => void;
};

/**
 * The project's dialog primitive, built on the native `<dialog>` element.
 *
 * Motion is the shared popup system, not a private one: the panel animates
 * with the centred popover variants and the scrim with the shared scrim
 * variants, so a modal opens and closes with the same fade + scale language
 * as the assistant panel, the profile menu and the search popover (see
 * MOTION.md). Future floating surfaces should reuse those behaviours rather
 * than add new ones.
 *
 * The native dialog and the transition need two different clocks, which is
 * what the `visible` state is for. `showModal()` puts the dialog in the top
 * layer — before that call it is `display: none`, and an animation that
 * starts from `display: none` has no starting frame. So the sequence on open
 * is: put the dialog in the top layer, then flip `visible`, which Motion
 * animates from the closed values it already holds (`initial={false}` keeps
 * them applied from mount). On close the order inverts: `visible` flips first
 * so the exit plays, and `dialog.close()` waits for the exit duration before
 * removing the dialog from the top layer. Under `prefers-reduced-motion:
 * reduce` every duration is zero and the dialog closes immediately.
 *
 * Escape is intercepted on `cancel` and routed through `onOpenChange` like
 * every other close: letting the browser close natively would skip the exit
 * transition and desynchronise the scrim. The native `close` event still
 * calls `onOpenChange(false)` as the final authority, which is a no-op when
 * the parent already knows.
 */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
  showClose = true,
  closeOnBackdropClick = true,
  headerActions,
  fullscreen = false,
  animateLayout = false,
  onEscape,
}: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const reduced = useReducedMotion() ?? false;
  /* Drives the panel and the scrim separately from the native `open`
     attribute, so both can transition — see the component note. */
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      if (!dialog.open) dialog.showModal();
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the second frame is the animation: the dialog must be in the top layer before visible flips
      setVisible(true);
      return;
    }

    setVisible(false);
    if (!dialog.open) return;
    if (reduced) {
      dialog.close();
      return;
    }
    // Matches `DURATION.panelExit` (150ms).
    const timeout = window.setTimeout(
      () => dialog.close(),
      DURATION.panelExit * 1000,
    );
    return () => window.clearTimeout(timeout);
  }, [open, reduced]);

  useEffect(() => {
    if (!open) return;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        if (onEscape) onEscape();
        else onOpenChange(false);
      }}
      onClose={() => onOpenChange(false)}
      className={`fixed inset-0 z-50 m-0 h-full max-h-none w-full max-w-none items-start justify-center overflow-hidden border-none bg-transparent open:flex ${
        fullscreen ? "p-0" : "p-5 sm:px-6 sm:py-8"
      }`}
    >
      <motion.div
        aria-hidden="true"
        initial={false}
        animate={visible ? "visible" : "hidden"}
        variants={scrimVariants(reduced)}
        className="bg-scrim absolute inset-0 backdrop-blur-md"
        onClick={closeOnBackdropClick ? () => onOpenChange(false) : undefined}
      />
      <motion.div
        initial={false}
        animate={visible ? "visible" : "hidden"}
        variants={popoverVariants("center", reduced)}
        layout={animateLayout && !reduced}
        transition={
          animateLayout && !reduced
            ? { layout: { duration: DURATION.panel, ease: EASE_OUT } }
            : undefined
        }
        style={{ transformOrigin: "center" }}
        className={`relative z-10 flex flex-col overflow-hidden bg-glass bg-dotted-surface text-card-foreground shadow-overlay backdrop-blur-md ${
          fullscreen
            ? "h-full max-h-none w-full max-w-none rounded-none border-0"
            : "my-auto max-h-full w-full max-w-lg rounded-card border border-border"
        }${className ? ` ${className}` : ""}`}
      >
        <div
          className={`flex justify-between gap-4 ${
            fullscreen
              ? "items-center p-4 pb-0 sm:px-5"
              : "items-start p-8 pb-0"
          }`}
        >
          <div className="flex min-w-0 flex-col gap-2">
            <h2 id={titleId} className="text-headline-md">
              {title}
            </h2>
            {description && (
              <p
                id={descriptionId}
                className="text-body-md text-muted-foreground"
              >
                {description}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {headerActions}
            {showClose && (
              <IconButton
                aria-label="Close dialog"
                onClick={() => onOpenChange(false)}
              >
                <X aria-hidden="true" className="size-4" />
              </IconButton>
            )}
          </div>
        </div>
        <div
          className={
            fullscreen
              ? "flex min-h-0 flex-1 flex-col overflow-hidden p-3 sm:p-4"
              : "overflow-y-auto p-8"
          }
        >
          {children}
        </div>
      </motion.div>
    </dialog>
  );
}

export type { ModalProps };
