/**
 * Calendar date math for the week/month grids (Task 17.3).
 *
 * One clock, and it is not the client's. `todayIso` arrives from the server
 * (page.tsx, `formatIsoDate(new Date())`) as a `YYYY-MM-DD` string, and every
 * calculation below is pure calendar arithmetic on such strings — parsed as
 * UTC dates and never re-derived from `new Date()` on the client. That is the
 * 15.1 rule applied to an interactive view: the server rendered the grid
 * around an anchor the client hydrates verbatim, so no midnight crossing, no
 * timezone drift, no hydration mismatch (§4 of this task).
 *
 * Why UTC and not "local": the anchor is a *date*, not an instant. Parsing
 * `YYYY-MM-DD` with `Date.parse` lands it at UTC midnight, which makes every
 * `getUTCDay`/`getUTCDate` below deterministic in every environment — dev,
 * CI, any production timezone. The alternative (local-time parsing) would make
 * the weekday of a cell depend on the machine reading it. The user-timezone
 * story is deliberately not invented here (17.14 owns it); until then the
 * anchor is the server's date, the same limitation `dashboardDate` documents
 * on the greeting.
 */

/** `YYYY-MM-DD` — the only date representation this module accepts or emits. */
export type IsoDate = string;

const MS_PER_DAY = 86_400_000;

/** Parses an ISO date to a UTC-midnight Date. Callers pass the result around; strings cross component borders. */
function parseIso(iso: IsoDate): Date {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ISO date: ${iso}`);
  }
  return date;
}

/** Formats a UTC Date back to `YYYY-MM-DD`. */
function toIso(date: Date): IsoDate {
  return date.toISOString().slice(0, 10);
}

/** The server's current date as `YYYY-MM-DD` — the one place a clock is read. */
export function formatIsoDate(date: Date): IsoDate {
  return toIso(date);
}

/** Days since the epoch for a UTC date. Subtraction is date math without DST. */
function dayNumber(iso: IsoDate): number {
  return Math.round(parseIso(iso).getTime() / MS_PER_DAY);
}

/** The ISO date `days` after (or before) `iso`. */
export function addDays(iso: IsoDate, days: number): IsoDate {
  return toIso(new Date((dayNumber(iso) + days) * MS_PER_DAY));
}

/**
 * The Monday containing `iso`.
 *
 * Monday is the week start the reference design settles on — its "This Week"
 * panel reads Monday, Wednesday, Friday — and the choice is stated here so
 * it lives in one place (17.3 §5: undefined in the spec, chosen from the
 * existing convention, documented).
 */
export function startOfWeek(iso: IsoDate): IsoDate {
  // getUTCDay: 0=Sunday … 6=Saturday. Monday start means shifting Sunday back 6.
  const weekday = parseIso(iso).getUTCDay();
  return addDays(iso, weekday === 0 ? -6 : 1 - weekday);
}

/** One cell of a grid: a real calendar date plus whether it belongs to the displayed month/week. */
export type CalendarCell = {
  /** The date this cell represents, `YYYY-MM-DD`. */
  iso: IsoDate;
  /** Day of month, 1–31. */
  day: number;
  /** False for month-view spillover cells from the previous/next month. */
  inPeriod: boolean;
};

/** The seven weekday header labels, Monday-first, matching `startOfWeek`. */
export const WEEKDAY_LABELS: readonly string[] = [
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
];

/**
 * The month grid for the month containing `anchor`: 5–6 rows of seven cells,
 * Monday-first, with spillover from the neighbouring months.
 *
 * Rows are however many the month needs (§6): the arithmetic below adds
 * cells from the Monday before the 1st through the Sunday after the last
 * day, so a 28-day February starting on Monday is exactly 4 rows, a 31-day
 * month starting on Saturday is 6, and everything between falls out of the
 * calendar rather than a hardcoded row count.
 */
export function monthGrid(anchor: IsoDate): CalendarCell[][] {
  const date = parseIso(anchor);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();

  const firstOfMonth = toIso(new Date(Date.UTC(year, month, 1)));
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const lastOfMonth = addDays(firstOfMonth, daysInMonth - 1);

  const firstCell = startOfWeek(firstOfMonth);
  const lastCell = addDays(startOfWeek(lastOfMonth), 6);

  const rows: CalendarCell[][] = [];
  for (let cursor = firstCell; cursor <= lastCell; cursor = addDays(cursor, 7)) {
    rows.push(
      Array.from({ length: 7 }, (_, index) => {
        const iso = addDays(cursor, index);
        return {
          iso,
          day: parseIso(iso).getUTCDate(),
          inPeriod: parseIso(iso).getUTCMonth() === month,
        };
      }),
    );
  }
  return rows;
}

/**
 * The week grid for the week containing `anchor`: one row of seven cells,
 * all in-period, Monday-first.
 */
export function weekGrid(anchor: IsoDate): CalendarCell[][] {
  const start = startOfWeek(anchor);
  return [
    Array.from({ length: 7 }, (_, index) => {
      const iso = addDays(start, index);
      return { iso, day: parseIso(iso).getUTCDate(), inPeriod: true };
    }),
  ];
}

/**
 * The month label for the grid's period, e.g. "August 2026".
 *
 * `en-US` and the long style are pinned — the same determinism decision as
 * `dashboardDate`, so a month's name cannot shift with the host locale.
 */
export function periodLabel(anchor: IsoDate): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(parseIso(anchor));
}

/** Whether a cell's date is the anchor date — the "today" marker. */
export function isToday(cell: IsoDate, todayIso: IsoDate): boolean {
  return cell === todayIso;
}
