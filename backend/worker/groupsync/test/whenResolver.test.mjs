import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseNumericDate,
  PENALTY,
  resolveWhen,
  zonedParts,
  zonedToInstant,
} from "../whenResolver.mjs";

// Wednesday 2026-11-18 10:00 UTC = 15:30 in Asia/Kolkata (UTC+5:30, no DST).
const SENT = new Date("2026-11-18T10:00:00Z");
const IST = "Asia/Kolkata";

const blank = {
  date_text: null,
  day: null,
  month: null,
  year: null,
  weekday: null,
  week_ref: null,
  relative: null,
  in_days: null,
  in_weeks: null,
  time: null,
  end_time: null,
};
const ctx = (over = {}) => ({ sentAt: SENT, timeZone: IST, dateOrder: "DMY", now: SENT, ...over });
const when = (over) => ({ ...blank, ...over });
const iso = (d) => (d ? d.toISOString() : null);

describe("time zone helpers", () => {
  it("reads wall-clock parts in a zone", () => {
    const p = zonedParts(SENT.getTime(), IST);
    assert.deepEqual(
      [p.year, p.month, p.day, p.hour, p.minute, p.weekday],
      [2026, 11, 18, 15, 30, 3],
    );
  });

  it("converts local wall time to an instant, across DST", () => {
    assert.equal(
      new Date(zonedToInstant(2026, 11, 19, 0, 0, IST)).toISOString(),
      "2026-11-18T18:30:00.000Z",
    );
    // New York: EST (UTC-5) before 2026-03-08, EDT (UTC-4) after.
    assert.equal(
      new Date(zonedToInstant(2026, 3, 7, 9, 0, "America/New_York")).toISOString(),
      "2026-03-07T14:00:00.000Z",
    );
    assert.equal(
      new Date(zonedToInstant(2026, 3, 8, 9, 0, "America/New_York")).toISOString(),
      "2026-03-08T13:00:00.000Z",
    );
  });
});

describe("parseNumericDate", () => {
  it("follows the date order", () => {
    assert.deepEqual(parseNumericDate("5/12", "DMY"), { year: null, month: 12, day: 5, ambiguous: true });
    assert.deepEqual(parseNumericDate("5/12", "MDY"), { year: null, month: 5, day: 12, ambiguous: true });
  });

  it("is unambiguous when one part cannot be a month, or the year leads", () => {
    assert.equal(parseNumericDate("13/12", "DMY").ambiguous, false);
    assert.equal(parseNumericDate("3/3", "DMY").ambiguous, false);
    assert.deepEqual(parseNumericDate("2026-12-05", "MDY"), { year: 2026, month: 12, day: 5, ambiguous: false });
  });

  it("expands a two-digit year and accepts . and - separators", () => {
    assert.equal(parseNumericDate("12.3.26", "DMY").year, 2026);
    assert.equal(parseNumericDate("12-03-2026", "DMY").year, 2026);
  });

  it("rejects text that is not a numeric date", () => {
    assert.equal(parseNumericDate("next friday", "DMY"), null);
    assert.equal(parseNumericDate("12", "DMY"), null);
    assert.equal(parseNumericDate(null, "DMY"), null);
  });
});

describe("resolveWhen: relative words", () => {
  it("tomorrow with no time is an all-day entry in the student's zone", () => {
    const r = resolveWhen(when({ relative: "tomorrow" }), ctx());
    assert.equal(r.status, "resolved");
    assert.equal(r.allDay, true);
    assert.equal(iso(r.startAt), "2026-11-18T18:30:00.000Z"); // Nov 19 00:00 IST
    assert.equal(iso(r.endAt), "2026-11-19T18:30:00.000Z"); // exclusive next midnight
    assert.equal(r.penalty, 0);
  });

  it("tomorrow at 14:00 is that wall time in the student's zone", () => {
    const r = resolveWhen(when({ relative: "tomorrow", time: "14:00" }), ctx());
    assert.equal(r.allDay, false);
    assert.equal(iso(r.startAt), "2026-11-19T08:30:00.000Z");
    assert.equal(r.endAt, null);
  });

  it("reads an end time, and ignores one that is not after the start", () => {
    const ok = resolveWhen(when({ relative: "tomorrow", time: "14:00", end_time: "16:30" }), ctx());
    assert.equal(iso(ok.endAt), "2026-11-19T11:00:00.000Z");
    const bad = resolveWhen(when({ relative: "tomorrow", time: "14:00", end_time: "13:00" }), ctx());
    assert.equal(bad.endAt, null);
    assert.ok(bad.notes.length > 0);
  });

  it("day after tomorrow, in N days, in N weeks, today, tonight", () => {
    const day = (over) => iso(resolveWhen(when(over), ctx()).startAt).slice(0, 10);
    // all-day starts at IST midnight = previous day 18:30Z
    assert.equal(day({ relative: "day_after_tomorrow" }), "2026-11-19");
    assert.equal(day({ in_days: 3 }), "2026-11-20");
    assert.equal(day({ in_weeks: 1 }), "2026-11-24");
    assert.equal(day({ relative: "today" }), "2026-11-17");
    assert.equal(day({ relative: "tonight" }), "2026-11-17");
  });

  it("uses the SENDER's local date, not UTC's, around midnight", () => {
    // 2026-11-18 20:00 UTC = 2026-11-19 01:30 IST, so "today" is Nov 19 there.
    const r = resolveWhen(
      when({ relative: "today", time: "23:00" }),
      ctx({ sentAt: new Date("2026-11-18T20:00:00Z"), now: new Date("2026-11-18T20:00:00Z") }),
    );
    assert.equal(iso(r.startAt), "2026-11-19T17:30:00.000Z");
  });
});

