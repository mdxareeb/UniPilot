"use client";

import type { HTMLAttributes, ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { menuItemVariants, menuVariants } from "./presets";

/**
 * React's `HTMLAttributes` and Motion's props both define `onDrag` (and
 * `onAnimationStart`) with incompatible signatures; the React ones are
 * dropped so the spread below typechecks against `motion.div`/`motion.nav`.
 */
type MotionMenuProps = Omit<
  HTMLAttributes<HTMLElement>,
  "children" | "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart"
> & {
  open: boolean;
  /** Element to render. Defaults to `div`; `nav` for navigation drawers. */
  as?: "div" | "nav";
  children?: ReactNode;
};

/**
 * The mobile navigation drawer's motion, built on Motion.
 *
 * The parent owns the fade + 8px drop; the items inside stagger in at 40ms
 * through variant propagation and leave together — a staggered exit would make
 * closing feel slower than opening. `AnimatePresence` unmounts the drawer once
 * its exit finishes, so a closed drawer is out of the tab order and the
 * accessibility tree with no `visibility` machinery.
 *
 * Under `prefers-reduced-motion: reduce` every duration and stagger is zero:
 * the drawer appears and disappears instantly, and functionality is never
 * hidden.
 */
export function MotionMenu({
  open,
  as = "div",
  children,
  ...props
}: MotionMenuProps) {
  const reduced = useReducedMotion() ?? false;
  const Tag = as === "nav" ? motion.nav : motion.div;

  return (
    <AnimatePresence>
      {open ? (
        <Tag
          data-menu=""
          initial="hidden"
          animate="visible"
          exit="hidden"
          variants={menuVariants(reduced)}
          {...props}
        >
          {children}
        </Tag>
      ) : null}
    </AnimatePresence>
  );
}

type MotionMenuItemProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  "children" | "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart"
> & {
  children?: ReactNode;
};

/**
 * One staggered row inside `MotionMenu`. Wraps its content — a link, a
 * divider row, the account footer — in the item variant; the parent's
 * `staggerChildren` supplies the delay, so no row states its own.
 */
export function MotionMenuItem({ children, ...props }: MotionMenuItemProps) {
  const reduced = useReducedMotion() ?? false;

  return (
    <motion.div
      data-menu-item=""
      variants={menuItemVariants(reduced)}
      {...props}
    >
      {children}
    </motion.div>
  );
}

export type { MotionMenuItemProps, MotionMenuProps };
