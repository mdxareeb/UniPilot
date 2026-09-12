"use client";

import { TextField } from "./TextField";
import {
  validateRequired,
  type OnboardingData,
  type StepFieldsProps,
} from "./onboardingData";

/**
 * The institution step's field.
 *
 * One question, one control — no grid to place a single input in. The label is a
 * single word because the heading has already asked where the reader studies and
 * the placeholder says what to type.
 */
export function InstitutionStep({
  value,
  errors,
  onChange,
  onCommit,
}: StepFieldsProps) {
  return (
    <TextField
      field="institution"
      label="Institution"
      autoComplete="organization"
      placeholder="College or university name"
      value={value.institution}
      error={errors.institution}
      onChange={onChange}
      onCommit={onCommit}
    />
  );
}

export function validateInstitution(data: OnboardingData) {
  return validateRequired(data, [
    { field: "institution", message: "Enter your college or university." },
  ]);
}
