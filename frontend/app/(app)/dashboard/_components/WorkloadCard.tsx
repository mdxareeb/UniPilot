import { Gauge } from "lucide-react";
import { motionIndex } from "@/components/motion/stagger";
import { WorkspaceAction } from "@/components/app/WorkspaceAction";
import { Card } from "@/components/ui/Card";
import { Divider } from "@/components/ui/Divider";
import { LOGIN_PATH, REDIRECT_PARAM } from "@/lib/auth/constants";

/**
 * One workload result, the whole of what the future engine may send (15.3 §2).
 *
 * The levels are the three the workload-intelligence phase (Phase 26 / 44.x)
 * is planned to produce. The shape is display-ready on purpose — the engine
 * owns the calculation, and this card owns none of it: `level` is an answer
 * the engine computed elsewhere, `summary` is its optional explanation, and
 * nothing here derives, scores, counts or clusters anything. A level with no
 * summary must still render; a summary with no level is not a workload state
 * and is not accepted.
 *
 * No query supplies one today. No task table, events table or effort estimate
 * exists to weigh, so the card is built with the no-data state as its real
 * state and the risk states as reachable-but-unused paths — the marketing
 * previews on `/` and `/features` show figures because they are illustrations;
 * this card must not, because a number on the workspace would claim to be true.
 */
export type DashboardWorkload = {
  level: "low" | "medium" | "high";
  /** Optional one-line explanation, e.g. "Two deadlines land on Thursday." */
  summary?: string;
};

type WorkloadCardProps = {
  /** Position in the page's entrance stagger. */
  index: number;
  /** A real workload result. Absent renders the intentional no-data state. */
  workload?: DashboardWorkload;
  guest?: boolean;
};

/**
 * The workload panel of the supporting column (Task 15.3).
 *
 * Two states, one structure: an eyebrow ("Workload"), a title, and then either
 * the engine's result or the intentional no-data state. The no-data state is
 * the honest one today — nothing exists to weigh, so the card says what will
 * fill it rather than inventing a Low it cannot support. No score, no counts,
 * no progress bar: an empty gauge is a number-shaped lie.
 *
 * The risk state stays restrained (15.3 §6/§7): a small marker — a filled dot
 * in a pill outline for low, a half pill for medium, a full pill for high —
 * next to the level word in Geist Mono label-caps, then the summary as body
 * text. All monochrome: high is the same black as every other emphasis on the
 * page, darker only through `text-foreground` against the muted markers of the
 * lower levels. No traffic light, no gauge, no percentage. The marker is
 * non-interactive and carries no semantics of its own — the level word beside
 * it is the entire meaning, and a screen reader gets "High" plus the summary,
 * not an aria-label pretending a dot is a status widget.
 *
 * Guest and signed-in see the same card. There is no private data in a state
 * that does not exist yet; when one does, a guest simply has no result to
 * show. The trailing action goes to `/tasks` — the real route the workload
 * engine will read from — routed through login for a guest, exactly like
 * every other workspace action on the page.
 *
 * `data-enter` with the default rise: an analytical card should be the
 * quietest thing in its row, and the pair below it already claims the
 * dimensional entrances (`scale` on deadlines, and the primary card's own
 * depth) — three scaled surfaces in one column would read as a wobble, not a
 * hierarchy. The wrapper carries the entrance and the `Card` the hover lift,
 * the same layering every other dashboard card uses, because the entrance's
 * fill mode would otherwise pin `transform: none` and cancel the lift for good.
 *
 * State changes later — a real result arriving, a level changing — are a
 * `MotionBar` or `layout` concern and deliberately not built here: no result
 * has ever changed yet, and MOTION.md's rule is motion for the UI that exists.
 */
export function WorkloadCard({ index, workload, guest = false }: WorkloadCardProps) {
  const tasksHref = guest
    ? `${LOGIN_PATH}?${REDIRECT_PARAM}=${encodeURIComponent("/tasks")}`
    : "/tasks";

  return (
    <div
      data-enter
      style={motionIndex(index)}
      className="min-w-0 sm:col-span-2 lg:col-span-1"
    >
      <Card
        variant="compact"
        className="flex h-full min-w-0 flex-col gap-2 bg-glass p-4 hover-lift hover:border-foreground"
      >
        <span className="flex items-center gap-1.5 font-mono text-label-caps uppercase text-muted-foreground">
          <Gauge aria-hidden="true" className="size-3.5 shrink-0" />
          Workload
        </span>
        <h3 className="text-body-lg font-semibold text-foreground">Workload</h3>

        {workload ? (
          /* The engine's result. The marker is three fixed widths of the same
             pill — a quarter, half and full fill — so the three levels read as
             one scale rather than three decorations, and the highest level is
             the only one with the page's full-strength emphasis. */
          <div className="flex min-w-0 flex-col gap-2.5 pt-1">
            <p className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden="true"
                className="block h-1.5 w-16 shrink-0 overflow-hidden rounded-pill border border-border"
              >
                <span
                  className={`block h-full rounded-pill bg-foreground ${
                    workload.level === "high"
                      ? "w-full"
                      : workload.level === "medium"
                        ? "w-1/2"
                        : "w-1/4"
                  }`}
                />
              </span>
              <span
                className={`font-mono text-label-caps uppercase ${
                  workload.level === "high"
                    ? "text-foreground"
                    : "text-muted-foreground"
                }`}
              >
                {workload.level}
              </span>
            </p>
            {workload.summary ? (
              <p className="text-label-sm text-muted-foreground">
                {workload.summary}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-label-sm text-muted-foreground">
            Nothing to weigh yet. Your workload appears once you have tasks
            and deadlines.
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
