/**
 * WhatsApp group sync: the deterministic date resolver.
 *
 * The model NEVER does date arithmetic. It reads a message and reports what was
 * SAID ("next Friday", "tomorrow 2pm", "5 Dec", "5/12") as a structured `when`;
 * this module turns that into an exact instant using facts the model cannot
 * know or must not guess: when the message was sent, the student's time zone
 * and their numeric date order. Everything here is pure and unit-tested.
 *
 * Conventions mirror the app (frontend/lib/data/taskDates.ts):
 * - a date with no time is the instant of 00:00 in the student's zone;
 * - an all-day event's end is the EXCLUSIVE start of the following day.
 *
 * Choices that are genuinely ambiguous are resolved one way and reported as a
 * `penalty` (subtracted from the model's confidence), so an uncertain reading
 * lands in the review queue instead of silently on the calendar:
 * - a bare weekday means the next one (today only if a time later today is
 *   given); the same-weekday case carries a penalty;
 * - "next <weekday>" means that day in NEXT calendar week (Mon-Sun), with a
 *   penalty, because many people mean "the coming one";
 * - a numeric date with both parts <= 12 follows the user's date order, with a
 *   penalty; a missing year that would put the date in the past rolls forward.
 */

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MS_DAY = 86_400_000;

/** Penalties subtracted from the model's confidence (0..1). */
export const PENALTY = {
  AMBIGUOUS_NUMERIC: 0.1,
  INFERRED_YEAR: 0.1,
  NEXT_WEEKDAY: 0.1,
  SAME_WEEKDAY: 0.15,
  ROLLED_OVER: 0.15,
};

// ---- time zone helpers -------------------------------------------------------

const formatterCache = new Map();

function partsFormatter(timeZone) {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      weekday: "short",
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

/** The wall-clock parts of an instant in a zone. `weekday`: 0 = Sunday. */
export function zonedParts(instantMs, timeZone) {
  const out = {};
  for (const p of partsFormatter(timeZone).formatToParts(new Date(instantMs))) {
    out[p.type] = p.value;
  }
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour) % 24,
    minute: Number(out.minute),
    second: Number(out.second),
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(out.weekday),
  };
}

