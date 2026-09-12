"use client";

import type { KeyboardEvent } from "react";
import { Input } from "@/components/ui/Input";
import type { OnboardingField } from "./onboardingData";

/**
 * One labelled text input with its inline error — the arrangement `/login` and
 * `/signup` already use, shared by the onboarding steps that ask for text.
 */
export function TextField({
  field,
  label,
  autoComplete,
  placeholder,
  value,
  error,
  onChange,
  onCommit,
}: {
  field: OnboardingField;
  label: string;
  autoComplete:
    | "given-name"
    | "family-name"
    | "organization"
    // The nearest standard token for a course title. Browsers treat it as "job
    // title within an organization", so a saved value may be a poor suggestion,
    // but an unrecognised token would be ignored outright.
    | "organization-title";
  placeholder?: string;
  value: string;
  error?: string;
  onChange: (field: OnboardingField, value: string) => void;
  /** Runs on Enter, the same validation Continue does. */
  onCommit: () => void;
}) {
  const errorId = `${field}-error`;

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    // These inputs are deliberately not wrapped in a <form>: Continue lives in
    // the shell's footer, outside the step, so there is no submit button to pair
    // with one. Enter therefore runs the same validate-then-advance path as
    // Continue — an incomplete step shows its error instead of advancing.
    event.preventDefault();
    onCommit();
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={field}
        className="text-label-sm font-medium text-foreground"
      >
        {label}
      </label>
      <Input
        id={field}
        name={field}
        type="text"
        autoComplete={autoComplete}
        // Names, colleges and course titles are all proper nouns: capitalise
        // them on a phone keyboard, and keep the spellchecker from underlining
        // them.
        autoCapitalize="words"
        spellCheck={false}
        required
        placeholder={placeholder}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => onChange(field, event.target.value)}
        onKeyDown={onKeyDown}
      />
      {error ? (
        // `role="alert"` matches how /login and /signup announce a validation
        // failure. Without it, pressing Continue with an empty field would be
        // silent for a screen reader — the message appears but nothing says so.
        <p id={errorId} role="alert" className="text-label-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
