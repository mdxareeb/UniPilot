import { ArrowRight, Wand2 } from "lucide-react";
import { motionIndex } from "@/components/motion/stagger";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Card } from "@/components/ui/Card";
import { sessionNeedsSetup } from "@/lib/onboarding/gate";

const SETUP_PATH = "/onboarding";

/**
 * The persistent "Finish setup" callout for a signed-in student whose
 * onboarding is incomplete (Task 14.10).
 *
 * Reads the completion state through `sessionNeedsSetup`, the same condition
 * the sidebar's setup link uses, and renders nothing for a completed student
 * or a guest. There is no dismissal and no client storage: the persisted
 * `profiles.onboarding_completed_at` is the whole state, so the callout
 * disappears the moment onboarding's atomic write stamps it — the navigation
 * after finishing lands on a dashboard that no longer has a read to make.
 *
 * Deliberately a row at `GuestCallout`'s weight, sitting in the same slot: a
 * compact glass card, one eyebrow, one sentence, one action. It is an offer,
 * not a hero, and /dashboard is a workspace. `data-enter` rather than a Motion
 * reveal because this is above the fold on every viewport — the CSS-only
 * entrance cannot leave it blank and already respects reduced motion (the
 * `data-enter` rules live inside `prefers-reduced-motion: no-preference`).
 * The sentence names the four gated routes because finishing setup is what
 * actually opens them (13.10's redirect gate), which is the honest reason to
 * offer this at all.
 *
 * Server-rendered with no interactive state, so the client learns nothing it
 * did not already have: a card and a link.
 */
export async function FinishSetupAffordance({ index = 3 }: { index?: number }) {
  if (!(await sessionNeedsSetup())) return null;

  return (
    <div data-enter style={motionIndex(index)} className="min-w-0">
      <Card
        variant="compact"
        className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-3 bg-glass p-4 backdrop-blur-md"
      >
        <div className="flex min-w-[16rem] flex-1 flex-col gap-1">
          <p className="flex items-center gap-1.5 font-mono text-label-caps uppercase text-muted-foreground">
            <Wand2 aria-hidden="true" className="size-3.5 shrink-0" />
            Setup incomplete
          </p>
          <p className="max-w-[56ch] text-label-sm text-muted-foreground">
            Finish setup to open your tasks, calendar, documents and assistant.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href={SETUP_PATH} size="sm">
            Finish setup
            <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
          </ButtonLink>
        </div>
      </Card>
    </div>
  );
}
