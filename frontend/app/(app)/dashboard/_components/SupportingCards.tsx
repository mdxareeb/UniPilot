import { DeadlinesCard } from "./DeadlinesCard";
import { UpcomingEventsCard } from "./UpcomingEventsCard";
import { WorkloadCard } from "./WorkloadCard";

/**
 * The supporting column beside the primary card: deadlines (Task 15.2), the
 * week ahead (Task 15.6) and workload (Task 15.3). All empty, and honestly so
 * — none of the three reads any data, because there is none to read: no tasks
 * table, no events table, no effort estimate, no extraction pipeline. The copy
 * names what will fill each one instead of showing a zero and hoping it reads
 * as empty.
 *
 * Each panel is its own component with the shape its future service plugs
 * into: `DeadlinesCard`, `UpcomingEventsCard` ("Your week") and `WorkloadCard`
 * each take a typed array/result and render rows the day their data exists.
 *
 * Side by side at `sm` (the workload tile fills its row below the pair), back
 * to one column at `lg` where they become the third column of the dashboard
 * grid and stand beside the primary card instead of under it.
 *
 * The three entrances are deliberately distinct in kind — deadlines arrive
 * with depth (`scale`), the week from the right, workload with the plain rise
 * — so the column reads as a composition of different surfaces rather than
 * one repeated fade, using only the four shared keyframes.
 */
export function SupportingCards({
  index,
  guest = false,
}: {
  index: number;
  guest?: boolean;
}) {
  return (
    <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-1">
      <DeadlinesCard index={index} guest={guest} />
      <UpcomingEventsCard index={index + 1} guest={guest} />
      <WorkloadCard index={index + 2} guest={guest} />
    </div>
  );
}
