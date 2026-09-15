"use client";

import { Select } from "@/components/ui/Select";
import type { OnboardingField } from "./onboardingData";

/**
 * One labelled dropdown with its inline error — `TextField`'s arrangement for
 * the steps that ask the reader to choose rather than type.
 *
 * There is no Enter handler here, unlike `TextField`. The open dropdown owns
 * Enter: in a browser that renders the option list in-page, intercepting the key
 * would confirm a choice and advance the step in the same press.
 */
export function SelectField({
  field,
  label,
  placeholder,
  options,
  value,
  error,
  onChange,
}: {
  field: OnboardingField;
  label: string;
  /** The empty option: what the control reads as before a choice is made. */
  placeholder: string;
  options: readonly string[];
  value: string;
  error?: string;
  onChange: (field: OnboardingField, value: string) => void;
}) {
  const errorId = `${field}-error`;

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={field}
        className="text-label-sm font-medium text-foreground"
      >
        {label}
      </label>
      <Select
        id={field}
        name={field}
        required
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        options={[
          { value: "", label: placeholder },
          ...options.map((option) => ({ value: option, label: option })),
        ]}
        onChange={(next) => onChange(field, next)}
      />
      {error ? (
        <p id={errorId} role="alert" className="text-label-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
