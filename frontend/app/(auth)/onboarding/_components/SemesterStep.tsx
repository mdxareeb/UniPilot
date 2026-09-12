"use client";

import {
  ACADEMIC_YEAR_LABELS,
  SEMESTER_LABELS,
} from "@/lib/data/onboardingValues";
import { SelectField } from "./SelectField";
import {
  validateRequired,
  type OnboardingData,
  type StepFieldsProps,
} from "./onboardingData";

/**
 * The option labels come from `lib/data/onboardingValues.ts`, the single source
 * the data layer also maps back to `profiles.academic_year` / `profiles.semester`
 * — so the dropdown and the persistence can never disagree. Year one through
 * five: a three-year degree, a four-year B.Tech and a five-year integrated
 * program all land inside it.
 */

/**
 * The semester step's fields.
 *
 * Two dropdowns rather than two text inputs: both answers come from a short
 * fixed list, and a list the reader picks from cannot be misspelled. They share a
 * row on wider screens because year and semester are one answer — where you are
 * in your degree — the way first and last name are one answer on step one.
 */
export function SemesterStep({ value, errors, onChange }: StepFieldsProps) {
  return (
    <div className="grid grid-cols-1 items-start gap-3.5 sm:grid-cols-2">
      <SelectField
        field="academicYear"
        label="Academic year"
        placeholder="Select year"
        options={ACADEMIC_YEAR_LABELS}
        value={value.academicYear}
        error={errors.academicYear}
        onChange={onChange}
      />
      <SelectField
        field="semester"
        label="Semester"
        placeholder="Select semester"
        options={SEMESTER_LABELS}
        value={value.semester}
        error={errors.semester}
        onChange={onChange}
      />
    </div>
  );
}

export function validateSemester(data: OnboardingData) {
  return validateRequired(data, [
    { field: "academicYear", message: "Select your academic year." },
    { field: "semester", message: "Select your semester." },
  ]);
}
