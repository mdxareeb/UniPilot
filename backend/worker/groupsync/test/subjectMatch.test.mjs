import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compact, matchSubject, norm, resolveSubject } from "../subjectMatch.mjs";

const SUBJECTS = [
  { id: "ds", name: "Data Structures", course_code: "CS301", aliases: ["DSA", "algo"] },
  { id: "os", name: "Operating Systems", course_code: "CS305", aliases: [] },
  { id: "ma", name: "Linear Algebra", course_code: null, aliases: ["LA"] },
];

describe("normalisation", () => {
  it("lower-cases, strips accents/punctuation and joins codes", () => {
    assert.equal(norm("  Données-Structures! "), "donnees structures");
    assert.equal(compact("CS 301"), "cs301");
    assert.equal(compact("cs-301"), "cs301");
  });
});

describe("matchSubject", () => {
  it("matches by course code in any common spelling", () => {
    for (const hint of ["CS301", "cs 301", "CS-301", "the cs301 lab"]) {
      assert.deepEqual(matchSubject([hint], SUBJECTS), { subjectId: "ds", method: "code", ambiguous: false }, hint);
    }
  });

  it("does not match a code hidden inside a longer word", () => {
    assert.equal(matchSubject(["xcs3010y"], SUBJECTS).subjectId, null);
  });

  it("matches by alias, case-insensitively and as a whole word", () => {
    assert.equal(matchSubject(["dsa assignment"], SUBJECTS).subjectId, "ds");
    assert.equal(matchSubject(["Algo"], SUBJECTS).method, "alias");
    assert.equal(matchSubject(["la quiz"], SUBJECTS).subjectId, "ma");
    assert.equal(matchSubject(["balance"], SUBJECTS).subjectId, null, "'la' inside a word is not an alias hit");
  });

  it("matches by name, in either direction", () => {
    assert.equal(matchSubject(["Operating Systems"], SUBJECTS).subjectId, "os");
    assert.equal(matchSubject(["operating systems midterm"], SUBJECTS).subjectId, "os");
    assert.equal(matchSubject(["Linear"], SUBJECTS).subjectId, "ma");
  });

  it("prefers a code over a name", () => {
    const r = matchSubject(["CS305 operating systems"], SUBJECTS);
    assert.deepEqual(r, { subjectId: "os", method: "code", ambiguous: false });
  });

  it("refuses to guess between two subjects", () => {
    const twins = [
      { id: "a", name: "Physics", course_code: null, aliases: ["phy"] },
      { id: "b", name: "Physics Lab", course_code: null, aliases: [] },
    ];
    const r = matchSubject(["physics"], twins);
    assert.equal(r.subjectId, null);
    assert.equal(r.ambiguous, true);
  });

  it("returns nothing for an empty list or empty hints", () => {
    assert.deepEqual(matchSubject(["CS301"], []), { subjectId: null, method: null, ambiguous: false });
    assert.equal(matchSubject([null, "", "   "], SUBJECTS).subjectId, null);
  });

  it("tries each text in priority order", () => {
    assert.equal(matchSubject(["???", "tomorrow", "Operating Systems"], SUBJECTS).subjectId, "os");
  });
});

describe("resolveSubject", () => {
  const base = { hint: null, proposed: null, title: "", evidence: "", messageText: "" };

  it("uses the model's hint", () => {
    const r = resolveSubject({ ...base, hint: "DSA" }, SUBJECTS);
    assert.equal(r.subjectId, "ds");
  });

  it("falls back to a course code written anywhere in the message", () => {
    const r = resolveSubject({ ...base, messageText: "Reminder: CS305 lab report due Friday" }, SUBJECTS);
    assert.equal(r.subjectId, "os");
  });

  it("does not treat a course NAME in passing prose as a match", () => {
    const r = resolveSubject({ ...base, messageText: "after linear algebra let's get food, lab report due" }, SUBJECTS);
    assert.equal(r.subjectId, null);
    assert.equal(r.proposedName, null);
  });

  it("a proposal that is really an existing subject becomes that subject", () => {
    const r = resolveSubject({ ...base, proposed: "Operating Systems (Sem 5)" }, SUBJECTS);
    assert.equal(r.subjectId, "os");
    assert.equal(r.proposedName, null);
  });

  it("a genuinely new course is proposed, never created", () => {
    const r = resolveSubject({ ...base, proposed: "Computer Networks" }, SUBJECTS);
    assert.deepEqual([r.subjectId, r.proposedName], [null, "Computer Networks"]);
  });

  it("no information is simply unsorted", () => {
    const r = resolveSubject(base, SUBJECTS);
    assert.deepEqual([r.subjectId, r.proposedName, r.ambiguous], [null, null, false]);
  });

  it("an ambiguous hint stays ambiguous and proposes nothing", () => {
    const twins = [
      { id: "a", name: "Physics", course_code: null, aliases: [] },
      { id: "b", name: "Physics Lab", course_code: null, aliases: [] },
    ];
    const r = resolveSubject({ ...base, hint: "physics", proposed: "Quantum" }, twins);
    assert.equal(r.ambiguous, true);
    assert.equal(r.subjectId, null);
    assert.equal(r.proposedName, null);
  });
});
