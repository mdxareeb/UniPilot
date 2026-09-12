"use client";

import { TextField } from "./TextField";
import {
  validateRequired,
  type OnboardingData,
  type StepFieldsProps,
} from "./onboardingData";

/**
 * The name step's fields.
 *
 * Presentational. The values, the errors and the decision to advance all live in
 * `OnboardingFlow`, because Continue sits in the shell's footer rather than here.
 */
export function ProfileStep({
  value,
  errors,
  onChange,
  onCommit,
}: StepFieldsProps) {
  return (
    // Side by side once there is room, because the two fields are one answer —
    // a name — rather than two separate questions. `items-start` keeps both
    // labels on the same line when only one field carries an error.
    <div className="grid grid-cols-1 items-start gap-3.5 sm:grid-cols-2">
      <TextField
        field="firstName"
        label="First name"
        autoComplete="given-name"
        value={value.firstName}
        error={errors.firstName}
        onChange={onChange}
        onCommit={onCommit}
      />
      <TextField
        field="lastName"
        label="Last name"
        autoComplete="family-name"
        value={value.lastName}
        error={errors.lastName}
        onChange={onChange}
        onCommit={onCommit}
      />
    </div>
  );
}

export function validateProfile(data: OnboardingData) {
  return validateRequired(data, [
    { field: "firstName", message: "Enter your first name." },
    { field: "lastName", message: "Enter your last name." },
  ]);
}
