"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { motionIndex } from "@/components/motion/stagger";
import { MotionNotice } from "@/components/motion/MotionNotice";
import { DURATION, EASE_OUT, stepVariants } from "@/components/motion/presets";
import { Button } from "@/components/ui/Button";
import { OnboardingProgress } from "./OnboardingProgress";
import { SkipOnboarding } from "./SkipOnboarding";

type OnboardingShellProps = {
  /** 1-based position in the sequence. */
  step: number;
  totalSteps: number;
  /** Short label for what the current step is about, above its heading. */
  eyebrow?: string;
  /** Heading for the current step. */
  title: string;
  description?: string;
  /** The step's own content. Later tasks fill this slot. */
  children: ReactNode;
  /** Omit to render Back inert — there is nowhere to go back to. */
  onBack?: () => void;
  /** Omit to render Continue inert — the shell never advances on its own. */
  onNext?: () => void;
  /**
   * Leaves onboarding without finishing it. Omit to render no Skip at all — a
   * step the flow cannot do without should not offer a way past it.
   */
  onSkip?: () => void;
  /**
   * Renders Skip inert without taking it off the page, which is what omitting
   * `onSkip` does instead.
   *
   * Its own prop because absence and inertness say different things here — "this
   * step cannot be skipped" against "not while something else is already
   * happening" — and dropping the row for the length of a navigation would
   * change the card's height on the way out.
   */
  skipDisabled?: boolean;
  backLabel?: string;
  nextLabel?: string;
  /**
   * Sanitized failure copy from the final save, shown above the actions.
   * Absent until a write has actually failed; the flow owns when it clears.
   */
  error?: string;
};

/**
 * The onboarding shell: page chrome, progress, a content slot, and the
 * Back/Continue actions with the way out beneath them.
 *
 * It holds no state about the flow beyond what it is handed. Tasks 13.2–13.7
 * pass their own step content as `children` and their own handlers, so the
 * layout, progress and actions are written once here. Which steps offer Skip is
 * the flow's decision, not the shell's — the shell only renders the offer it is
 * given. The wordmark and the dotted background come from the shared `(auth)`
 * layout, which already wraps this route.
 */
export function OnboardingShell({
  step,
  totalSteps,
  eyebrow,
  title,
  description,
  children,
  onBack,
  onNext,
  onSkip,
  skipDisabled,
  backLabel = "Back",
  nextLabel = "Continue",
  error,
}: OnboardingShellProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusedStep = useRef(step);
  const reduced = useReducedMotion() ?? false;
  /* Direction of travel for the step change: forward slides in from the right,
     back from the left. Derived with React's "adjust state during render"
     pattern — the comparison happens against the step being replaced, and both
     values are plain state, so nothing reads a ref mid-render. */
  const [direction, setDirection] = useState<1 | -1>(1);
  const [previousStep, setPreviousStep] = useState(step);
  if (previousStep !== step) {
    setDirection(step < previousStep ? -1 : 1);
    setPreviousStep(step);
  }

  useEffect(() => {
    if (focusedStep.current === step) return;
    focusedStep.current = step;
    // Land keyboard and screen-reader users on the content that changed rather
    // than on the button they just pressed.
    headingRef.current?.focus();
  }, [step]);

  return (
    <div className="w-full max-w-[520px]">
      <p
        data-enter
        style={motionIndex(0)}
        className="font-mono text-label-caps uppercase text-muted-foreground"
      >
        Getting started
      </p>
      <h1
        data-enter
        style={motionIndex(1)}
        className="mt-3 text-headline-lg-mobile text-foreground"
      >
        Let&apos;s get your workspace ready.
      </h1>
      <div data-enter style={motionIndex(2)} className="mt-6">
        <OnboardingProgress step={step} totalSteps={totalSteps} />
      </div>
      {/* Same panel surface as the `/login` and `/signup` option cards. The
          frame stays put across steps; only its contents animate. Translucent so
          the fixed dotted canvas reads through it — the fields inside stay solid,
          because a control is something you aim at. */}
      <div
        data-enter
        style={motionIndex(3)}
        className="mt-5 rounded-card border border-border bg-glass p-5"
      >
        {/* `key={step}` remounts this region on every step change, which plays
            the shared step-enter variant: a fade plus a 16px slide from the
            direction of travel (forward from the right, back from the left),
            220ms, strong ease-out. The frame stays put across steps; only its
            contents move. Under `prefers-reduced-motion: reduce` the duration
            is zero, so the content simply appears in place. The actions below
            sit outside this region and are never gated by it. */}
        <motion.div
          key={step}
          initial="hidden"
          animate="visible"
          variants={stepVariants(direction)}
          transition={{ duration: reduced ? 0 : DURATION.panel, ease: EASE_OUT }}
        >
          {eyebrow ? (
            <p className="mb-2 font-mono text-label-caps uppercase text-muted-foreground">
              {eyebrow}
            </p>
          ) : null}
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="text-headline-md text-foreground focus:outline-none"
          >
            {title}
          </h2>
          {description ? (
            <p className="mt-2 text-body-md text-muted-foreground">
              {description}
            </p>
          ) : null}
          <div className="mt-4">{children}</div>
        </motion.div>
      </div>
      {/* Feedback about the whole submission lives between the card and its
          actions: close enough to the button that caused it, outside the step
          region that remounts, so a server failure is not lost when the view
          changes. `role="alert"` matches every other auth failure. */}
      {error ? (
        <MotionNotice role="alert" className="mt-4 text-label-sm text-destructive">
          {error}
        </MotionNotice>
      ) : null}
      <div
        data-enter
        style={motionIndex(4)}
        className="mt-5 flex items-center justify-between gap-3"
      >
        <Button
          type="button"
          variant="ghost"
          onClick={onBack}
          disabled={!onBack}
        >
          {backLabel}
        </Button>
        <Button
          type="button"
          variant="primary"
          onClick={onNext}
          disabled={!onNext}
        >
          {nextLabel}
          <ArrowRight aria-hidden="true" className="size-4" />
        </Button>
      </div>
      {/* A tier of its own below Back and Continue, not a third pill beside
          them: at 375px those three do not fit on one row, and the way out of a
          setup is not one of its navigation controls. The same shape as the auth
          error boundary — the action, then the quieter alternative under it.

          Mounts when the first skippable step arrives and stays mounted, so the
          entrance runs once, where it reads as the offer appearing rather than
          as something replayed on every step. Index 5 continues the page's own
          ladder, and the rule behind `data-enter` is already inside
          `prefers-reduced-motion: no-preference`. */}
      {onSkip ? (
        <div
          data-enter
          style={motionIndex(5)}
          className="mt-2 flex justify-center"
        >
          <SkipOnboarding onSkip={onSkip} disabled={skipDisabled} />
        </div>
      ) : null}
    </div>
  );
}

export type { OnboardingShellProps };
