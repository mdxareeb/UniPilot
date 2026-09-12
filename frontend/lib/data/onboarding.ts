/**
 * Onboarding's server-side data layer (Task 13.10).
 *
 * The only module that reads or writes a student's onboarding rows. Pages,
 * guards and the Server Action go through it; no component queries a table.
 * Typed against the generated `Database` view of the local schema.
 *
 * Reads use the request-scoped Supabase client, so the authenticated cookie
 * identifies the caller and the owner-only RLS policies are the enforcement
 * layer. Writes go through the `complete_onboarding` Postgres function, which
 * upserts the profile, replaces the subject set and stamps
 * `onboarding_completed_at` in one transaction (see the migration); a failure
 * throws and nothing is surfaced beyond sanitized copy one layer up.
 */
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import {
  academicYearValue,
  planningStyleValue,
  reminderLeadValue,
  semesterValue,
  type AcademicYear,
  type PlanningStyle,
  type ReminderLead,
  type Semester,
} from "./onboardingValues";

export type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];

/** What a page or guard needs to know about a student's onboarding. */
export type OnboardingState = {
  /** The provisioned profile row, or null when it is missing (broken 1:1). */
  profile: ProfileRow | null;
  /** The student's subjects, alphabetically ordered. */
  subjects: string[];
  /** `onboarding_completed_at` is set. Never inferred from the answers. */
  completed: boolean;
};

/**
 * What the flow sends: every answer is still the UI string the student chose.
 * `parseOnboardingPayload` validates this shape and maps it to the schema's
 * values; nothing reaches the database as a display string.
 */
export type OnboardingPayload = {
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

/**
 * The validated, mapped payload the data layer writes. The action runs
 * `parseOnboardingPayload` before anything reaches the database.
 */
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

/**
 * Bounds for server-side validation. Deliberately generous compared with any
 * real answer: the point is to reject junk on a crafted request, not to police
 * the length of a course name.
 */
const MAX_TEXT_LENGTH = 500;
const MAX_SUBJECT_LENGTH = 200;
const MAX_SUBJECTS = 100;

function readText(value: unknown, maxLength = MAX_TEXT_LENGTH): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) return null;
  return trimmed;
}

function readLabel(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Subjects, normalized to the rule the UI enforces at the point of adding:
 * trimmed, blanks dropped, and case-insensitive repeats collapsed to their
 * first spelling. Returns null for a payload that is not a list of strings, so
 * the caller shows the sanitized failure rather than storing a subset.
 */
function readSubjects(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_SUBJECTS) return null;

  const names: string[] = [];
  const seen = new Set<string>();

  for (const candidate of value) {
    const name = readText(candidate, MAX_SUBJECT_LENGTH);
    if (name === null) return null;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }

  return names;
}

/**
 * Validates an untrusted payload and maps its display strings to the schema's
 * values. Null means "reject": the action answers with the sanitized save
 * error and writes nothing. This is where the UI-string ↔ schema-value
 * mapping happens — nowhere else, and never in a component.
 */
export function parseOnboardingPayload(
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

/**
 * Reads a student's profile and subjects in one pass. `userId` comes from a
 * verified session; RLS would return nothing for anyone else's id, so the
 * argument is a convenience for the owner's own row, not the guard.
 *
 * Memoized for one render pass: a page that already read the state (to build
 * the dashboard) and the Task 14.10 affordances that read it again share the
 * same two queries instead of repeating them. The memo ends with the request,
 * so a Server Action's write is never masked by a stale value on a later
 * request.
 *
 * A query failure throws rather than resolving to "incomplete": a guard that
 * treated an outage as "not onboarded" could bounce a finished student back
 * into setup, and no caller can honestly render a completion verdict it could
 * not read. Typed reads are the honest ones. (14.10's visibility helpers catch
 * it and render nothing, because an affordance is an offer, not a gate.)
 */
export const getOnboardingState = cache(
  async (userId: string): Promise<OnboardingState> => {
    const supabase = await createClient();

    const [profileResult, subjectsResult] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabase
        .from("subjects")
        .select("name")
        .eq("user_id", userId)
        .order("name", { ascending: true }),
    ]);

    if (profileResult.error || subjectsResult.error) {
      throw new Error("Failed to read onboarding state.");
    }

    const profile = profileResult.data;

    return {
      profile,
      subjects: (subjectsResult.data ?? []).map((row) => row.name),
      completed: profile?.onboarding_completed_at != null,
    };
  },
);

/**
 * Persists the finished flow through the atomic Postgres function. Returns the
 * completion timestamp the database settled on (unchanged on a repeated
 * submission, thanks to the `coalesce` in the function).
 *
 * Pass only an already-validated payload: callers run
 * `parseOnboardingPayload` first.
 */
export async function completeOnboarding(
  input: CompleteOnboardingInput,
): Promise<string> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("complete_onboarding", {
    p_first_name: input.firstName,
    p_last_name: input.lastName,
    p_institution: input.institution,
    p_course_program: input.courseProgram,
    p_academic_year: input.academicYear,
    p_semester: input.semester,
    p_planning_style: input.planningStyle,
    p_reminder_lead: input.reminderLead,
    p_subjects: input.subjects,
  });

  if (error) {
    throw new Error("Failed to complete onboarding.");
  }

  return data;
}
