"use client";

import type { HTMLAttributes, ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  revealGroupItemVariants,
  revealGroupVariants,
  type RevealVariant,
} from "./presets";
import { useRevealRepeat } from "./useRevealRepeat";

const GROUP_TAGS = {
  div: motion.div,
  section: motion.section,
  ul: motion.ul,
  ol: motion.ol,
  li: motion.li,
} as const;

const ITEM_TAGS = {
  div: motion.div,
  li: motion.li,
  span: motion.span,
  p: motion.p,
  h2: motion.h2,
  h3: motion.h3,
  header: motion.header,
} as const;

/**
 * React's `HTMLAttributes` and Motion's props both define `onDrag` (and
 * `onAnimationStart`) with incompatible signatures; the React ones are
 * dropped so the spreads below typecheck against the `motion.*` tags.
 */
type MotionOwnProps = Omit<
  HTMLAttributes<HTMLElement>,
  "children" | "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart"
>;

type MotionRevealGroupProps = MotionOwnProps & {
  /**
   * Element to render. Defaults to `div`; `ul`/`ol` when the group is a list,
   * `li` when one row of a list is itself the composition.
   */
  as?: keyof typeof GROUP_TAGS;
  /**
   * Replay behaviour, same contract as `MotionReveal`: the group re-hides once
   * it has left through the bottom and plays again next time it is reached.
   * Anything that leaves through the top stays revealed.
   */
  repeat?: boolean;
  children?: ReactNode;
};

/**
 * MotionRevealGroup — one section revealing as a composition.
 *
 * The group observes the viewport once and holds the play state; every
 * `MotionRevealItem` inside it inherits that state through Motion's variant
 * propagation and starts one stagger step after the item before it. A section
 * header followed by three cards is written as a header item and three card
 * items, and it plays as header → card → card → card without any of the four
 * naming a delay.
 *
 * Choose this over per-element `MotionReveal index={n}` when the elements are
 * one composition. Keep `MotionReveal` for a single element, or for two halves
 * of a row that should arrive from opposite directions at the same moment.
 *
 * Safety, unchanged from `MotionReveal`:
 * - the group animates nothing itself, so no large container is ever
 *   transformed
 * - the hidden state is Motion's `initial` on the children, rendered
 *   identically on server and client — no pre-hydration DOM mutation and no
 *   `data-revealed`-style mismatch
 * - children emit `data-reveal`, so the layouts' `<noscript>` rule still
 *   un-hides them when scripts never run
 * - content is always structurally rendered; only opacity and transform move
 */
export function MotionRevealGroup({
  as = "div",
  repeat = false,
  children,
  ...props
}: MotionRevealGroupProps) {
  const reduced = useReducedMotion() ?? false;
  const { ref, revealed } = useRevealRepeat(repeat);

  const Tag = GROUP_TAGS[as] as typeof motion.div;

  /* The play-once path uses Motion's own viewport tracking; the replay path
     needs the two-observer hysteresis, which Motion's single boundary cannot
     express. Both render the same element with the same variants, so the
     branch costs nothing structurally. */
  if (repeat) {
    return (
      <Tag
        ref={(element) => {
          ref.current = element;
        }}
        data-reveal-group=""
        initial="hidden"
        animate={revealed ? "visible" : "hidden"}
        variants={revealGroupVariants(reduced)}
        {...props}
      >
        {children}
      </Tag>
    );
  }

  return (
    <Tag
      data-reveal-group=""
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.01, margin: "0px 0px -8% 0px" }}
      variants={revealGroupVariants(reduced)}
      {...props}
    >
      {children}
    </Tag>
  );
}

type MotionRevealItemProps = MotionOwnProps & {
  /** Element to render. Defaults to `div`; `li` inside a `ul`/`ol` group. */
  as?: keyof typeof ITEM_TAGS;
  /**
   * Direction this member arrives from. The group's members are free to differ
   * — a header rising while the cards under it arrive with depth is the point —
   * but they share one timeline.
   */
  variant?: RevealVariant;
  children?: ReactNode;
};

/**
 * One member of a `MotionRevealGroup`.
 *
 * Sets `variants` and nothing else: an `initial` or `animate` here would cut
 * the item off from the parent's timeline and turn the group back into N
 * independent animations. Order comes from DOM order.
 */
export function MotionRevealItem({
  as = "div",
  variant = "up",
  children,
  ...props
}: MotionRevealItemProps) {
  const reduced = useReducedMotion() ?? false;

  const Tag = ITEM_TAGS[as] as typeof motion.div;

  return (
    <Tag
      data-reveal=""
      variants={revealGroupItemVariants(variant, reduced)}
      {...props}
    >
      {children}
    </Tag>
  );
}

export type { MotionRevealGroupProps, MotionRevealItemProps };
