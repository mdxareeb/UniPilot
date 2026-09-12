/**
 * What the dashboard is able to say about the student. Every field optional.
 *
 * Deliberately not onboarding's `OnboardingData`: that type describes a form in
 * progress — each field a string that may still be empty — and it lives in the
 * private `_components` folder of an `(auth)` route. This one describes clean
 * facts that may simply be absent, which is what a page renders from.
 *
 * As of Task 13.10 the route fills this from the student's persisted onboarding
 * rows: `profiles` for every answer and `subjects` for the list. Each field is
 * still optional because each answer is optional until setup is completed — a
 * guest has none, and a skipped setup has none either. Nothing rendered from
 * this shape is inferred: if a field is set, the student persisted it, and if
 * it is absent the renderer must show the absence honestly.
 */
type DashboardStudent = {
  /** Already-clean given name, e.g. from the session's display name. */
  firstName?: string;
  institution?: string;
  courseProgram?: string;
  academicYear?: string;
  semester?: string;
  planningStyle?: string;
  reminderLead?: string;
  subjects?: string[];
};

/**
 * Whether an optional field has something worth rendering. A field that is
 * present but blank is the same as absent to a reader, and each section decides
 * to render from the count of what is left.
 */
function isPresent(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== "";
}

export { isPresent };
export type { DashboardStudent };
