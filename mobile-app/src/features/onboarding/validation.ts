/**
 * Onboarding validation (M2b) — the SAME rules as the web flow.
 *
 * The vocabulary (labels ↔ schema codes for academic year, semester, planning
 * style, reminder lead) is imported READ-ONLY from the web workspace's
 * `frontend/lib/data/onboardingValues.ts`, so a label can only change in one
 * place. The generic rules (required trimmed text ≤500, subject ≤200,
 * case-insensitive de-duplication, ≤100 subjects) mirror
 * `frontend/lib/data/onboarding.ts`'s `parseOnboardingPayload` exactly; that
 * module is server-coupled (React `cache` + the Next cookie client), so it
 * cannot be imported into the app, and this file is the recorded mirror of its
 * rule set. The `complete_onboarding` RPC re-normalizes server-side and the
 * schema CHECKs are the final layer, so a drift here can never store junk.
 */
import {
  academicYearValue,
  planningStyleValue,
  reminderLeadValue,
  semesterValue,
  type AcademicYear,
  type PlanningStyle,
  type ReminderLead,
  type Semester,
} from "../../../../frontend/lib/data/onboardingValues";

export const ONBOARDING_MAX_TEXT_LENGTH = 500;
export const ONBOARDING_MAX_SUBJECT_LENGTH = 200;
export const ONBOARDING_MAX_SUBJECTS = 100;

/** What the form collects: display strings, exactly like the web payload. */
export type OnboardingDraft = {
  firstName: string;
  lastName: string;
  institution: string;
  courseProgram: string;
  academicYear: string;
  semester: string;
  planningStyle: string;
  reminderLead: string;
  subjects: string[];
};

/** The validated, mapped payload — the RPC's argument shape. */
export type CompleteOnboardingInput = {
  firstName: string;
  lastName: string;
  institution: string;
  courseProgram: string;
  academicYear: AcademicYear;
  semester: Semester;
  planningStyle: PlanningStyle;
  reminderLead: ReminderLead;
  subjects: string[];
};

function readText(value: unknown, maxLength = ONBOARDING_MAX_TEXT_LENGTH): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) return null;
  return trimmed;
}

function readLabel(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** The one subject-add rule, shared by the form and this validator. */
export function normalizeSubjectName(value: string): string | null {
  const name = readText(value, ONBOARDING_MAX_SUBJECT_LENGTH);
  return name;
}

/** Case-insensitive de-duplication, first spelling wins (the web rule). */
export function addSubject(
  subjects: readonly string[],
  candidate: string,
): string[] | null {
  const name = normalizeSubjectName(candidate);
  if (name === null) return null;
  if (subjects.length >= ONBOARDING_MAX_SUBJECTS) return null;
  const exists = subjects.some(
    (subject) => subject.toLowerCase() === name.toLowerCase(),
  );
  if (exists) return [...subjects];
  return [...subjects, name];
}

function readSubjects(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > ONBOARDING_MAX_SUBJECTS) return null;
  const names: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    const name = readText(candidate, ONBOARDING_MAX_SUBJECT_LENGTH);
    if (name === null) return null;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

/** Validate an untrusted draft; null rejects (nothing is written). */
export function parseOnboardingDraft(
  input: unknown,
): CompleteOnboardingInput | null {
  if (typeof input !== "object" || input === null) return null;
  const record = input as Record<string, unknown>;

  const firstName = readText(record.firstName);
  const lastName = readText(record.lastName);
  const institution = readText(record.institution);
  const courseProgram = readText(record.courseProgram);
  if (
    firstName === null ||
    lastName === null ||
    institution === null ||
    courseProgram === null
  ) {
    return null;
  }

  const academicYear = academicYearValue(readLabel(record.academicYear));
  const semester = semesterValue(readLabel(record.semester));
  const planningStyle = planningStyleValue(readLabel(record.planningStyle));
  const reminderLead = reminderLeadValue(readLabel(record.reminderLead));
  if (
    academicYear === undefined ||
    semester === undefined ||
    planningStyle === undefined ||
    reminderLead === undefined
  ) {
    return null;
  }

  const subjects = readSubjects(record.subjects);
  if (subjects === null) return null;

  return {
    firstName,
    lastName,
    institution,
    courseProgram,
    academicYear,
    semester,
    planningStyle,
    reminderLead,
    subjects,
  };
}
