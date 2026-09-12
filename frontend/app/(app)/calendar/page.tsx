import { Plus } from "lucide-react";
import { PageHeader } from "@/components/app/PageHeader";
import { SignInAction } from "@/components/auth/SignInAction";
import { Container } from "@/components/ui/Container";
import { listEventsForDates } from "@/lib/data/events";
import type { EventItem } from "@/lib/data/eventValues";
import { getOnboardingState } from "@/lib/data/onboarding";
import { listSubjects, type SubjectOption } from "@/lib/data/subjects";
import { getWorkspaceAccess } from "@/lib/onboarding/gate";
import { AddEventButton } from "./_components/AddEventButton";
import {
  CalendarSurface,
  CalendarWorkspace,
} from "./_components/CalendarWorkspace";
import { formatIsoDate, monthGrid } from "./_components/calendarMath";

/**
 * Calendar (17.1 header; 17.11 real-service binding).
 *
 * The server page owns access and the data read, in that order: the
 * `getWorkspaceAccess` gate runs first (the Server Actions keep
 * `requireOnboardedUser` as the hard fallback), then the caller's subjects and
 * the events overlapping the displayed month grid load through the
 * request-scoped, RLS-enforced client. The window is the month grid's first
 * through last date, resolved to instants in the profile's zone inside the
 * data layer (`listEventsForDates`, R15) — the month grid is a superset of
 * the anchor's week, so one load serves both views and no block ever queries.
 *
 * A visitor without a session renders the same header and grid with an empty
 * list and no data call at all: the grid is real, its copy is honest, and
 * using it opens the sign-in prompt.
 *
 * Below the header, the `CalendarWorkspace` provider owns the live list and
 * every mutation, with the page's header composition (including the real
 * `AddEventButton`, 17.9) as its children so the trigger opens the same
 * dialog stack the blocks do. `CalendarSurface` inherits the same view state
 * (17.2) and renders the grid the view selects (17.3/17.4) carrying the real
 * events (17.5–17.10).
 */
export default async function CalendarPage() {
  const user = await getWorkspaceAccess();

  // The grid's one clock: the server's date as YYYY-MM-DD, computed per
  // request and passed as a string. The client never re-derives it — the
  // grid the server renders is the grid hydration sees (17.3 §4).
  const todayIso = formatIsoDate(new Date());

  // The one visible range, derived from the same pure grid math the client
  // renders, so the query window cannot drift from the displayed dates.
  const rows = monthGrid(todayIso);
  const firstDate = rows[0][0].iso;
  const lastDate = rows[rows.length - 1][6].iso;

  let events: EventItem[] = [];
  let subjects: SubjectOption[] = [];
  let timeZone = "UTC";

  if (user) {
    const [state, subjectOptions, loaded] = await Promise.all([
      // Memoized: the access gate above already read this in the same pass.
      getOnboardingState(user.id),
      listSubjects(user.id),
      listEventsForDates(user.id, { firstDate, lastDate }),
    ]);
    timeZone = state.profile?.timezone ?? "UTC";
    subjects = subjectOptions;
    events = loaded;
  }

  return (
    <Container className="flex min-w-0 flex-col gap-6 py-6 md:gap-8 md:py-8">
      <CalendarWorkspace
        initialEvents={events}
        subjects={subjects}
        timeZone={timeZone}
        todayIso={todayIso}
        guest={!user}
      >
        <PageHeader
          eyebrow="Calendar"
          title="Calendar"
          description={
            user
              ? "See what's coming up."
              : "Sign in to see what's coming up."
          }
          primaryAction={
            user ? (
              <AddEventButton />
            ) : (
              <SignInAction
                size="sm"
                aria-label="Add event"
                reason="Sign in to add events to your calendar."
                guest
              >
                <Plus aria-hidden="true" className="size-4" />
                Add event
              </SignInAction>
            )
          }
        />
        <CalendarSurface index={1} todayIso={todayIso} />
      </CalendarWorkspace>
    </Container>
  );
}
