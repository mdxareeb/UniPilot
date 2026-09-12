/**
 * The single source for onboarding's UI strings and their schema values.
 *
 * The flow asks in display strings ("Year 3", "Semester 2", "Steady",
 * "1 week before"); the ratified schema stores codes (`academic_year`
 * smallint 1–5, `semester` smallint 1–2, `planning_style` `steady`/`balanced`/
 * `deadline_driven`, `reminder_lead` `1_day`/`3_days`/`1_week`). The steps and
 * the data layer both read this module, so a label can only change in one
 * place and the two directions can never drift apart.
 *
 * Deliberately free of server imports: the onboarding steps are client
 * components and import the option labels, while `lib/data/onboarding.ts`
 * imports the same maps for validation and persistence. Pure data only — no
 * database access here.
 */

/** Year one through five: see `SemesterStep` for why the range is this one. */
export const ACADEMIC_YEAR_OPTIONS = [
  { label: "Year 1", value: 1 },
  { label: "Year 2", value: 2 },
  { label: "Year 3", value: 3 },
  { label: "Year 4", value: 4 },
  { label: "Year 5", value: 5 },
] as const;

export type AcademicYear = (typeof ACADEMIC_YEAR_OPTIONS)[number]["value"];

export const SEMESTER_OPTIONS = [
  { label: "Semester 1", value: 1 },
  { label: "Semester 2", value: 2 },
] as const;

export type Semester = (typeof SEMESTER_OPTIONS)[number]["value"];

export const PLANNING_STYLE_OPTIONS = [
  { label: "Steady", value: "steady" },
  { label: "Balanced", value: "balanced" },
  { label: "Deadline-driven", value: "deadline_driven" },
] as const;

export type PlanningStyle = (typeof PLANNING_STYLE_OPTIONS)[number]["value"];

export const REMINDER_LEAD_OPTIONS = [
  { label: "1 day before", value: "1_day" },
  { label: "3 days before", value: "3_days" },
  { label: "1 week before", value: "1_week" },
] as const;

export type ReminderLead = (typeof REMINDER_LEAD_OPTIONS)[number]["value"];

function labels<T extends { label: string }>(options: readonly T[]) {
  return options.map((option) => option.label);
}

function valueOf<T extends { label: string; value: unknown }>(
  options: readonly T[],
  label: string,
): T["value"] | undefined {
  const option = options.find((candidate) => candidate.label === label);
  return option?.value;
}

function labelOf<T extends { label: string; value: unknown }>(
  options: readonly T[],
  value: unknown,
): string | undefined {
  if (value === null || value === undefined) return undefined;
  const option = options.find((candidate) => candidate.value === value);
  return option?.label;
}

export const ACADEMIC_YEAR_LABELS: readonly string[] =
  labels(ACADEMIC_YEAR_OPTIONS);
export const SEMESTER_LABELS: readonly string[] = labels(SEMESTER_OPTIONS);
export const PLANNING_STYLE_LABELS: readonly string[] =
  labels(PLANNING_STYLE_OPTIONS);
export const REMINDER_LEAD_LABELS: readonly string[] =
  labels(REMINDER_LEAD_OPTIONS);

export function academicYearValue(label: string): AcademicYear | undefined {
  return valueOf(ACADEMIC_YEAR_OPTIONS, label) as AcademicYear | undefined;
}

export function academicYearLabel(
  value: number | null | undefined,
): string | undefined {
  return labelOf(ACADEMIC_YEAR_OPTIONS, value);
}

export function semesterValue(label: string): Semester | undefined {
  return valueOf(SEMESTER_OPTIONS, label) as Semester | undefined;
}

export function semesterLabel(value: number | null | undefined): string | undefined {
  return labelOf(SEMESTER_OPTIONS, value);
}

export function planningStyleValue(label: string): PlanningStyle | undefined {
  return valueOf(PLANNING_STYLE_OPTIONS, label) as PlanningStyle | undefined;
}

export function planningStyleLabel(
  value: string | null | undefined,
): string | undefined {
  return labelOf(PLANNING_STYLE_OPTIONS, value);
}

export function reminderLeadValue(label: string): ReminderLead | undefined {
  return valueOf(REMINDER_LEAD_OPTIONS, label) as ReminderLead | undefined;
}

export function reminderLeadLabel(
  value: string | null | undefined,
): string | undefined {
  return labelOf(REMINDER_LEAD_OPTIONS, value);
}
