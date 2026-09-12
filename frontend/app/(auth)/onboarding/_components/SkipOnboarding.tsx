"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

type SkipOnboardingProps = {
  /**
   * Leaves onboarding unfinished. Called only once the reader has confirmed, so
   * the caller never has to ask a second time.
   */
  onSkip: () => void;
  /** Takes the action out of service, e.g. while a navigation is in flight. */
  disabled?: boolean;
};

/**
 * The way out of onboarding: a quiet secondary action and the question it asks
 * first.
 *
 * The button and the dialog are one component because they are one piece of
 * copy. "Skip for now" appears twice — once as the offer and once as the answer
 * — and splitting them across the shell and a separate dialog would let the two
 * halves of the same sentence drift apart.
 *
 * Styled as the muted text action the `(auth)` routes already use beside a
 * primary button (see `error.tsx` and the login form's "Forgot password?"):
 * ghost, one size down, and muted until hovered. Continue stays the only filled
 * control on the page, which is what makes this one read as the alternative
 * rather than a second choice of equal weight.
 *
 * Nothing is written down and nothing is marked finished (Task 13.10 keeps it
 * that way: only `finish` calls the save, and the completion marker is stamped
 * by that same call). Skipping only leaves; what the student typed goes with
 * the tree, and `onboarding_completed_at` stays NULL so the redirect gate can
 * bring them back here.
 */
export function SkipOnboarding({ onSkip, disabled }: SkipOnboardingProps) {
  const [confirming, setConfirming] = useState(false);

  function cancel() {
    setConfirming(false);
  }

  function confirm() {
    // Closed first so focus returns to the page the student is leaving rather
    // than being stranded on a button inside a dialog that is about to unmount
    // with the route.
    setConfirming(false);
    onSkip();
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setConfirming(true)}
        disabled={disabled}
        // Marked important the way the closing CTAs mark their focus ring: the
        // ghost variant sets `text-foreground` itself, and which of two colour
        // utilities wins would otherwise come down to the order Tailwind happens
        // to emit them in. The hover pair is important too, since it has to beat
        // the base — and being the more specific selector, it does.
        className="text-muted-foreground! hover:text-foreground!"
      >
        Skip for now
      </Button>
      {/* Asked rather than obeyed: Skip sits one tab away from Continue, and the
          press that leaves half a setup behind should not be the same size as
          the press that fills a field in.

          `max-w-sm` over the primitive's `max-w-lg` — two lines and two buttons
          do not need a panel wide enough for a form. Solid `bg-card`, which is
          what the primitive gives: the glass levels are for panels sitting on
          the dotted canvas, and this one sits on a dimmed scrim with two
          controls to aim at.

          No close button. "Continue setup" already means "not now", and an X
          beside it would say the same thing twice; Escape and the backdrop
          still cancel, which is the safe direction for both. */}
      <Modal
        open={confirming}
        onOpenChange={setConfirming}
        title="Skip onboarding for now?"
        description="You can finish setting up your workspace later."
        showClose={false}
        className="max-w-sm"
      >
        {/* Staying is listed first, so `showModal()` lands its own focus on the
            harmless action. Stacked below `sm`, where two pills side by side
            would have to be narrower than their labels. */}
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="primary" onClick={cancel}>
            Continue setup
          </Button>
          <Button type="button" variant="ghost" onClick={confirm}>
            Skip for now
          </Button>
        </div>
      </Modal>
    </>
  );
}