/** Offset of a zone from UTC at an instant, in ms (positive east of UTC). */
function zoneOffsetMs(instantMs, timeZone) {
  const p = zonedParts(instantMs, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

/**
 * The instant at which a zone's wall clock reads y-m-d h:mi. Two passes settle
 * the offset across a DST change; a wall time that does not exist (spring
 * forward) lands just after the gap, and an ambiguous one (fall back) takes
 * the earlier instant.
 */
export function zonedToInstant(y, m, d, hh, mi, timeZone) {
  const guess = Date.UTC(y, m - 1, d, hh, mi, 0);
  const first = guess - zoneOffsetMs(guess, timeZone);
  return guess - zoneOffsetMs(first, timeZone);
}

export function isValidTimeZone(timeZone) {
  try {
    partsFormatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function isRealDate(y, m, d) {
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

/** y-m-d plus n days (calendar arithmetic, zone-free). */
function addDays(y, m, d, n) {
  const t = new Date(Date.UTC(y, m - 1, d) + n * MS_DAY);
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

function weekdayOf(y, m, d) {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function parseTime(value) {
  if (typeof value !== "string") return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return m ? { hh: Number(m[1]), mi: Number(m[2]) } : null;
}

/**
 * "5/12", "05-12-2026", "12.3.26": numeric parts only. Returns null when it is
 * not a plain numeric date. Month names are the model's job (it reports them as
 * `day`/`month`).
 */
export function parseNumericDate(text, dateOrder) {
  if (typeof text !== "string") return null;
  const m = /^\s*(\d{1,4})\s*[/.\-]\s*(\d{1,2})(?:\s*[/.\-]\s*(\d{2,4}))?\s*$/.exec(text);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  let c = m[3] === undefined ? null : Number(m[3]);

  // Year-first (2026-12-05) is unambiguous.
  if (m[1].length === 4) {
    if (c === null) return null;
    return { year: a, month: b, day: c, ambiguous: false };
  }
  if (c !== null && c < 100) c += 2000;

  const [day, month] = dateOrder === "MDY" ? [b, a] : [a, b];
  const ambiguous = a <= 12 && b <= 12 && a !== b;
  return { year: c, month, day, ambiguous };
}

/**
 * Resolve a model-reported `when`.
 *
 * @param when     the model's structured date (all fields nullable)
 * @param ctx      { sentAt: Date, timeZone: string, dateOrder: 'DMY'|'MDY', now?: Date }
 * @returns        { status, startAt, endAt, allDay, penalty, notes }
 *   status: 'resolved' | 'none' (no date said) | 'invalid' | 'past'
 */
export function resolveWhen(when, ctx) {
  const timeZone = isValidTimeZone(ctx.timeZone) ? ctx.timeZone : "UTC";
  const dateOrder = ctx.dateOrder === "MDY" ? "MDY" : "DMY";
  const now = ctx.now ?? new Date();
  const notes = [];
  let penalty = 0;

  const w = when ?? {};
  const sent = zonedParts(ctx.sentAt.getTime(), timeZone);
  const time = parseTime(w.time);
  const endTime = parseTime(w.end_time);

  const none = (status) => ({
    status,
    startAt: null,
    endAt: null,
    allDay: false,
    penalty,
    notes,
  });

  let target = null; // { year, month, day }

  // 1. an explicit day + month (the model read a month name or written date)
  if (Number.isInteger(w.day) && Number.isInteger(w.month)) {
    let year = Number.isInteger(w.year) ? w.year : null;
    if (year === null) {
      year = sent.year;
      const candidate = Date.UTC(year, w.month - 1, w.day);
      const today = Date.UTC(sent.year, sent.month - 1, sent.day);
      if (candidate < today) {
        year += 1;
        penalty += PENALTY.ROLLED_OVER;
        notes.push("no year stated; moved to next year");
      }
    }
    if (!isRealDate(year, w.month, w.day)) return none("invalid");
    target = { year, month: w.month, day: w.day };
  }

  // 2. a numeric date as written ("5/12")
  if (!target && w.date_text) {
    const numeric = parseNumericDate(w.date_text, dateOrder);
    if (!numeric) return none("invalid");
    let year = numeric.year;
    if (numeric.ambiguous) {
      penalty += PENALTY.AMBIGUOUS_NUMERIC;
      notes.push(`numeric date read as ${dateOrder}`);
    }
    if (year === null) {
      year = sent.year;
      const candidate = Date.UTC(year, numeric.month - 1, numeric.day);
      const today = Date.UTC(sent.year, sent.month - 1, sent.day);
      if (candidate < today) {
        year += 1;
        penalty += PENALTY.ROLLED_OVER;
        notes.push("no year stated; moved to next year");
      }
    }
    if (!isRealDate(year, numeric.month, numeric.day)) return none("invalid");
    target = { year, month: numeric.month, day: numeric.day };
  }

  // 3. relative words
  if (!target && (w.relative || w.in_days || w.in_weeks)) {
    let offset = 0;
    if (w.relative === "tomorrow") offset = 1;
    else if (w.relative === "day_after_tomorrow") offset = 2;
    else if (w.relative === "today" || w.relative === "tonight") offset = 0;
    else if (Number.isInteger(w.in_days)) offset = w.in_days;
    else if (Number.isInteger(w.in_weeks)) offset = w.in_weeks * 7;
    else return none("invalid");
    target = addDays(sent.year, sent.month, sent.day, offset);
  }

  // 4. a weekday
  if (!target && typeof w.weekday === "string") {
    const wanted = WEEKDAYS.indexOf(w.weekday.toLowerCase());
    if (wanted < 0) return none("invalid");
    const todayIdx = sent.weekday;

    if (w.week_ref === "next") {
      // Monday of next calendar week, then the wanted day (Mon=0 .. Sun=6).
      const sinceMonday = (todayIdx + 6) % 7;
      const nextMonday = addDays(sent.year, sent.month, sent.day, 7 - sinceMonday);
      const wantedFromMonday = (wanted + 6) % 7;
      target = addDays(nextMonday.year, nextMonday.month, nextMonday.day, wantedFromMonday);
      penalty += PENALTY.NEXT_WEEKDAY;
      notes.push('"next <day>" read as that day in next calendar week');
    } else if (w.week_ref === "this") {
      const sinceMonday = (todayIdx + 6) % 7;
      const wantedFromMonday = (wanted + 6) % 7;
      if (wantedFromMonday < sinceMonday) return none("past");
      target = addDays(sent.year, sent.month, sent.day, wantedFromMonday - sinceMonday);
    } else {
      let diff = (wanted - todayIdx + 7) % 7;
      if (diff === 0) {
        const laterToday =
          time !== null && time.hh * 60 + time.mi > sent.hour * 60 + sent.minute;
        if (!laterToday) {
          diff = 7;
          penalty += PENALTY.SAME_WEEKDAY;
          notes.push("same weekday as the message; read as next week");
        }
      }
      target = addDays(sent.year, sent.month, sent.day, diff);
    }
  }

  if (!target) return none("none");

  let startAt;
  let endAt = null;
  let allDay = false;

  if (time) {
    startAt = zonedToInstant(target.year, target.month, target.day, time.hh, time.mi, timeZone);
    if (endTime) {
      const end = zonedToInstant(target.year, target.month, target.day, endTime.hh, endTime.mi, timeZone);
      if (end > startAt) endAt = end;
      else notes.push("end time not after start; ignored");
    }
  } else {
    allDay = true;
    startAt = zonedToInstant(target.year, target.month, target.day, 0, 0, timeZone);
    const next = addDays(target.year, target.month, target.day, 1);
    endAt = zonedToInstant(next.year, next.month, next.day, 0, 0, timeZone);
  }

  // Something already over is not actionable (an old history message).
  const cutoff = now.getTime() - MS_DAY;
  if ((endAt ?? startAt) < cutoff) {
    return {
      status: "past",
      startAt: new Date(startAt),
      endAt: endAt === null ? null : new Date(endAt),
      allDay,
      penalty,
      notes,
    };
  }

  return {
    status: "resolved",
    startAt: new Date(startAt),
    endAt: endAt === null ? null : new Date(endAt),
    allDay,
    penalty,
    notes,
  };
}
