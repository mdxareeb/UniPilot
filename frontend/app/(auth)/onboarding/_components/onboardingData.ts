import type { ReactElement } from "react";

/**
 * The answers held as a single line of text — every step but the last.
 */
type OnboardingField =
  | "firstName"
  | "lastName"
  | "institution"
  | "courseProgram"
  | "academicYear"
  | "semester"
  | "planningStyle"
  | "reminderLead";

/**
 * Every answer onboarding collects, in one flat record.
 *
 * One shape rather than one per step. A step's answer outlives the step: the
 * name typed on step one is still needed when onboarding finishes, and the shell
 * remounts each step as it appears, so nothing can be held inside a step
 * component.
 *
 * `subjects` is the one answer that is a list rather than a line, which is why it
 * sits beside the record instead of inside it. It is optional and may stay empty.
 */
type OnboardingData = Record<OnboardingField, string> & {
  subjects: string[];
};

/** A message per field that failed. An absent key means the field is fine. */
type OnboardingErrors = Partial<Record<OnboardingField, string>>;

/**
 * What onboarding starts with.
 *
 * Every answer starts blank except the reminder lead, which starts on the middle
 * option. A deadline reminder has to fire at some point, so the choice is shown
 * pre-set rather than decided silently later — the student sees what they will get
 * and can change it in place.
 */
const INITIAL_ONBOARDING_DATA: OnboardingData = {
  firstName: "",
  lastName: "",
  institution: "",
  courseProgram: "",
  academicYear: "",
  semester: "",
  planningStyle: "",
  reminderLead: "3 days before",
  subjects: [],
};

type RequiredField = {
  field: OnboardingField;
  /** Shown under the field when it is left empty. */
  message: string;
};

type StepValidation = {
  /** The listed fields, trimmed. */
  value: Partial<OnboardingData>;
  errors: OnboardingErrors;
};

/**
 * Trims each listed field and reports the ones left empty.
 *
 * The trimmed values come back alongside the errors so the caller can store the
 * cleaned text in the same pass — an answer typed with a stray space is kept
 * without it. Emptiness is the only rule: a real name can be one letter,
 * hyphenated or non-Latin, and a college can be "UCL" or a sixty-character
 * title, so anything stricter would turn away real students.
 */
function validateRequired(
  data: OnboardingData,
  required: RequiredField[],
): StepValidation {
  const value: Partial<OnboardingData> = {};
  const errors: OnboardingErrors = {};

  for (const { field, message } of required) {
    const trimmed = data[field].trim();
    value[field] = trimmed;
    if (trimmed === "") errors[field] = message;
  }

  return { value, errors };
}

function hasErrors(errors: OnboardingErrors) {
  return Object.values(errors).some((message) => message !== undefined);
}

type StepFieldsProps = {
  value: OnboardingData;
  errors: OnboardingErrors;
  onChange: (field: OnboardingField, value: string) => void;
  /**
   * Replaces the whole subject list. Separate from `onChange` because that one
   * writes a line of text to a named field, and this writes a list — one handler
   * covering both would have to be typed loosely enough to accept either.
   */
  onSubjectsChange: (subjects: string[]) => void;
  /** Runs the same validation Continue does. */
  onCommit: () => void;
};

/**
 * A step's fields. Handed the whole record; each step reads the keys it owns.
 */
type StepFields = (props: StepFieldsProps) => ReactElement;

type StepValidator = (data: OnboardingData) => StepValidation;

export { INITIAL_ONBOARDING_DATA, hasErrors, validateRequired };
export type {
  OnboardingData,
  OnboardingErrors,
  OnboardingField,
  StepFields,
  StepFieldsProps,
  StepValidator,
};
