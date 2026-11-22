import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_AUTO_APPROVE_THRESHOLD, itemRef, pickDocumentSubject, planItems, readThreshold } from "../plan.mjs";
import { extraction, item, SUBJECTS, when } from "./memoryRepo.mjs";

const SENT = new Date("2026-11-18T10:00:00Z"); // Wednesday, 15:30 IST
const ctx = (over = {}) => ({
  sentAt: SENT,
  timeZone: "Asia/Kolkata",
  dateOrder: "DMY",
  now: SENT,
  threshold: 0.85,
  subjects: SUBJECTS,
  messageText: "CS301 assignment 3 due Friday",
  rawFingerprint: "a".repeat(64),
  ...over,
});
const plan = (items, over) => planItems(extraction(items), ctx(over));

describe("planItems routing", () => {
  it("auto-adds a confident, dated, sorted item", () => {
    const [p] = plan([item()]);
    assert.equal(p.action, "auto");
    assert.equal(p.reason, "confident");
    assert.equal(p.kind, "task");
    assert.equal(p.subjectId, "sub-ds");
  });

  it("maps types to the right table and event type", () => {
    const types = ["assignment", "quiz", "exam", "lab", "event"];
    const plans = plan(types.map((type) => item({ type, title: `t-${type}`, when: when({ day: 5, month: 12 }) })));
    assert.deepEqual(plans.map((p) => p.kind), ["task", "task", "event", "event", "event"]);
    assert.deepEqual(plans.map((p) => p.eventType), [null, null, "exam", "class", null]);
  });

  it("the threshold boundary: >= goes in, just below is reviewed", () => {
    assert.equal(plan([item({ confidence: 0.85 })])[0].action, "auto");
    assert.equal(plan([item({ confidence: 0.849 })])[0].action, "review");
    assert.equal(plan([item({ confidence: 0.849 })])[0].reason, "low_confidence");
  });

  it("the threshold is configurable per call", () => {
    assert.equal(plan([item({ confidence: 0.7 })], { threshold: 0.6 })[0].action, "auto");
    assert.equal(plan([item({ confidence: 0.99 })], { threshold: 1 })[0].action, "review");
  });

  it("date guesses lower the score: 'next friday' (-0.1) and a same-weekday read (-0.15)", () => {
    const next = plan([item({ when: when({ weekday: "friday", week_ref: "next" }), confidence: 0.9 })])[0];
    assert.equal(next.confidence, 0.8);
    assert.equal(next.action, "review");
    const same = plan([item({ when: when({ weekday: "wednesday" }), confidence: 0.95 })])[0];
    assert.equal(same.confidence, 0.8);
  });

  it("a numeric date uses the group's order and the ambiguity costs 0.1", () => {
    const dmy = plan([item({ when: when({ date_text: "5/12" }), confidence: 0.99 })], { dateOrder: "DMY" })[0];
    assert.equal(dmy.startAt.toISOString(), "2026-12-04T18:30:00.000Z");
    assert.equal(dmy.confidence, 0.89);
    assert.equal(dmy.action, "auto");
    const mdy = plan([item({ when: when({ date_text: "5/12" }), confidence: 0.99 })], { dateOrder: "MDY" })[0];
    assert.equal(mdy.startAt.getUTCFullYear(), 2027);
    assert.equal(mdy.action, "review", "May 12 already passed: rolled a year and penalised");
  });

  it("an ambiguous subject is reviewed, never guessed", () => {
    const twins = [
      { id: "a", name: "Physics", course_code: null, aliases: [] },
      { id: "b", name: "Physics Lab", course_code: null, aliases: [] },
    ];
    const p = plan([item({ course_hint: "physics", confidence: 0.99 })], { subjects: twins, messageText: "physics" })[0];
    assert.equal(p.action, "review");
    assert.equal(p.reason, "ambiguous_subject");
    assert.equal(p.subjectId, null);
  });

  it("a proposed new subject is always reviewed, however confident", () => {
    const p = plan(
      [item({ course_hint: null, proposed_subject_name: "Computer Networks", confidence: 1 })],
      { messageText: "Networks assignment due Friday" },
    )[0];
    assert.equal(p.action, "review");
    assert.equal(p.reason, "new_subject");
    assert.equal(p.proposedSubjectName, "Computer Networks");
  });

  it("a proposal that contradicts a course code in the message is reviewed, not guessed", () => {
    const p = plan([item({ course_hint: null, proposed_subject_name: "Computer Networks", confidence: 1 })])[0];
    assert.equal(p.action, "review");
    assert.equal(p.reason, "ambiguous_subject");
    assert.equal(p.subjectId, null);
  });

  it("an undated task is reviewed; an undated event is dropped", () => {
    const task = plan([item({ when: when(), confidence: 1 })])[0];
    assert.equal(task.action, "review");
    assert.equal(task.reason, "undated");
    assert.equal(task.startAt, null);
    assert.equal(plan([item({ type: "exam", when: when() })])[0].reason, "no_date");
  });

  it("an item that is already past is dropped", () => {
    const p = plan([item({ when: when({ day: 1, month: 11, year: 2026 }) })])[0];
    assert.deepEqual([p.action, p.reason], ["skip", "past"]);
  });

  it("an impossible date on a task is treated as undated, on an event it is dropped", () => {
    assert.equal(plan([item({ when: when({ day: 31, month: 2 }) })])[0].reason, "undated");
    assert.equal(plan([item({ type: "exam", when: when({ day: 31, month: 2 }) })])[0].reason, "no_date");
  });

  it("scores never leave 0..1", () => {
    const low = plan([item({ when: when({ weekday: "wednesday" }), confidence: 0.05 })])[0];
    assert.equal(low.confidence, 0);
  });
});