describe("resolveWhen: weekdays", () => {
  const start = (over, c = ctx()) => iso(resolveWhen(when(over), c).startAt);

  it("a bare weekday is the next one", () => {
    const r = resolveWhen(when({ weekday: "friday" }), ctx());
    assert.equal(iso(r.startAt), "2026-11-19T18:30:00.000Z"); // Fri Nov 20 00:00 IST
    assert.equal(r.penalty, 0);
  });

  it("the same weekday means next week, with a penalty", () => {
    const r = resolveWhen(when({ weekday: "wednesday" }), ctx());
    assert.equal(iso(r.startAt), "2026-11-24T18:30:00.000Z"); // Wed Nov 25
    assert.equal(r.penalty, PENALTY.SAME_WEEKDAY);
  });

  it("the same weekday means today when a later time today is given", () => {
    const r = resolveWhen(when({ weekday: "wednesday", time: "18:00" }), ctx());
    assert.equal(iso(r.startAt), "2026-11-18T12:30:00.000Z");
    assert.equal(r.penalty, 0);
    const earlier = resolveWhen(when({ weekday: "wednesday", time: "09:00" }), ctx());
    assert.equal(iso(earlier.startAt).slice(0, 10), "2026-11-25", "09:00 already passed locally");
  });

  it("'next friday' is Friday of next calendar week, with a penalty", () => {
    const r = resolveWhen(when({ weekday: "friday", week_ref: "next" }), ctx());
    assert.equal(iso(r.startAt), "2026-11-26T18:30:00.000Z"); // Fri Nov 27
    assert.equal(r.penalty, PENALTY.NEXT_WEEKDAY);
  });

  it("'this friday' is in the current week; 'this monday' has already passed", () => {
    assert.equal(start({ weekday: "friday", week_ref: "this" }), "2026-11-19T18:30:00.000Z");
    assert.equal(resolveWhen(when({ weekday: "monday", week_ref: "this" }), ctx()).status, "past");
  });

  it("'next monday' on a Sunday is the very next day's week", () => {
    // Sunday 2026-11-22 (IST). Next calendar week starts Mon Nov 23.
    const sunday = new Date("2026-11-22T06:00:00Z");
    const r = resolveWhen(
      when({ weekday: "monday", week_ref: "next" }),
      ctx({ sentAt: sunday, now: sunday }),
    );
    assert.equal(iso(r.startAt), "2026-11-22T18:30:00.000Z"); // Mon Nov 23 00:00 IST
  });

  it("rejects an unknown weekday", () => {
    assert.equal(resolveWhen(when({ weekday: "someday" }), ctx()).status, "invalid");
  });
});

