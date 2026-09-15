"use client";

import type { HTMLAttributes, ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  POPOVER_ORIGIN,
  popoverVariants,
  type PopoverDirection,
} from "./presets";

/**
 * React's `HTMLAttributes` and Motion's props both define `onDrag` (and
 * `onAnimationStart`) with incompatible signatures; the React ones are
 * dropped so the spread below typechecks against `motion.div`.
 */
type MotionPopoverProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  "children" | "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart"
> & {
  open: boolean;
  /**
   * Where the panel arrives from relative to its final position: `up` for a
   * panel opening above its trigger, `down` for one dropping from a top-bar
   * trigger, `center` for a surface that grows in place.
   */
  direction?: PopoverDirection;
  /**
   * `transform-origin` override. Defaults per direction (see `POPOVER_ORIGIN`)
   * so the panel grows out of the control that opened it rather than out of
   * its own centre.
   */
  origin?: string;
  children?: ReactNode;
  /**
   * Mount the panel in `document.body` instead of in place. A popover rendered
   * inside the glass rail cannot blur the page: the rail is itself a
   * `backdrop-blur-md` element, and a backdrop filter nested inside another one
   * samples the parent's painted output, while absolute positioning is trapped
   * by ancestor stacking contexts. Portalling puts the panel in the page's own
   * backdrop root — pair it with fixed positioning computed from the trigger.
   * The panel still unmounts through `AnimatePresence` when closed.
   */
  portal?: boolean;
};

/**
 * The project's one popup transition, built on Motion.
 *
 * Every floating surface that appears and disappears — menus, notifications,
 * search, assistant, dialogs, and any future tool panel — renders its panel
 * through this component and sets only its `direction` and, when its anchor
 * calls for it, its `origin`. Do not create a second popup animation.
 *
 * Fade + 8px directional translate + `scale(0.97)`, opening at 220ms and
 * closing at 150ms — exits are deliberately faster than entrances, because
 * opening is the part worth watching. `AnimatePresence` keeps the panel
 * mounted until its exit finishes, then unmounts it: a closed panel is out of
 * the DOM, so it is out of the tab order and the accessibility tree with no
 * `visibility` machinery and no `aria-hidden` bookkeeping.
 *
 * Under `prefers-reduced-motion: reduce` every duration is zero — the panel
 * appears and disappears instantly, with no slide or scale — and functionality
 * is never hidden.
 */
export function MotionPopover({
  open,
  direction = "up",
  origin,
  style,
  children,
  portal = false,
  ...props
}: MotionPopoverProps) {
  const reduced = useReducedMotion() ?? false;

  const panel = (
    <AnimatePresence>
      {open ? (
        <motion.div
          data-popover=""
          initial="hidden"
          animate="visible"
          exit="hidden"
          variants={popoverVariants(direction, reduced)}
          style={{
            transformOrigin: origin ?? POPOVER_ORIGIN[direction],
            ...style,
          }}
          {...props}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );

  if (!portal) return panel;
  /* Server render has no portal host; the panel is client-only anyway (it
     mounts on interaction), so an empty client portal hydrates cleanly. */
  return typeof document === "undefined" ? null : createPortal(panel, document.body);
}

export type { MotionPopoverProps };
