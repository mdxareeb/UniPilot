"use client";

import { TextField } from "./TextField";
import {
  validateRequired,
  type OnboardingData,
  type StepFieldsProps,
} from "./onboardingData";

/**
 * The course step's field.
 *
 * One control, like the institution step. The label names both words students
 * use for the same thing — course and program — because which one reads as
 * natural depends on where they study.
 */
export function CourseStep({
  value,
  errors,
  onChange,
  onCommit,
}: StepFieldsProps) {
  return (
    <TextField
      field="courseProgram"
      label="Course / Program"
      autoComplete="organization-title"
      placeholder="e.g. B.Tech Information Science"
      value={value.courseProgram}
      error={errors.courseProgram}
      onChange={onChange}
      onCommit={onCommit}
    />
  );
}

export function validateCourse(data: OnboardingData) {
  return validateRequired(data, [
    { field: "courseProgram", message: "Enter your course or program." },
  ]);
}
