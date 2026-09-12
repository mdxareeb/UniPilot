import { CalendarClock } from "lucide-react";
import { motionIndex } from "@/components/motion/stagger";
import { WorkspaceAction } from "@/components/app/WorkspaceAction";
import { Card } from "@/components/ui/Card";
import { Divider } from "@/components/ui/Divider";
import { LOGIN_PATH, REDIRECT_PARAM } from "@/lib/auth/constants";

/**
 * One deadline the card is able to present. No query supplies these yet — no
 * tasks table, no events table, no extraction pipeline — so nothing renders
 * rows today and the shape is the whole of this task's data work (15.2 §4).
 *
 * The fields are named the way a future task service will likely name them: a
 * title, the date it is due, and the optional course it belongs to. `done` is
 * deliberately coarse — done/undone is the only state the task system is
 * planned to carry — and it is optional for the same reason the course is: a
 * deadline row must still render when all it has is a title and a date.
 *
 * Dates are display-ready strings on purpose: a `Date` would force this
 * presentational component to decide a timezone, and no user timezone is
 * persisted (that is a later database task). Whoever wires real data in later
 * formats on the server, the same way `dashboardDate` does for the greeting.
 */
export type DashboardDeadline = {
  title: string;
  /** Readable due date, e.g. "Wed, Sep 2". Formatted server-side by the caller. */
  date: string;
  /** Optional course or subject the deadline belongs to. */
  course?: string;
  /** Optional coarse status. Absent means "not done". */
  done?: boolean;
};

type DeadlinesCardProps = {
  /** Position in the page's entrance stagger. */
  index: number;
  /** Deadlines to render. Empty renders the intentional empty state. */
  deadlines?: readonly DashboardDeadline[];
  guest?: boolean;
};

/**
 * The deadlines panel of the supporting pair (Task 15.2).
 *
 * Two states, one structure: an eyebrow ("Upcoming"), a title ("Your
 * deadlines"), and then either the rows real data will send or the intentional
 * empty state. The empty state is the honest one today — no tasks table exists,
 * so it says what will fill the card rather than showing a zero and hoping it
 * reads as empty — and the row path below it is what a future task service
 * plugs into: pass `deadlines` and the card renders them, no other change.
 *
 * Guest and signed-in see the same card. There is no private data in it: the
 * only difference is where the trailing action goes — a guest is routed through
 * login with a return path, exactly like every other workspace action on the
 * page.
 *
 * Presentation stays monochrome (15.2 §5): a row is title, due date and
 * optional course, with `line-through` on a done row as the only state
 * treatment — no reds, no invented urgency scale. The due date is Geist Mono
 * metadata, the same slot the eyebrow uses.
 *
 * `data-enter="scale"` rather than the default rise: this is one of the panels
 * the page's data will live in, and arriving with depth separates it from the
 * text-only tiles around it using the existing keyframe — no second animation
 * system. The wrapper carries the entrance and the `Card` the hover lift, the
 * same layering every other dashboard card uses, because the entrance's fill
 * mode would otherwise pin `transform: none` and cancel the lift for good.
 */
export function DeadlinesCard({
  index,
  deadlines,
  guest = false,
}: DeadlinesCardProps) {
  const hasDeadlines = Boolean(deadlines && deadlines.length > 0);
  const tasksHref = guest
    ? `${LOGIN_PATH}?${REDIRECT_PARAM}=${encodeURIComponent("/tasks")}`
    : "/tasks";

  return (
    <div data-enter="scale" style={motionIndex(index)} className="min-w-0">
      <Card
        variant="compact"
        className="flex h-full min-w-0 flex-col gap-2 bg-glass p-4 hover-lift hover:border-foreground"
      >
        <span className="flex items-center gap-1.5 font-mono text-label-caps uppercase text-muted-foreground">
          <CalendarClock aria-hidden="true" className="size-3.5 shrink-0" />
          Upcoming
        </span>
        <h3 className="text-body-lg font-semibold text-foreground">
          Your deadlines
        </h3>

        {hasDeadlines && deadlines ? (
          /* The row path a future task service fills in. No stagger inside:
             these are list rows, not a composition, and rows arriving after
             the card itself is a delay before the reader can read. */
          <ul className="flex min-w-0 flex-col gap-2.5 pt-1">
            {deadlines.map((deadline) => (
              <li
                key={`${deadline.title}-${deadline.date}`}
                className="flex min-w-0 flex-col gap-0.5"
              >
                <span
                  className={`truncate text-label-sm font-medium text-foreground${
                    deadline.done ? " line-through decoration-foreground/40" : ""
                  }`}
                >
                  {deadline.title}
                </span>
                <span className="flex min-w-0 items-baseline gap-2 font-mono text-label-caps text-muted-foreground">
                  <span className="shrink-0 uppercase">{deadline.date}</span>
                  {deadline.course ? (
                    <span className="truncate uppercase">{deadline.course}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-label-sm text-muted-foreground">
            No deadlines yet. Tasks from your academic materials will appear
            here.
          </p>
        )}

        <div className="mt-auto flex flex-col gap-2.5 pt-3">
          <Divider />
          <WorkspaceAction href={tasksHref}>View tasks</WorkspaceAction>
        </div>
      </Card>
    </div>
  );
}
