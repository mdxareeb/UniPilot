"use client";

import type { OnboardingField } from "./onboardingData";

/**
 * One labelled group of mutually exclusive choices, with its inline error.
 *
 * Radios rather than a dropdown: each group offers three short options that the
 * reader wants to weigh against each other, and a dropdown hides two of the
 * three behind a tap. Native `<input type="radio">` inside a `<fieldset>` keeps
 * arrow-key selection, the "1 of 3" announcement and the group's name for free —
 * the visible box is a sibling `<span>` the checked input styles through `peer`.
 */
export function ChoiceField({
  field,
  legend,
  options,
  value,
  error,
  onChange,
}: {
  field: OnboardingField;
  /** Names the group. A `<legend>` here is what a `<label>` is to one input. */
  legend: string;
  options: readonly string[];
  value: string;
  error?: string;
  onChange: (field: OnboardingField, value: string) => void;
}) {
  const errorId = `${field}-error`;

  return (
    // Browsers give a fieldset its own border and padding; the reset is the one
    // /login and /signup already use.
    <fieldset className="min-w-0 border-0 p-0">
      <legend className="mb-1.5 text-label-sm font-medium text-foreground">
        {legend}
      </legend>

      {/* Stacked on a phone, one row once there is space. `flex-1` rather than a
          column count so the row divides evenly however many options there are. */}
      <div className="flex flex-col gap-2 sm:flex-row">
        {options.map((option) => (
          <label key={option} className="min-w-0 sm:flex-1">
            <input
              type="radio"
              name={field}
              value={option}
              checked={value === option}
              // Points at the error from whichever option has focus. No
              // `aria-invalid`: a radio has no such state — the group would need
              // an explicit `radiogroup` role to carry one, and the error is
              // already announced by its `role="alert"`.
              aria-describedby={error ? errorId : undefined}
              onChange={() => onChange(field, option)}
              // Reachable and announced, but drawn by the span below: styling a
              // native radio away is what breaks its keyboard behaviour.
              className="peer sr-only"
            />
            <span className="flex h-11 cursor-pointer items-center justify-center rounded-base border border-border bg-card px-3 text-center text-label-sm text-foreground press-feedback hover:border-foreground hover:bg-muted peer-checked:border-foreground peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background">
              {option}
            </span>
          </label>
        ))}
      </div>

      {error ? (
        <p
          id={errorId}
          role="alert"
          className="mt-1.5 text-label-sm text-destructive"
        >
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
