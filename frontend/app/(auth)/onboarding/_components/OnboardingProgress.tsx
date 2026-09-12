"use client";

import { Fragment } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  railFillIn,
  railFillVariants,
  railMarkerVariants,
} from "@/components/motion/presets";

type OnboardingProgressProps = {
  /** 1-based position in the sequence. */
  step: number;
  totalSteps: number;
};

function pad(value: number) {
  return String(value).padStart(2, "0");
}

/**
 * Where the reader is in the onboarding sequence, stated twice: a marker rail
 * and a mono counter.
 *
 * The rail is the same dot-and-hairline idiom as the `/how-it-works` hero, so
 * onboarding reads as the same product. It sits on one flex row with a
 * `shrink-0` counter, which is what keeps it from wrapping at 320px however
 * many steps there are.
 *
 * The progress itself is animated rather than swapped: each hairline is a track
 * with a fill that scales in from its left edge, and the marker it runs into
 * grows to full size as it is reached. Both reverse on Back, which is the point
 * — a rail that only ever snapped forward would make going back feel like a
 * different, worse action than going forward.
 *
 * `initial={false}` on both: the rail's first paint is a state, not an
 * entrance. Landing on step one should show one filled marker immediately,
 * without three hundred milliseconds of a rail assembling itself, and it keeps
 * the server and client markup identical. Under reduced motion the transitions
 * are zero-length and the rail simply reads correctly at all times.
 *
 * A filled marker means "reached", not "saved" — since 13.10 the answers are
 * persisted only when the final step's save succeeds, and the rail itself never
 * claims anything is stored.
 */
export function OnboardingProgress({
  step,
  totalSteps,
}: OnboardingProgressProps) {
  const reduced = useReducedMotion();
  // The flow never sets a step past the last one — Continue there leaves for the
  // dashboard rather than advancing — so this clamp is a guard, not a state the
  // rail has to depict: "07 / 06" would also put `aria-valuenow` past its own
  // maximum.
  const reachedStep = Math.min(step, totalSteps);
  const transition = reduced ? { duration: 0 } : railFillIn;

  return (
    <div className="flex items-center gap-3">
      {/* One progressbar for the whole rail. The markers inside it are
          presentational, so a screen reader reads the step position once
          rather than announcing a dozen anonymous spans. */}
      <div
        role="progressbar"
        aria-label="Onboarding progress"
        aria-valuemin={1}
        aria-valuemax={totalSteps}
        aria-valuenow={reachedStep}
        aria-valuetext={`Step ${reachedStep} of ${totalSteps}`}
        className="flex min-w-0 flex-1 items-center"
      >
        {Array.from({ length: totalSteps }, (_, index) => {
          const position = index + 1;
          const reached = position <= reachedStep;

          return (
            <Fragment key={position}>
              {index > 0 ? (
                /* Track and fill rather than one colour-swapping line: a
                   colour crossfade says the segment changed, a fill that
                   travels says the reader moved along it. The track keeps the
                   layout width so nothing on the row reflows mid-step. */
                <span className="relative h-px min-w-0 flex-1 bg-border">
                  <motion.span
                    className="absolute inset-0 origin-left bg-foreground"
                    initial={false}
                    animate={reached ? "visible" : "hidden"}
                    variants={railFillVariants}
                    transition={transition}
                  />
                </span>
              ) : null}
              {/* `transition-colors` carries the fill and border colour; the
                  scale is Motion's. Two properties, two owners, neither
                  fighting the other for the same declaration. */}
              <motion.span
                className={`size-2.5 shrink-0 rounded-full border transition-colors ${
                  reached
                    ? "border-foreground bg-foreground"
                    : "border-border bg-card"
                }`}
                initial={false}
                animate={reached ? "visible" : "hidden"}
                variants={railMarkerVariants}
                transition={transition}
              />
            </Fragment>
          );
        })}
      </div>
      {/* Hidden from assistive tech on purpose: "02 / 06" read aloud is noise
          next to the progressbar's "Step 2 of 6", which says the same thing. */}
      <span
        aria-hidden="true"
        className="shrink-0 font-mono text-label-caps text-muted-foreground"
      >
        {pad(reachedStep)} / {pad(totalSteps)}
      </span>
    </div>
  );
}
