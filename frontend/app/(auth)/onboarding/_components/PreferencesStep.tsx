"use client";

import {
  PLANNING_STYLE_LABELS,
  REMINDER_LEAD_LABELS,
} from "@/lib/data/onboardingValues";
import { ChoiceField } from "./ChoiceField";
import {
  validateRequired,
  type OnboardingData,
  type StepFieldsProps,
} from "./onboardingData";

/**
 * The option labels come from `lib/data/onboardingValues.ts`, the single source
 * the data layer also maps back to `profiles.planning_style` /
 * `profiles.reminder_lead` — so the radios and the persistence can never
 * disagree.
 *
 * Planning style is the answer the workload signals need. "Steady" reads a week
 * of even effort as healthy; "Deadline-driven" expects the work to bunch up near
 * the due date and should only raise a flag when it bunches past what the week
 * can hold. Guessing it wrongly makes the same workload look calm to one student
 * and alarming to another, which is why it is the one required answer here.
 *
 * Reminder lead is how much notice a deadline should give before it arrives.
 */

/**
 * The preferences step's fields.
 *
 * Two questions, not a questionnaire: how you like to work, and how much warning
 * you want. Both are answers UniPilot has somewhere to put — the first shapes how
 * upcoming work is weighed, the second how early a deadline is surfaced. Anything
 * else worth asking is a setting the student can change later once they have seen
 * the workspace, and a preference with nowhere to go is a question not worth a
 * step of someone's time.
 *
 * The groups are stacked rather than side by side: each is a row of three, and two
 * rows of three across one 520px card would leave every option too narrow to read.
 */
export function PreferencesStep({ value, errors, onChange }: StepFieldsProps) {
  return (
    <div className="flex flex-col gap-3.5">
      <ChoiceField
        field="planningStyle"
        legend="How do you like to plan?"
        options={PLANNING_STYLE_LABELS}
        value={value.planningStyle}
        error={errors.planningStyle}
        onChange={onChange}
      />
      <ChoiceField
        field="reminderLead"
        legend="When should deadlines remind you?"
        options={REMINDER_LEAD_LABELS}
        value={value.reminderLead}
        error={errors.reminderLead}
        onChange={onChange}
      />
    </div>
  );
}

/**
 * Only the planning style is checked. The reminder lead starts on "3 days
 * before" (see `INITIAL_ONBOARDING_DATA`), so there is always a sensible answer and
 * nothing to block Continue with — a student who does not care keeps the default
 * and moves on.
 */
export function validatePreferences(data: OnboardingData) {
  return validateRequired(data, [
    { field: "planningStyle", message: "Choose how you like to plan." },
  ]);
}
