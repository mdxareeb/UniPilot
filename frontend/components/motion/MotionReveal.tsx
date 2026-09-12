"use client";

import type { HTMLAttributes, ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  STAGGER,
  revealIn,
  revealRepeatVariants,
  revealVariantFrom,
  revealVariants,
  type RevealVariant,
} from "./presets";
import { useRevealRepeat } from "./useRevealRepeat";

const MOTION_TAGS = {
  div: motion.div,
  li: motion.li,
  span: motion.span,
  p: motion.p,
  section: motion.section,
} as const;

export type MotionRevealTag = keyof typeof MOTION_TAGS;

/**
 * React's `HTMLAttributes` and Motion's props both define `onDrag` (and
 * `onAnimationStart`) with incompatible signatures; the React ones are
 * dropped so the spread below typechecks against the `motion.*` tags.
 */
type MotionRevealProps = Omit<
  HTMLAttributes<HTMLElement>,
  "children" | "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart"
> & {
  /** Element to render. Defaults to `div`; `li` for grid items, etc. */
  as?: MotionRevealTag;
  /**
   * Replay variant: reveals coming down, resets once the element has left
   * through the bottom, reveals again next time it is reached. Anything that
   * leaves through the top stays revealed.
   */
  repeat?: boolean;
  /**
   * Direction of the entrance. `up` (the default) is the homepage reference;
   * use `left`/`right` for the two halves of an alternating row, `scale` for
   * cards and surfaces that should arrive with depth, `down` sparingly for
   * content that reads as dropping into place. Variety lives in choosing the
   * right one per UI, not in inventing new ones.
   */
  variant?: RevealVariant;
  /** Stagger position within the group: delay = index × `--stagger-sm`. */
  index?: number;
  children?: ReactNode;
};

/**
 * MotionReveal — the project's one scroll reveal, built on Motion.
 *
 * Fade + 16px rise (the homepage's visual reference), 380ms in with a stagger
 * delay from `index`, 260ms out without one. The play-once variant uses
 * Motion's own viewport tracking (`whileInView`, `once`); the replay variant
 * uses `useRevealRepeat` above.
 *
 * Safety rules this component exists to keep:
 * - One render path on server and client. Reduced motion zeroes durations and
 *   delays rather than switching to a different element — a structural branch
 *   on `useReducedMotion()` would render different markup on the server
 *   (no matchMedia) than on the client and break hydration, leaving content
 *   stuck at the server-rendered hidden state. Durations are never serialized
 *   to HTML, so this path cannot mismatch. Under `reduce`, everything lands
 *   instantly; `MotionProvider`'s `reducedMotion="user"` additionally disables
 *   transform animation at the library level.
 * - The hidden state is Motion's `initial`, rendered identically on server
 *   and client, so there is no hydration mismatch and no pre-hydration
 *   DOM mutation (the failure mode of the old `data-revealed` attribute).
 * - It still emits `data-reveal`, so the layouts' `<noscript>` fallback keeps
 *   un-hiding every target when scripts never run.
 * - Content is always structurally rendered; animation only ever controls
 *   opacity and transform, never existence.
 */
export function MotionReveal({
  as = "div",
  repeat = false,
  variant = "up",
  index = 0,
  children,
  ...props
}: MotionRevealProps) {
  const reduced = useReducedMotion() ?? false;
  const { ref, revealed } = useRevealRepeat(repeat);

  const Tag = MOTION_TAGS[as] as typeof motion.div;

  if (repeat) {
    return (
      <Tag
        ref={(element) => {
          ref.current = element;
        }}
        data-reveal=""
        data-reveal-repeat=""
        initial="hidden"
        animate={revealed ? "visible" : "hidden"}
        variants={revealRepeatVariants(index, reduced, variant)}
        {...props}
      >
        {children}
      </Tag>
    );
  }

  return (
    <Tag
      data-reveal=""
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.01, margin: "0px 0px -8% 0px" }}
      variants={variant === "up" ? revealVariants : revealVariantFrom(variant)}
      transition={
        reduced ? { duration: 0 } : { ...revealIn, delay: index * STAGGER.sm }
      }
      {...props}
    >
      {children}
    </Tag>
  );
}

export type { MotionRevealProps };
