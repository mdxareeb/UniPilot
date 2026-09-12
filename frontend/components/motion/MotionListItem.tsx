"use client";

import type { HTMLAttributes, ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { listItemIn, listItemVariants } from "./presets";

const LIST_TAGS = {
  li: motion.li,
  div: motion.div,
} as const;

type MotionListItemProps = Omit<
  HTMLAttributes<HTMLElement>,
  "children" | "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart"
> & {
  /** Element to render. Defaults to `li`. */
  as?: keyof typeof LIST_TAGS;
  children?: ReactNode;
};

/**
 * One row of a list that gains and loses members: onboarding subjects today,
 * task and document lists later. Place inside `AnimatePresence` and give each
 * one a stable `key`.
 *
 * A new row drops in from 6px above its own position; a removed row fades out
 * quickly (150ms — an exit is faster than an entrance, because the user has
 * already decided). `layout` is what makes removal read as removal: the rows
 * below animate up into the freed space instead of jumping, and because every
 * row in the list is one of these, they all move together.
 *
 * Under `prefers-reduced-motion: reduce` the transition duration is zero and
 * `MotionProvider`'s `reducedMotion="user"` switches layout animation off, so
 * rows appear and disappear instantly with the same list semantics.
 */
export function MotionListItem({
  as = "li",
  children,
  ...props
}: MotionListItemProps) {
  const reduced = useReducedMotion() ?? false;

  const Tag = LIST_TAGS[as] as typeof motion.li;

  return (
    <Tag
      layout
      initial="initial"
      animate="animate"
      exit="exit"
      variants={listItemVariants(reduced)}
      transition={reduced ? { duration: 0 } : listItemIn}
      {...props}
    >
      {children}
    </Tag>
  );
}

export type { MotionListItemProps };
