/**
 * The project's one date/time maths module (Tasks 21.8 and 22.x), shared by
 * the tasks and events services and their tests.
 *
 * The database stores `due_date`, `start_at` and `end_at` as `timestamptz` —
 * instants. The UIs speak calendar dates ("2026-09-02"), local wall-clock
 * date-times ("2026-09-02T09:00") and display strings ("Wed, Sep 2", "9:00
 * AM"). Converting between those is this module's whole job, and it is
 * deliberately pure (no server imports) so the same functions can be tested
 * directly. Events extend it rather than growing a second date system.
 *
 * R15's one timezone strategy: the profile's IANA zone decides what a
 * calendar date means. A date-only value becomes the instant of 00:00 **in
 * that zone** — not UTC midnight — so "Sep 2" never renders as "Sep 1" for a
 * student east or west of UTC, and every formatter uses the same zone so the
 * string the UI prints is the calendar date the student chose.
 */

const DATE_TIME_FORMAT_PARTS = {
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
} as const;

function part(parts: Map<string, string>, type: string): number {
  return Number(parts.get(type) ?? "0");
}

/**
 * The zone's UTC offset (in milliseconds) at one instant. Positive east of
 * UTC. Derived from `Intl` rather than a timezone database of our own; the
 * `% 24` is for engines that render midnight as hour "24" under `hour12:
 * false`.
 */
function zoneOffsetMs(instantMs: number, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    ...DATE_TIME_FORMAT_PARTS,
  });
  const parts = new Map(
    formatter.formatToParts(new Date(instantMs)).map((p) => [p.type, p.value]),
  );
  const wallClockAsUtc = Date.UTC(
    part(parts, "year"),
    part(parts, "month") - 1,
    part(parts, "day"),
    part(parts, "hour") % 24,
    part(parts, "minute"),
    part(parts, "second"),
  );
  return wallClockAsUtc - instantMs;
}

/**
 * The UTC instant of 00:00 on `dateIso` ("YYYY-MM-DD") in `timeZone`, as an
 * ISO string ready for the `timestamptz` column.
 *
 * Two passes: the first offset is computed from a UTC guess, the second from
 * the adjusted instant, which settles the rare case of a DST transition at
 * midnight (where the offset changes between the guess and the result).
 */
export function zonedDateOnlyToInstant(
  dateIso: string,
  timeZone: string,
): string {
  const [year, month, day] = dateIso.split("-").map(Number);
  const utcMidnightGuess = Date.UTC(year, month - 1, day, 0, 0, 0);
  const firstPass = utcMidnightGuess - zoneOffsetMs(utcMidnightGuess, timeZone);
  const settled = utcMidnightGuess - zoneOffsetMs(firstPass, timeZone);
  return new Date(settled).toISOString();
}

/**
 * The card's due-date string: weekday, month and day ("Wed, Sep 2"), in the
 * profile's zone. Never a raw timestamp — the 16.5 contract, and the same
 * server-formats-the-clock rule `dashboardDate` follows.
 */
export function formatTaskDueDate(
  instantIso: string,
  timeZone: string,
): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(instantIso));
}

/**
 * The inverse of `zonedDateOnlyToInstant`: the calendar date ("YYYY-MM-DD")
 * the given instant falls on in `timeZone`. Exists for the edit form, whose
 * native date input needs a date value, not the card's display string.
 *
 * The parts are reassembled explicitly into YYYY-MM-DD, so the locale only
 * decides digit grouping, never the shape.
 */
export function instantToDateOnly(
  instantIso: string,
  timeZone: string,
): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = new Map(
    formatter.formatToParts(new Date(instantIso)).map((p) => [p.type, p.value]),
  );
  const year = parts.get("year") ?? "0000";
  const month = parts.get("month") ?? "00";
  const day = parts.get("day") ?? "00";
  return `${year}-${month}-${day}`;
}

/**
 * A local wall-clock date-time ("YYYY-MM-DDTHH:mm", or a bare date for
 * midnight) in `timeZone` → its UTC instant. The event form's
 * `datetime-local` value goes through here.
 *
 * Two passes settle the offset: the first from the UTC guess, the second from
 * the adjusted instant. They agree for ordinary wall times. When they differ
 * the time sits on a DST edge:
 * - spring forward (the wall time does not exist): the *earlier* offset wins,
 *   which resolves the value forward past the gap — 02:30 on New York's
 *   spring-forward night lands at 03:30 EDT, the platform-compatible reading,
 *   never back at 01:30;
 * - fall back (the wall time occurs twice): the earlier offset also wins, so
 *   01:30 lands on the first (EDT) occurrence.
 *
 * The property the tests pin is therefore: ordinary wall times round-trip
 * exactly, gap times move forward by the gap, and ambiguous times pick the
 * first occurrence — deterministic and dusk-to-dawn stable.
 */
export function zonedLocalDateTimeToInstant(
  localIso: string,
  timeZone: string,
): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(
    localIso.trim(),
  );
  if (!match) {
    throw new Error("Invalid local date-time.");
  }
  const [, year, month, day, hour = "00", minute = "00"] = match;
  const wallAsUtc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    0,
  );

  const firstOffset = zoneOffsetMs(wallAsUtc, timeZone);
  const firstPass = wallAsUtc - firstOffset;
  const secondOffset = zoneOffsetMs(firstPass, timeZone);
  const chosenOffset =
    firstOffset === secondOffset ? firstOffset : Math.min(firstOffset, secondOffset);
  return new Date(wallAsUtc - chosenOffset).toISOString();
}

/**
 * The local wall-clock value an instant reads as in `timeZone`
 * ("YYYY-MM-DDTHH:mm"). The inverse of the function above, and the value the
 * event form's `datetime-local` input shows.
 */
export function instantToZonedLocalDateTime(
  instantIso: string,
  timeZone: string,
): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    ...DATE_TIME_FORMAT_PARTS,
  });
  const parts = new Map(
    formatter.formatToParts(new Date(instantIso)).map((p) => [p.type, p.value]),
  );
  const year = parts.get("year") ?? "0000";
  const month = parts.get("month") ?? "00";
  const day = parts.get("day") ?? "00";
  const hour = String(part(parts, "hour") % 24).padStart(2, "0");
  const minute = String(part(parts, "minute")).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

/**
 * The time a clock reads at an instant in `timeZone`, e.g. "9:00 AM" — the
 * event block's time label. The narrow no-break space some ICU versions put
 * before AM/PM is normalized so display strings are stable across runtimes.
 */
export function formatEventTime(
  instantIso: string,
  timeZone: string,
): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(new Date(instantIso))
    .replace(/\u202f/g, " ");
}

/**
 * Whether "YYYY-MM-DD" is a real calendar date (rejects 2026-02-30). Shared by
 * the task due-date and event start/end validators so both agree on what a
 * date is.
 */
export function isRealDateOnly(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  return (
    check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day
  );
}

/** Whether "YYYY-MM-DDTHH:mm" is a real date and a real 24-hour time. */
export function isRealLocalDateTime(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return false;
  if (!isRealDateOnly(`${match[1]}-${match[2]}-${match[3]}`)) return false;
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

/**
 * The calendar date after `dateIso` ("YYYY-MM-DD" → next day). Used for
 * all-day events, whose stored end is the exclusive start of the following
 * day so a whole-day span is one half-open interval.
 */
export function nextDateOnly(dateIso: string): string {
  const [year, month, day] = dateIso.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(
    2,
    "0",
  )}-${String(next.getUTCDate()).padStart(2, "0")}`;
}
