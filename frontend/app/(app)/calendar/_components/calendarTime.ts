/**
 * Hour-label math for the week view's time gutter (Task 17.4).
 *
 * The companion of `calendarMath`, for time instead of dates: pure,
 * deterministic, timezone-free. Hour labels are static text — 00:00 through
 * 23:00 exist on every day in every environment — so nothing here reads a
 * clock, formats through a locale, or converts a timezone (§6 of this task:
 * the timezone/DST strategy belongs to 17.14, and inventing one here would
 * make the labels nondeterministic for nothing).
 *
 * Range: the complete day, 00–23 (§3). No constrained schedule exists in the
 * reference or Phase 22 — a student's day is not 9-to-5 — and the task's rule
 * for that case is a full-day range, documented. Format: `H:MM AM/PM` — the
 * 12-hour format the reference's own calendar panel uses ("Tomorrow · 10:00
 * AM"), zero-padded minutes, one format everywhere (§4).
 */

/** One hour of the week grid: the label for the gutter, and the hour's 0–23 index for the future event seam. */
export type HourLabel = {
  /** `0`–`23`. The hour-of-day an event's start time will resolve against. */
  hour: number;
  /** Display label, e.g. "10:00 AM". */
  label: string;
};

/** Formats an hour-of-day as the project's one time format: `H:MM AM/PM`. */
function formatHour(hour: number): string {
  const suffix = hour < 12 ? "AM" : "PM";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:00 ${suffix}`;
}

/**
 * The 24 hour labels of a week-view day, 00:00 → 11:00 PM, exactly once each,
 * monotonically ordered (§27 of this task: 00→23, no duplicates).
 *
 * Generated, never hand-listed — a pure function the grid maps over, so the
 * gutter and the day columns are built from the same array and cannot drift
 * apart.
 */
export function hourLabels(): HourLabel[] {
  return Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: formatHour(hour),
  }));
}
