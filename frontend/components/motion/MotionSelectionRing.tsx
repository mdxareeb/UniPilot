"use client";

import { motion } from "motion/react";
import { softSpring } from "./presets";

type MotionSelectionRingProps = {
  /**
   * Shared-layout id: every surface in one selection group renders its ring
   * with the same id, and the ring travels between them when the selection
   * moves. Different groups need different ids.
   */
  layoutId: string;
  /**
   * Must match the rounded-* class of the surface the ring sits on, or the
   * ring's corners drift off the card's. `rounded-base` for compact cards,
   * `rounded-card` for default ones, `rounded-pill` for segmented controls.
   */
  radiusClass?: string;
};

/**
 * The shared-layout selection indicator.
 *
 * Render inside the currently selected surface (which must be `relative`):
 * an absolutely positioned border that exists on exactly one item at a time.
 * When the selection moves, Motion's `layoutId` animates the ring from the
 * old position to the new one on `softSpring` — the selection visibly
 * travels rather than blinking, which is what reads as one product instead
 * of three independent toggles.
 *
 * `pointer-events-none` keeps it out of hit testing; the surface underneath
 * stays the click target. Under `prefers-reduced-motion: reduce`,
 * `MotionConfig reducedMotion="user"` disables layout animation, so the ring
 * lands on the new selection instantly.
 */
export function MotionSelectionRing({
  layoutId,
  radiusClass = "rounded-base",
}: MotionSelectionRingProps) {
  return (
    <motion.span
      aria-hidden="true"
      layoutId={layoutId}
      transition={softSpring}
      className={`pointer-events-none absolute inset-0 ${radiusClass} border-2 border-foreground`}
    />
  );
}

export type { MotionSelectionRingProps };