describe("resolveWhen: explicit and numeric dates", () => {
  it("a named date with no year uses this year when still ahead", () => {
    const r = resolveWhen(when({ day: 5, month: 12 }), ctx());
    assert.equal(iso(r.startAt), "2026-12-04T18:30:00.000Z");
    assert.equal(r.penalty, 0);
  });

  it("a named date that already passed this year rolls to next year, with a penalty", () => {
    const r = resolveWhen(when({ day: 5, month: 11 }), ctx());
    assert.equal(iso(r.startAt).slice(0, 4), "2027");
    assert.equal(r.penalty, PENALTY.ROLLED_OVER);
  });

  it("a stated year is respected", () => {
    const r = resolveWhen(when({ day: 5, month: 12, year: 2027 }), ctx());
    assert.equal(iso(r.startAt), "2027-12-04T18:30:00.000Z");
  });

  it("numeric dates follow the order and flag the ambiguity", () => {
    const dmy = resolveWhen(when({ date_text: "5/12" }), ctx({ dateOrder: "DMY" }));
    assert.equal(iso(dmy.startAt), "2026-12-04T18:30:00.000Z");
    assert.equal(dmy.penalty, PENALTY.AMBIGUOUS_NUMERIC);

    // MDY reads May 12, which is already behind, so it rolls to 2027.
    const mdy = resolveWhen(when({ date_text: "5/12" }), ctx({ dateOrder: "MDY" }));
    assert.equal(iso(mdy.startAt).slice(0, 4), "2027");
    assert.equal(mdy.penalty, PENALTY.AMBIGUOUS_NUMERIC + PENALTY.ROLLED_OVER);
  });

  it("an unambiguous numeric date carries no penalty", () => {
    assert.equal(resolveWhen(when({ date_text: "25/12" }), ctx()).penalty, 0);
  });

  it("impossible dates are invalid, not silently corrected", () => {
    assert.equal(resolveWhen(when({ day: 31, month: 2 }), ctx()).status, "invalid");
    assert.equal(resolveWhen(when({ date_text: "31/02" }), ctx()).status, "invalid");
    assert.equal(resolveWhen(when({ date_text: "garbage" }), ctx()).status, "invalid");
  });

  it("a leap day is real only in a leap year", () => {
    assert.equal(resolveWhen(when({ day: 29, month: 2, year: 2028 }), ctx()).status, "resolved");
    assert.equal(resolveWhen(when({ day: 29, month: 2, year: 2027 }), ctx()).status, "invalid");
  });
});

describe("resolveWhen: nothing to resolve, and the past", () => {
  it("no date said (even with a time) is 'none'", () => {
    assert.equal(resolveWhen(when({}), ctx()).status, "none");
    assert.equal(resolveWhen(when({ time: "14:00" }), ctx()).status, "none");
    assert.equal(resolveWhen(null, ctx()).status, "none");
  });

  it("a deadline already over is 'past' (an old history message)", () => {
    const r = resolveWhen(when({ day: 1, month: 11, year: 2026 }), ctx());
    assert.equal(r.status, "past");
  });

  it("anything within the last day is still current", () => {
    const r = resolveWhen(when({ relative: "today", time: "09:00" }), ctx());
    assert.equal(r.status, "resolved");
  });

  it("an old message's relative date is resolved against when it was SENT", () => {
    const sent = new Date("2026-09-01T10:00:00Z"); // "tomorrow" = Sep 2, long past
    const r = resolveWhen(when({ relative: "tomorrow" }), ctx({ sentAt: sent, now: new Date("2026-11-18T10:00:00Z") }));
    assert.equal(r.status, "past");
  });
});

describe("resolveWhen: zones and DST", () => {
  it("falls back to UTC for an invalid zone instead of throwing", () => {
    const r = resolveWhen(when({ relative: "tomorrow", time: "10:00" }), ctx({ timeZone: "Not/AZone" }));
    assert.equal(iso(r.startAt), "2026-11-19T10:00:00.000Z");
  });

  it("an all-day entry on a DST-change day is 23 hours long, not 24", () => {
    const sent = new Date("2026-03-07T15:00:00Z"); // Sat in New York
    const r = resolveWhen(
      when({ relative: "tomorrow" }),
      ctx({ sentAt: sent, now: sent, timeZone: "America/New_York" }),
    );
    assert.equal(iso(r.startAt), "2026-03-08T05:00:00.000Z"); // 00:00 EST
    assert.equal(iso(r.endAt), "2026-03-09T04:00:00.000Z"); // 00:00 EDT
    assert.equal((r.endAt - r.startAt) / 3_600_000, 23);
  });

  it("a timed entry after the change uses the new offset", () => {
    const sent = new Date("2026-03-07T15:00:00Z");
    const r = resolveWhen(
      when({ relative: "tomorrow", time: "09:00" }),
      ctx({ sentAt: sent, now: sent, timeZone: "America/New_York" }),
    );
    assert.equal(iso(r.startAt), "2026-03-08T13:00:00.000Z"); // EDT
  });
});
