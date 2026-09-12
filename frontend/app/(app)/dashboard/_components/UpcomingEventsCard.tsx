import { CalendarDays } from "lucide-react";
import { motionIndex } from "@/components/motion/stagger";
import { WorkspaceAction } from "@/components/app/WorkspaceAction";
import { Card } from "@/components/ui/Card";
import { Divider } from "@/components/ui/Divider";
import { LOGIN_PATH, REDIRECT_PARAM } from "@/lib/auth/constants";

/**
 * One upcoming event the card is able to present (15.6 §4). No query supplies
 * these — no events table, no calendar integration, no extraction pipeline —
 * so nothing renders rows today and the shape is the whole of this task's
 * data work.
 *
 * `type` covers the four things the calendar phase (17.x) is planned to hold:
 * classes, exams, assignment deadlines and everything else. Times are
 * display-ready strings, not timestamps: the future calendar service formats
 * them server-side (the same way `dashboardDate` does for the greeting), which
 * keeps this presentational card out of timezone decisions entirely — no user
 * timezone is persisted, and none is invented here (15.6 §14). `endAt`,
 * `course` and `location` are optional because an event must still render
 * when all it has is a title and a start.
 */
export type DashboardEvent = {
  /** Stable key for list identity. */
  id: string;
  /** Display-ready event title, e.g. "DBMS lecture". */
  title: string;
  /** What kind of calendar entry this is. */
  type: "class" | "exam" | "deadline" | "other";
  /** Display-ready start time, e.g. "Wed, Sep 2 · 10:00". Service-formatted. */
  startAt: string;
  /** Display-ready end time, when the event has one. */
  endAt?: string;
  /** Optional course or subject the event belongs to. */
  course?: string;
  /** Optional display-ready location, e.g. "Lab 2". */
  location?: string;
};

type UpcomingEventsCardProps = {
  /** Position in the page's entrance stagger. */
  index: number;
  /** Real events, soonest first. Empty renders the intentional empty state. */
  events?: readonly DashboardEvent[];
  guest?: boolean;
};

/**
 * The "Your week" panel of the supporting column (Task 15.6): upcoming
 * classes, exams and calendar events as one compact list — a summary of the
 * calendar, never a mini-calendar inside the dashboard. The full Calendar page
 * (17.x) owns event management; this card owns the next few entries and
 * nothing else.
 *
 * Two states, one structure: an eyebrow ("Calendar"), a title ("Your week"),
 * then either the rows a future calendar service sends or the intentional
 * empty state, then one trailing action to the real `/calendar` route. The
 * empty state is the honest one today — no events table exists, so it says
 * what will fill the card rather than inventing a class.
 *
 * A row is a title and one line of mono metadata — time first, then type,
 * course and location as they exist. Type is plain text in the metadata line
 * rather than a badge: "Exam" in Geist Mono label-caps states the fact with
 * the same weight as its time, and four type-badges per row would turn a
 * summary into a traffic light (15.6 §6). Long titles wrap rather than push:
 * `wrap-anywhere`, the same guard every unbounded-string row on the page uses.
 * Rows carry no per-event link — the calendar page has no event view to link
 * to yet, and "Open calendar" below is the one destination that exists.
 *
 * Motion (15.6 §10): the panel arrives from the right — it sits in the
 * dashboard's right-hand column at `lg`, so the directional entrance lands it
 * from the side of the page it belongs to, and it keeps the supporting column's
 * three entrances distinct (deadlines with depth, this from the right, the
 * workload reading with the plain rise). Future rows are `MotionListItem`
 * inside `AnimatePresence` — the `ul`/`li` structure with `id` keys keeps that
 * migration mechanical, and no fake dynamic behaviour is built to demonstrate
 * it: animation never determines whether content exists.
 *
 * `hover-lift` is on the `Card`, the entrance on the wrapper — the same
 * layering every other dashboard card uses, because the entrance's fill mode
 * would otherwise pin `transform: none` and cancel the lift for good.
 */
export function UpcomingEventsCard({
  index,
  events,
  guest = false,
}: UpcomingEventsCardProps) {
  const hasEvents = Boolean(events && events.length > 0);
  const calendarHref = guest
    ? `${LOGIN_PATH}?${REDIRECT_PARAM}=${encodeURIComponent("/calendar")}`
    : "/calendar";

  return (
    <div data-enter="right" style={motionIndex(index)} className="min-w-0">
      <Card
        variant="compact"
        className="flex h-full min-w-0 flex-col gap-2 bg-glass p-4 hover-lift hover:border-foreground"
      >
        <span className="flex items-center gap-1.5 font-mono text-label-caps uppercase text-muted-foreground">
          <CalendarDays aria-hidden="true" className="size-3.5 shrink-0" />
          Calendar
        </span>
        <h3 className="text-body-lg font-semibold text-foreground">
          Your week
        </h3>

        {hasEvents && events ? (
          /* The row path a future calendar service fills in. `id` keys keep
             list identity stable for the MotionListItem migration. */
          <ul className="flex min-w-0 flex-col gap-2.5 pt-1">
            {events.map((event) => (
              <li key={event.id} className="flex min-w-0 flex-col gap-0.5">
                <span className="wrap-anywhere text-label-sm font-medium text-foreground">
                  {event.title}
                </span>
                <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 font-mono text-label-caps text-muted-foreground">
                  <span className="shrink-0 uppercase">{event.startAt}</span>
                  <span className="shrink-0 uppercase">{event.type}</span>
                  {event.course ? (
                    <span className="min-w-0 truncate uppercase">
                      {event.course}
                    </span>
                  ) : null}
                  {event.location ? (
                    <span className="min-w-0 truncate uppercase">
                      {event.location}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-label-sm text-muted-foreground">
            No events yet. Your classes, exams and deadlines will appear here.
          </p>
        )}

        <div className="mt-auto flex flex-col gap-2.5 pt-3">
          <Divider />
          <WorkspaceAction href={calendarHref}>Open calendar</WorkspaceAction>
        </div>
      </Card>
    </div>
  );
}
