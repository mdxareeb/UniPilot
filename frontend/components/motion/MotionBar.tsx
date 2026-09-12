"use client";

import { useRef } from "react";
import { motion, useInView, useReducedMotion } from "motion/react";
import { DURATION, EASE_OUT, STAGGER, barVariants } from "./presets";

type MotionBarProps = {
  /** The bar's layout width — its final size, reserved from the start. */
  width: string;
  /** Stagger position within the group: delay = index × `--stagger-sm`. */
  index?: number;
  trackClassName?: string;
  barClassName?: string;
};

/**
 * A benchmark bar that fills from the left when its track scrolls into view.
 *
 * The track is observed rather than the bar: the bar starts clipped to zero
 * visible area, and a zero-area element never reports as intersecting. The
 * bar's `width` stays the layout value it always was, so the track reserves
 * its final size and nothing reflows; the fill is `clip-path` only.
 *
 * Fills once and does not loop. Under reduced motion the bar renders full
 * immediately; without JavaScript the `<noscript>` fallback in the layouts
 * un-clips every `[data-reveal-bar]`.
 */
export function MotionBar({
  width,
  index = 0,
  trackClassName = "h-1.5 w-full overflow-hidden rounded-pill bg-muted",
  barClassName = "h-1.5 rounded-pill bg-foreground",
}: MotionBarProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const inView = useInView(trackRef, {
    once: true,
    amount: 0.01,
    margin: "0px 0px -8% 0px",
  });

  return (
    <div ref={trackRef} aria-hidden="true" className={trackClassName}>
      <motion.div
        data-reveal-bar=""
        className={barClassName}
        style={{ width }}
        initial="hidden"
        animate={reduced || inView ? "visible" : "hidden"}
        variants={barVariants}
        transition={{
          duration: reduced ? 0 : DURATION.bar,
          ease: EASE_OUT,
          delay: reduced ? 0 : index * STAGGER.sm,
        }}
      />
    </div>
  );
}

export type { MotionBarProps };