describe("itemRef (the idempotency key)", () => {
  const base = { rawFingerprint: "a".repeat(64), type: "assignment", title: "Assignment 3", startAt: new Date("2026-11-20T00:00:00Z") };

  it("is stable, prefixed wg-, and 32 hex long", () => {
    assert.match(itemRef(base), /^wg-[0-9a-f]{32}$/);
    assert.equal(itemRef(base), itemRef({ ...base }));
  });

  it("ignores cosmetic title differences but not real ones", () => {
    assert.equal(itemRef(base), itemRef({ ...base, title: "  assignment   3 " }));
    assert.notEqual(itemRef(base), itemRef({ ...base, title: "Assignment 4" }));
    assert.notEqual(itemRef(base), itemRef({ ...base, startAt: new Date("2026-11-21T00:00:00Z") }));
    assert.notEqual(itemRef(base), itemRef({ ...base, rawFingerprint: "b".repeat(64) }));
    assert.notEqual(itemRef(base), itemRef({ ...base, startAt: null }));
  });
});

describe("readThreshold", () => {
  it("defaults to 0.85 and accepts a valid override", () => {
    assert.equal(DEFAULT_AUTO_APPROVE_THRESHOLD, 0.85);
    assert.equal(readThreshold({}), 0.85);
    assert.equal(readThreshold({ WHATSAPP_AUTO_APPROVE_THRESHOLD: "0.9" }), 0.9);
  });

  it("ignores nonsense instead of silently approving everything", () => {
    for (const bad of ["0", "-1", "2", "abc", ""]) {
      assert.equal(readThreshold({ WHATSAPP_AUTO_APPROVE_THRESHOLD: bad }), 0.85, bad);
    }
  });
});

describe("pickDocumentSubject", () => {
  it("prefers the most common subject among the items", () => {
    const plans = [{ subjectId: "sub-os" }, { subjectId: "sub-ds" }, { subjectId: "sub-os" }];
    assert.equal(pickDocumentSubject({ plans, fileName: "x.pdf", caption: "", textHead: "", subjects: SUBJECTS }), "sub-os");
  });

  it("falls back to a course code in the name, caption or opening text", () => {
    const pick = (over) => pickDocumentSubject({ plans: [], fileName: "", caption: "", textHead: "", subjects: SUBJECTS, ...over });
    assert.equal(pick({ fileName: "CS305_lecture2.pdf" }), "sub-os");
    assert.equal(pick({ caption: "notes for cs 301" }), "sub-ds");
    assert.equal(pick({ textHead: "CS301 Data Structures - Week 3" }), "sub-ds");
  });

  it("then a name match on the file name, and otherwise leaves it unsorted", () => {
    const pick = (over) => pickDocumentSubject({ plans: [], fileName: "", caption: "", textHead: "", subjects: SUBJECTS, ...over });
    assert.equal(pick({ fileName: "operating systems notes.pdf" }), "sub-os");
    assert.equal(pick({ fileName: "scan0042.pdf" }), null);
  });
});
