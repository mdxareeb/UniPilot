import {
  ALL_SCOPE,
  relativeTimestamp,
  resolveInitialScope,
  sameScope,
  scopeChipLabel,
  scopeFromSession,
  scopeKindLabel,
  scopeStillValid,
  scopeToSessionInput,
  scopeToStored,
  sessionScopeLabel,
  type ScopeDocument,
  type ScopeSubject,
} from "../scope";

const subjects: ScopeSubject[] = [
  { id: "s1", name: "Organic Chemistry" },
  { id: "s2", name: "Operating Systems" },
];
const documents: ScopeDocument[] = [
  { id: "d1", name: "OS M2.docx" },
  { id: "d2", name: "Week 3 notes.pdf" },
];

describe("resolveInitialScope", () => {
  it("always starts at All Materials in all mode", () => {
    expect(
      resolveInitialScope("all", { kind: "subject", id: "s1" }, subjects, documents),
    ).toEqual(ALL_SCOPE);
  });

  it("resumes a stored subject in last mode", () => {
    expect(
      resolveInitialScope("last", { kind: "subject", id: "s1" }, subjects, documents),
    ).toEqual({ kind: "subject", id: "s1", name: "Organic Chemistry" });
  });

  it("resumes a stored document in last mode", () => {
    expect(
      resolveInitialScope("last", { kind: "document", id: "d1" }, subjects, documents),
    ).toEqual({ kind: "document", id: "d1", name: "OS M2.docx" });
  });

  it("falls back to All Materials when the stored row is gone", () => {
    expect(
      resolveInitialScope("last", { kind: "subject", id: "missing" }, subjects, documents),
    ).toEqual(ALL_SCOPE);
    expect(
      resolveInitialScope("last", { kind: "document", id: "missing" }, subjects, documents),
    ).toEqual(ALL_SCOPE);
    expect(resolveInitialScope("last", null, subjects, documents)).toEqual(ALL_SCOPE);
  });
});

describe("scope transitions", () => {
  it("compares by kind and id, not by label", () => {
    expect(
      sameScope(
        { kind: "document", id: "d1", name: "old" },
        { kind: "document", id: "d1", name: "new" },
      ),
    ).toBe(true);
    expect(
      sameScope(
        { kind: "subject", id: "s1", name: "same" },
        { kind: "document", id: "s1", name: "same" },
      ),
    ).toBe(false);
    expect(sameScope(ALL_SCOPE, { kind: "all" })).toBe(true);
  });

  it("maps a scope to the session body and back to storage", () => {
    expect(scopeToSessionInput(ALL_SCOPE)).toEqual({});
    expect(
      scopeToSessionInput({ kind: "subject", id: "s1", name: "Chem" }),
    ).toEqual({ subjectId: "s1" });
    expect(
      scopeToSessionInput({ kind: "document", id: "d1", name: "Notes" }),
    ).toEqual({ documentId: "d1" });

    expect(scopeToStored(ALL_SCOPE)).toBeNull();
    expect(scopeToStored({ kind: "subject", id: "s1", name: "Chem" })).toEqual({
      kind: "subject",
      id: "s1",
    });
    expect(scopeToStored({ kind: "document", id: "d1", name: "Notes" })).toEqual({
      kind: "document",
      id: "d1",
    });
  });

  it("resolves a session scope and falls back when the row is missing", () => {
    expect(
      scopeFromSession({ scopeSubjectId: "s1", scopeDocumentId: null }, subjects, documents),
    ).toEqual({ kind: "subject", id: "s1", name: "Organic Chemistry" });
    expect(
      scopeFromSession({ scopeSubjectId: null, scopeDocumentId: "d2" }, subjects, documents),
    ).toEqual({ kind: "document", id: "d2", name: "Week 3 notes.pdf" });
    expect(
      scopeFromSession({ scopeSubjectId: "missing", scopeDocumentId: null }, subjects, documents),
    ).toEqual(ALL_SCOPE);
  });

  it("keeps a scope only while its row exists", () => {
    expect(
      scopeStillValid(
        { kind: "subject", id: "s1", name: "Organic Chemistry" },
        subjects,
        documents,
      ),
    ).toBe(true);
    expect(
      scopeStillValid(
        { kind: "document", id: "gone", name: "Gone" },
        subjects,
        documents,
      ),
    ).toBe(false);
    expect(scopeStillValid(ALL_SCOPE, subjects, documents)).toBe(true);
  });

  it("bounds the chip label without losing the full name elsewhere", () => {
    expect(scopeChipLabel(ALL_SCOPE)).toBe("All Materials");
    expect(
      scopeChipLabel({
        kind: "document",
        id: "d1",
        name: "A very long operating systems lecture note",
      }),
    ).toBe("A very long operating s…");
  });
});

describe("history labels", () => {
  it("labels the scope kind and the resolved name", () => {
    expect(
      scopeKindLabel({ scopeSubjectId: null, scopeDocumentId: null }),
    ).toBe("All materials");
    expect(
      scopeKindLabel({ scopeSubjectId: "s1", scopeDocumentId: null }),
    ).toBe("Subject");
    expect(
      sessionScopeLabel(
        { scopeSubjectId: "s1", scopeDocumentId: null },
        subjects,
        documents,
      ),
    ).toBe("Organic Chemistry");
    expect(
      sessionScopeLabel(
        { scopeSubjectId: null, scopeDocumentId: null },
        subjects,
        documents,
      ),
    ).toBe("All materials");
    expect(
      sessionScopeLabel(
        { scopeSubjectId: "missing", scopeDocumentId: null },
        subjects,
        documents,
      ),
    ).toBe("Subject no longer available");
    expect(
      sessionScopeLabel(
        { scopeSubjectId: null, scopeDocumentId: "missing" },
        subjects,
        documents,
      ),
    ).toBe("Document no longer available");
  });

  it("renders a relative timestamp that never goes negative", () => {
    const now = Date.parse("2026-11-23T12:00:00.000Z");
    expect(relativeTimestamp("2026-11-23T11:59:30.000Z", now)).toBe("Just now");
    expect(relativeTimestamp("2026-11-23T11:55:00.000Z", now)).toBe("5m ago");
    expect(relativeTimestamp("2026-11-23T09:00:00.000Z", now)).toBe("3h ago");
    expect(relativeTimestamp("2026-11-21T12:00:00.000Z", now)).toBe("2d ago");
    expect(relativeTimestamp("2026-11-01T12:00:00.000Z", now)).toBe("Nov 1");
    expect(relativeTimestamp("not-a-date", now)).toBe("Unknown time");
    expect(relativeTimestamp("2026-11-23T13:00:00.000Z", now)).toBe("Just now");
  });
});
