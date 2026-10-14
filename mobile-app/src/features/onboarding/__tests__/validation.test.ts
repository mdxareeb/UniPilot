/**
 * The onboarding validator mirror: the same accept/reject rules as the web
 * payload parser, driven through the shared vocabulary module.
 */
import {
  addSubject,
  parseOnboardingDraft,
  ONBOARDING_MAX_SUBJECTS,
} from "@/features/onboarding/validation";

const draft = {
  firstName: "QA",
  lastName: "One",
  institution: "UniPilot Test University",
  courseProgram: "Computer Science",
  academicYear: "Year 2",
  semester: "Semester 1",
  planningStyle: "Balanced",
  reminderLead: "1 week before",
  subjects: ["Linear Algebra", "Thermodynamics"],
};

describe("parseOnboardingDraft", () => {
  it("maps labels to the schema's codes", () => {
    const parsed = parseOnboardingDraft(draft);
    expect(parsed).not.toBeNull();
    expect(parsed).toMatchObject({
      firstName: "QA",
      lastName: "One",
      academicYear: 2,
      semester: 1,
      planningStyle: "balanced",
      reminderLead: "1_week",
      subjects: ["Linear Algebra", "Thermodynamics"],
    });
  });

  it("trims text fields", () => {
    const parsed = parseOnboardingDraft({ ...draft, firstName: "  QA  " });
    expect(parsed?.firstName).toBe("QA");
  });

  it("rejects missing required answers", () => {
    expect(parseOnboardingDraft({ ...draft, lastName: "" })).toBeNull();
    expect(parseOnboardingDraft({ ...draft, institution: "   " })).toBeNull();
  });

  it("rejects a label outside the schema's vocabulary", () => {
    expect(
      parseOnboardingDraft({ ...draft, planningStyle: "Chaotic" }),
    ).toBeNull();
    expect(parseOnboardingDraft({ ...draft, academicYear: "Year 9" })).toBeNull();
  });

  it("collapses case-insensitive subject repeats, first spelling wins", () => {
    const parsed = parseOnboardingDraft({
      ...draft,
      subjects: ["Physics", " physics ", "PHYSICS", "Maths"],
    });
    expect(parsed?.subjects).toEqual(["Physics", "Maths"]);
  });

  it("rejects blank subjects and more than the cap", () => {
    expect(parseOnboardingDraft({ ...draft, subjects: ["  "] })).toBeNull();
    expect(
      parseOnboardingDraft({
        ...draft,
        subjects: Array.from({ length: ONBOARDING_MAX_SUBJECTS + 1 }, (_, i) => `S${i}`),
      }),
    ).toBeNull();
  });
});

describe("addSubject", () => {
  it("adds a trimmed unique name", () => {
    expect(addSubject(["Physics"], "  Maths  ")).toEqual(["Physics", "Maths"]);
  });

  it("treats a case-insensitive repeat as a no-op", () => {
    expect(addSubject(["Physics"], "physics")).toEqual(["Physics"]);
  });

  it("rejects a blank name", () => {
    expect(addSubject([], "   ")).toBeNull();
  });

  it("rejects a name past the length cap", () => {
    expect(addSubject([], "x".repeat(201))).toBeNull();
  });
});
