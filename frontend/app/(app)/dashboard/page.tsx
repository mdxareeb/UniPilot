import { Suspense } from "react";
import { FinishSetupAffordance } from "@/components/app/FinishSetupAffordance";
import { sessionFirstName } from "@/lib/auth/displayName";
import { sessionUser } from "@/lib/auth/session";
import { getOnboardingState } from "@/lib/data/onboarding";
import {
  academicYearLabel,
  planningStyleLabel,
  reminderLeadLabel,
  semesterLabel,
} from "@/lib/data/onboardingValues";
import { InitialDashboard } from "./_components/InitialDashboard";
import { formatDashboardDate } from "./_components/dashboardDate";
import type { DashboardStudent } from "./_components/dashboardStudent";

/**
 * The dashboard, for whoever opens it.
 *
 * The one route under `(app)` that is public, and public on purpose: it is where
 * "Open App" goes from the marketing header, so a visitor who follows it should
 * arrive in the workspace rather than at a login form. That means reading the
 * session instead of requiring one — `sessionUser` never throws and never
 * redirects — and rendering the guest state when there is none. `/tasks`,
 * `/calendar`, `/documents`, `/assistant` and `/onboarding` are unchanged: the
 * proxy redirects them, each page runs its own gate, and 13.10's redirect rule
 * additionally sends unfinished students into `/onboarding`.
 *
 * For a signed-in student the route now reads their persisted onboarding rows
 * (Task 13.10) and builds the full `DashboardStudent` from them: the profile
 * answers plus the subject set, with the schema codes mapped back to the
 * display strings the UI speaks. Nothing is inferred or supplied for a missing
 * field — an answer the student never persisted stays absent, and the greeting
 * renders that absence the way it always has. A guest never reads the profile
 * at all; the guest state is the same page minus every private fact.
 *
 * The signed-in, unfinished student also gets Task 14.10's `FinishSetupAffordance`
 * in place of the guest callout. It is its own server component and reads the
 * same memoized state this page already read, so the boundary below resolves
 * before first paint — no placeholder, no shift, and a completed student simply
 * never sees it.
 *
 * The header's date is computed here, once, per request: the session read makes
 * the route dynamic, so every render gets the current day. See
 * `./_components/dashboardDate` for why it is formatted server-side and passed
 * as a string.
 */
export default async function DashboardPage() {
  const { user } = await sessionUser();

  // Server-side only. This route is dynamic (the session read touches cookies),
  // so the value is fresh per request and per client navigation — and because it
  // is a formatted string rather than a timestamp, no client ever re-derives
  // it, which is what keeps the header out of hydration-mismatch territory.
  const dateLabel = formatDashboardDate(new Date());

  let student: DashboardStudent = {};

  if (user) {
    const { profile, subjects } = await getOnboardingState(user.id);
    const persistedFirstName = profile?.first_name?.trim();

    student = {
      firstName: persistedFirstName ? persistedFirstName : sessionFirstName(user),
      institution: profile?.institution ?? undefined,
      courseProgram: profile?.course_program ?? undefined,
      academicYear: academicYearLabel(profile?.academic_year),
      semester: semesterLabel(profile?.semester),
      planningStyle: planningStyleLabel(profile?.planning_style),
      reminderLead: reminderLeadLabel(profile?.reminder_lead),
      subjects: subjects.length > 0 ? subjects : undefined,
    };
  }

  return (
    <InitialDashboard
      student={student}
      guest={!user}
      dateLabel={dateLabel}
      // Only signed-in students can need setup; a guest keeps `GuestCallout`.
      // The element is created here but the component decides from the
      // persisted marker, so there is no completion condition to duplicate.
      setupBanner={
        user ? (
          <Suspense fallback={null}>
            <FinishSetupAffordance />
          </Suspense>
        ) : undefined
      }
    />
  );
}
