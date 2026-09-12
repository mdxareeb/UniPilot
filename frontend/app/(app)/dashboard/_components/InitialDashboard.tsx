import type { ReactNode } from "react";
import { Container } from "@/components/ui/Container";
import { AIInsightCard } from "./AIInsightCard";
import { DashboardGreeting } from "./DashboardGreeting";
import { DashboardTools } from "./DashboardTools";
import { ExploreWorkspace } from "./ExploreWorkspace";
import { GuestCallout } from "./GuestCallout";
import { PrimaryWorkspaceCard } from "./PrimaryWorkspaceCard";
import { QuickAccessRow } from "./QuickAccessRow";
import { QuickActions } from "./QuickActions";
import { QuickStats } from "./QuickStats";
import { RecentDocumentsCard } from "./RecentDocumentsCard";
import { SupportingCards } from "./SupportingCards";
import type { DashboardStudent } from "./dashboardStudent";

type InitialDashboardProps = {
  /**
   * What the route could read about a signed-in student — the full shape from
   * `dashboardStudent.ts`, empty for a guest. Task 13.10 fills it from the
   * persisted profile and subjects; a component still only renders what is
   * present, so an absent answer stays absent.
   */
  student: DashboardStudent;
  /**
   * No session. Not the same thing as an absent `firstName`, which is what every
   * email/password account has — hence a flag of its own rather than a guess.
   */
  guest: boolean;
  /**
   * The route's Task 14.10 setup offer, already Suspense-wrapped, for a
   * signed-in student. Rendered in the guest callout's slot; the component
   * itself resolves to null once setup is complete, so this is only ever a
   * node for someone who might need it. Absent for a guest, who gets
   * `GuestCallout` instead.
   */
  setupBanner?: ReactNode;
  /**
   * The request's date as display text, formatted on the server in `page.tsx`
   * and passed through untouched. A string so no client component ever
   * re-derives the clock — what the server rendered is what hydration sees.
   */
  dateLabel: string;
};

/**
 * The dashboard as a student first sees it: a greeting, one thing to do, and the
 * rest of the workspace waiting in its empty states.
 *
 * Presentational and props-only. The route hands it what it read for this
 * student; nothing here queries. As of Task 13.10 that can include the persisted
 * onboarding answers and subjects, so the greeting renders them from the same
 * props a guest's empty student arrives in — no field is ever invented to fill a
 * gap, and the guest state is simply the same components with nothing in them.
 *
 * A guest gets the same page. `/dashboard` is public, and the honest form of that
 * is not a reduced dashboard: every card here is already an empty state that
 * reads no data, so there is nothing on it a visitor without an account should be
 * shown less of. The only addition is `GuestCallout`, and the only subtraction is
 * a name in the greeting — which the greeting already handles, because a name is
 * absent for most signed-in students too. A signed-in student whose setup is
 * unfinished gets 14.10's setup banner in that same slot instead; a completed
 * one gets neither, because the banner is its own completion-aware server
 * component.
 *
 * `py-6`/`py-8` rather than `Section`'s `py-section`: 64–120px of padding is the
 * marketing pages' cadence, and a surface someone opens every day wants the
 * action layer and the primary card on the first screen. The greeting, the
 * quick actions and the first card row fit above the fold at 1280×800.
 *
 * The dotted canvas and the chrome around this live in `(app)/layout.tsx` now.
 * Sign-out moved with them, into the sidebar's user area — where a guest gets
 * sign-in in the same slot instead.
 */
export function InitialDashboard({
  student,
  guest,
  setupBanner,
  dateLabel,
}: InitialDashboardProps) {
  // The entrance stagger is a sequence, so a row inserted into it shifts
  // everything below: the greeting's three lines are 0 through 2, the callout
  // in the 3 slot is the guest's or the unfinished student's, and the action
  // card leads the rest. The signed-in banner and the action layer share slot
  // 3 — they are the two things at the top of the page and land together.
  const actionsIndex = guest ? 4 : 3;
  // The workspace grid follows the actions: primary card, then the supporting
  // column's three panels, then the readings band.
  const cardIndex = actionsIndex + 1;

  return (
    <Container className="flex min-w-0 flex-col gap-6 py-6 md:gap-8 md:py-8">
      <DashboardGreeting student={student} dateLabel={dateLabel} />
      {guest ? <GuestCallout index={3} /> : (setupBanner ?? null)}
      {/* The action layer, directly under the greeting on purpose: the
          dashboard answers "what can I do?" before "what is happening?" —
          a student opening this page is here to start something, and the
          things they can start belong above the state of the workspace they
          would start it in. */}
      <QuickActions index={actionsIndex} guest={guest} />
      {/* Two thirds to the action, one third to what is coming up. At `lg` the
          supporting set becomes the third column; below it, a row of its own. */}
      <div className="grid min-w-0 gap-4 lg:grid-cols-3">
        <PrimaryWorkspaceCard index={cardIndex} guest={guest} />
        <SupportingCards index={cardIndex + 1} guest={guest} />
      </div>
      {/* The three-reading snapshot, after the composition above it and before
          the shortcuts below — a metric is a conclusion about the workspace,
          and belongs after the workspace, not before it. */}
      <QuickStats index={cardIndex + 3} />
      {/* The materials summary joins the readings: both are state-of-your-work
          surfaces, distinct from the shortcuts below them. */}
      <RecentDocumentsCard index={cardIndex + 4} guest={guest} />
      {/* The recommendation completes the band: what the numbers and materials
          add up to, when there is something worth saying. */}
      <AIInsightCard index={cardIndex + 5} guest={guest} />
      <QuickAccessRow guest={guest} />
      <ExploreWorkspace guest={guest} />
      {/* Last on the page on purpose. The workspace sections above are about the
          student's own work; this is about what else UniPilot will do, and it
          should not be the first thing between them and it. */}
      <DashboardTools />
    </Container>
  );
}
