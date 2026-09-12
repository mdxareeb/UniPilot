import { ArrowRight, User } from "lucide-react";
import { motionIndex } from "@/components/motion/stagger";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Card } from "@/components/ui/Card";
import { LOGIN_PATH, SIGNUP_PATH } from "@/lib/auth/constants";

/**
 * The one thing on the dashboard that is only there for a visitor without a
 * session: what state they are in, and the two ways out of it.
 *
 * Deliberately a row, not a hero. This page is a workspace and it stays one — a
 * full-width panel with a headline would turn the first screen of the app into a
 * second landing page, which is the failure mode here. So it borrows
 * `QuickAccessRow`'s weight class instead: `compact`, `p-4`, `text-label-sm`, one
 * eyebrow, one sentence. It sits under the greeting because that is where the
 * question "whose workspace is this?" gets asked, and above the primary card
 * because the answer changes what the card's buttons will do.
 *
 * The sentence names the four routes that actually need an account: signing in
 * is what opens them. It deliberately does not promise a workspace full of
 * content on the other side of the button — since 13.10 a signed-in student's
 * persisted onboarding facts appear on /dashboard, but the workspace itself is
 * still empty until the later data phases, and a guest has none of those rows.
 *
 * `bg-glass` like every other card on the dotted canvas — `bg-glass-subtle` is
 * for a shell nested inside the rail's glass, not for a card sitting on the page.
 *
 * `data-enter`, not `data-reveal`: this is above the fold on every viewport, and
 * the CSS-only entrance cannot leave it blank if the observer never runs.
 */
export function GuestCallout({ index }: { index: number }) {
  return (
    <div data-enter style={motionIndex(index)} className="min-w-0">
      <Card
        variant="compact"
        className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-3 bg-glass p-4"
      >
        {/* `min-w-[16rem]` on a `flex-1` column: the copy claims the row up to
            the point where the buttons would have to wrap mid-word, then hands
            them a line of their own. Nothing truncates — the sentence is the
            part worth reading. */}
        <div className="flex min-w-[16rem] flex-1 flex-col gap-1">
          <p className="flex items-center gap-1.5 font-mono text-label-caps uppercase text-muted-foreground">
            <User aria-hidden="true" className="size-3.5 shrink-0" />
            Guest
          </p>
          <p className="max-w-[56ch] text-label-sm text-muted-foreground">
            You&rsquo;re exploring UniPilot without an account. Documents, tasks,
            your calendar and the assistant need one.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href={SIGNUP_PATH} size="sm">
            Create your workspace
            <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
          </ButtonLink>
          {/* `ghost`, so the pair reads as one offer with a quieter second
              option rather than as two competing buttons. */}
          <ButtonLink href={LOGIN_PATH} variant="ghost" size="sm">
            Sign in
          </ButtonLink>
        </div>
      </Card>
    </div>
  );
}
