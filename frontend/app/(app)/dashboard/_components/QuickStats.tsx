import { CalendarCheck, FileText, Flame, type LucideIcon } from "lucide-react";
import { motionIndex } from "@/components/motion/stagger";
import { Card } from "@/components/ui/Card";

/**
 * One quick-stat reading, the whole of what a future service may send
 * (15.4 §4). `value` absent is the honest state today and stays first-class:
 * "unknown" is not zero, and rendering a 0 for a stat whose source does not
 * exist would claim a count that was never made.
 *
 * `value` and `suffix` are display-ready pieces rather than a number, so the
 * future services own formatting — a streak is "5" plus "days", and a week's
 * task count is an integer the task service counted, not this strip. The
 * caption under a value ("Due this week") is a cell constant, not service
 * data: it describes the stat, not the reading.
 */
export type QuickStat = {
  /** The reading itself, e.g. "4". Absent renders the neutral state. */
  value?: string;
  /** Unit glued to the value, e.g. "days" on a streak. Rendered smaller. */
  suffix?: string;
};

type QuickStatsProps = {
  /** Position in the page's entrance stagger. */
  index: number;
  /** Real readings when the services that own them exist. Absent per stat is
   *  the neutral state; absent entirely is the whole strip neutral. */
  stats?: {
    tasksDueThisWeek?: QuickStat;
    documentsProcessed?: QuickStat;
    studyStreak?: QuickStat;
  };
};

type StatCell = {
  id: "tasksDueThisWeek" | "documentsProcessed" | "studyStreak";
  label: string;
  icon: LucideIcon;
  /** The line shown when there is no reading — states what will fill it. */
  empty: string;
  /** The caption shown under a real value. */
  caption: string;
};

const CELLS: readonly StatCell[] = [
  {
    id: "tasksDueThisWeek",
    label: "Tasks due this week",
    icon: CalendarCheck,
    empty: "Nothing due yet.",
    caption: "Due this week",
  },
  {
    id: "documentsProcessed",
    label: "Documents processed",
    icon: FileText,
    empty: "No documents yet.",
    caption: "Processed",
  },
  {
    id: "studyStreak",
    label: "Study streak",
    icon: Flame,
    empty: "Start your streak.",
    caption: "Current streak",
  },
];

/**
 * The quick-stats strip (Task 15.4): three readings, one row, and the
 * dashboard not turning into an analytics page.
 *
 * One glass strip with internal dividers rather than three floating cards —
 * the reference draws stats as cells of a single surface, and three more
 * bordered tiles beside the six the dashboard already has would read as
 * clutter, not a snapshot. The cells reflow 3 → 1 across `sm`, dividers
 * switching from horizontal to vertical with the grid.
 *
 * Hierarchy per cell (15.4 §6): a mono label-caps eyebrow with its icon, then
 * the primary state. Today the primary state is the neutral line, set as
 * body text — "Nothing due yet." reads as an English sentence about the
 * future, not a zero pretending to be data. When a real service sends a
 * value, the same slot renders it large in Bricolage with the caption
 * beneath; the structure is identical, only the slot's content changes.
 *
 * The cells are non-interactive and carry no link semantics — a stat is a
 * reading, not a button (15.4 §13). No `hover-lift` either: lifting a reading
 * implies it goes somewhere, and it does not.
 *
 * Motion (15.4 §10): the strip rises at the next ladder slot, and the cells
 * assemble from its ends — first and third slide from `left`/`right`, the
 * middle cell rises with the strip itself — using the existing `data-enter`
 * variants, the same side-pair idiom as the quick-access row below. Cell
 * delays extend the strip's own slot (`index + position`), so the cells land
 * as the strip arrives rather than finishing before it starts. No text
 * inside a cell animates, nothing bounces, and no cell is ever behind an
 * observer — the entrances are the same CSS keyframes every other section
 * uses.
 */
export function QuickStats({ index, stats }: QuickStatsProps) {
  return (
    <Card
      data-enter
      style={motionIndex(index)}
      variant="compact"
      className="grid min-w-0 grid-cols-1 divide-y divide-border bg-glass backdrop-blur-md sm:grid-cols-3 sm:divide-x sm:divide-y-0"
    >
      {CELLS.map((cell, position) => {
        const stat = stats?.[cell.id];
        const hasValue = Boolean(stat?.value);
        /* The end cells arrive from their own side; the middle cell takes the
           default rise — the strip assembles from its ends, one variant per
           position rather than one repeated fade. */
        const enterVariant =
          position === 0 ? "left" : position === CELLS.length - 1 ? "right" : true;
        return (
          <div
            key={cell.id}
            data-enter={enterVariant}
            style={motionIndex(index + position)}
            className="flex min-w-0 flex-col gap-1.5 p-4"
          >
            <span className="flex items-center gap-1.5 font-mono text-label-caps uppercase text-muted-foreground">
              <cell.icon aria-hidden="true" className="size-3.5 shrink-0" />
              {cell.label}
            </span>
            {hasValue && stat ? (
              <p className="wrap-anywhere font-heading text-headline-md font-semibold leading-tight text-foreground">
                {stat.value}
                {stat.suffix ? (
                  <span className="ml-1 text-body-md font-normal text-muted-foreground">
                    {stat.suffix}
                  </span>
                ) : null}
              </p>
            ) : (
              <p className="text-label-sm text-muted-foreground">{cell.empty}</p>
            )}
            {hasValue && stat ? (
              <p className="text-label-sm text-muted-foreground">{cell.caption}</p>
            ) : null}
          </div>
        );
      })}
    </Card>
  );
}
