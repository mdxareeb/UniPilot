import { AUTH_COPY } from "@/auth/authErrors";
import { supabase } from "@/lib/supabase";
import type { CompleteOnboardingInput } from "./validation";

export const ONBOARDING_COPY = {
  INVALID: "Check the answers and try again.",
  SAVE_FAILED: "Couldn't save your setup. Try again.",
  SUBJECT_INVALID:
    "A subject needs a name (max 200 characters) and can't be repeated.",
} as const;

/**
 * Persist the finished setup through the SAME Postgres function the web uses
 * (`complete_onboarding`, security invoker): profile answers + subject
 * replacement + the one-time completion stamp, atomically. RLS scopes every
 * write to the authenticated caller; the RPC re-normalizes and the schema
 * CHECKs reject anything this layer misses.
 */
export async function completeOnboarding(
  input: CompleteOnboardingInput,
): Promise<{ error: string | null }> {
  if (supabase === null) return { error: AUTH_COPY.UNCONFIGURED };

  const { error } = await supabase.rpc("complete_onboarding", {
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

  if (error) return { error: ONBOARDING_COPY.SAVE_FAILED };
  return { error: null };
}
