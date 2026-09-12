"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ONBOARDING_SAVE_ERROR } from "@/lib/auth/errors";
import { completeOnboardingAction } from "@/lib/data/onboardingActions";
import { CourseStep, validateCourse } from "./CourseStep";
import { InstitutionStep, validateInstitution } from "./InstitutionStep";
import { OnboardingShell } from "./OnboardingShell";
import { PreferencesStep, validatePreferences } from "./PreferencesStep";
import { ProfileStep, validateProfile } from "./ProfileStep";
import { SemesterStep, validateSemester } from "./SemesterStep";
import { SubjectsStep } from "./SubjectsStep";
import {
  INITIAL_ONBOARDING_DATA,
  hasErrors,
  type OnboardingData,
  type OnboardingErrors,
  type OnboardingField,
  type StepFields,
  type StepValidator,
} from "./onboardingData";

type OnboardingStep = {
  /** The task that owns this step. */
  task: string;
  eyebrow: string;
  title: string;
  description: string;
  Fields: StepFields;
  /**
   * Omitted when the step has nothing to check. The subjects step is the only
   * one: every answer on it is optional, so there is no state Continue can
   * refuse.
   */
  validate?: StepValidator;
};

/**
 * The onboarding sequence: the collection steps from Tasks 13.2-13.7. Task 13.8
 * (first dashboard state) is what onboarding produces afterwards rather than a
 * question the student answers, so it is not a step here.
 *
 * Adding or removing an entry is all the progress indicator needs to stay
 * correct.
 */
const steps: OnboardingStep[] = [
  {
    task: "13.2",
    eyebrow: "Your profile",
    title: "What should we call you?",
    description:
      "UniPilot uses your name to address you across your workspace.",
    Fields: ProfileStep,
    validate: validateProfile,
  },
  {
    task: "13.3",
    eyebrow: "Your institution",
    title: "Where do you study?",
    description:
      "Tell us your college or university so UniPilot can tailor your workspace.",
    Fields: InstitutionStep,
    validate: validateInstitution,
  },
  {
    task: "13.4",
    eyebrow: "Your program",
    title: "What are you studying?",
    description:
      "Tell us your course or program so your UniPilot workspace is more relevant to your studies.",
    Fields: CourseStep,
    validate: validateCourse,
  },
  {
    task: "13.5",
    eyebrow: "Your semester",
    title: "Where are you in your studies?",
    description:
      "Tell us your current year and semester so UniPilot can better organize your academic workspace.",
    Fields: SemesterStep,
    validate: validateSemester,
  },
  {
    task: "13.6",
    eyebrow: "Your preferences",
    title: "How do you like to work?",
    description:
      "Choose the preferences that will help UniPilot tailor your academic workspace.",
    Fields: PreferencesStep,
    validate: validatePreferences,
  },
  {
    task: "13.7",
    eyebrow: "Your subjects",
    title: "What are you studying this term?",
    description:
      "Add the subjects you want to start with. You can change them later.",
    Fields: SubjectsStep,
  },
];

/**
 * Holds what onboarding has collected so far and which step is on screen.
 *
 * Local `useState` is enough: nothing outside this subtree reads it, so no
 * context and no store. The state lives here rather than in the steps because
 * the shell's Continue button is a sibling of the step content, not a child of
 * it — and because the step is remounted on every change (see `OnboardingShell`),
 * so an answer would be lost if it were held any lower. Going back and forward
 * therefore leaves earlier answers intact.
 *
 * Continue on the last step persists the answers through the
 * `completeOnboardingAction` Server Action (Task 13.10) and only then navigates
 * to `/dashboard` (Task 13.8's first dashboard state). If the save fails, the
 * flow stays put, shows the sanitized error, and can be submitted again — the
 * completion marker is written by the same atomic call, so a failure never
 * claims the setup was finished.
 *
 * Skip (Task 13.9) reaches the dashboard without answering the rest and writes
 * nothing: no value is guessed, no step is counted as done, and
 * `onboarding_completed_at` stays NULL, which is what keeps the student
 * eligible for the redirect gate's journey back into this flow.
 */
export function OnboardingFlow() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [data, setData] = useState<OnboardingData>(INITIAL_ONBOARDING_DATA);
  const [errors, setErrors] = useState<OnboardingErrors>({});
  const [leaving, setLeaving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const pushed = useRef(false);

  /** The save is in flight, or the route change is. No action may run twice. */
  const busy = saving || leaving;

  // Clamped so `steps[step - 1]` is always in range, even if two presses land in
  // the same React batch. There is no state past the last step: Continue there
  // leaves onboarding rather than advancing it.
  const goBack = () => setStep((s) => Math.max(s - 1, 1));
  const goNext = () => setStep((s) => Math.min(s + 1, steps.length));

  /**
   * Leaves onboarding for the workspace, however it was left.
   *
   * The route change is not instant and the shell stays on screen while it is in
   * flight, so a second press would push a second history entry. The ref (set by
   * the callers, before any await) guards the push itself — state set in the same
   * batch would not be visible yet — and `leaving` is what takes the buttons out
   * of service.
   */
  function leave() {
    setLeaving(true);
    router.push("/dashboard");
  }

  /**
   * Onboarding answered through to the end: persist, then leave.
   *
   * The write is the point of this step, so the navigation waits for it. A
   * failed save clears the in-flight guard and shows the sanitized error instead
   * of leaving, which keeps the retry on the last step with every answer still
   * in place. The action itself is idempotent server-side, so the guard here is
   * only about not firing the request twice.
   */
  async function finish() {
    if (pushed.current || busy) return;
    pushed.current = true;
    setSaving(true);
    setSaveError(undefined);

    let error: string | null;
    try {
      ({ error } = await completeOnboardingAction(data));
    } catch {
      // The action returns sanitized copy for every failure it can catch; this
      // is the transport-level fallback, never raw error text.
      error = ONBOARDING_SAVE_ERROR;
    }

    setSaving(false);

    if (error !== null) {
      pushed.current = false;
      setSaveError(error);
      return;
    }

    leave();
  }

  /**
   * Onboarding left before the end: nothing is written.
   *
   * Deliberately not `finish`: skip does not persist the answers reached so
   * far (TASK.md 13.10 — either decision is acceptable, and writing nothing
   * keeps this flow's only write atomic and completion-bearing), so
   * `onboarding_completed_at` stays NULL and the redirect gate will bring the
   * student back here if they open a gated route.
   */
  function skip() {
    if (pushed.current || busy) return;
    pushed.current = true;
    leave();
  }

  function updateField(field: OnboardingField, value: string) {
    setData((prev) => ({ ...prev, [field]: value }));
    // Drop a field's error as soon as the reader starts fixing it. Continue
    // re-validates, so nothing invalid can slip past.
    setErrors((prev) =>
      prev[field] === undefined ? prev : { ...prev, [field]: undefined },
    );
  }

  /**
   * The subjects list, replaced whole. It carries no error of its own: the step
   * refuses an empty or repeated subject at the point of adding it, so nothing
   * invalid ever reaches here.
   */
  function updateSubjects(subjects: string[]) {
    setData((prev) => ({ ...prev, subjects }));
  }

  const current = steps[step - 1];
  const isLastStep = step === steps.length;

  /**
   * What a step does once it has nothing left to object to: show the next
   * question, or — on the last one — hand over to the workspace.
   */
  function advance() {
    if (isLastStep) {
      finish();
      return;
    }
    goNext();
  }

  function commit(validate: StepValidator) {
    const { value, errors: found } = validate(data);

    if (hasErrors(found)) {
      setErrors(found);
      return;
    }

    // Store the trimmed answers, so going back shows what was actually kept.
    setData((prev) => ({ ...prev, ...value }));
    setErrors({});
    advance();
  }

  /**
   * What Continue does, and what Enter inside a field does.
   *
   * A plain handler rather than something built during render: it reads the
   * navigation guard in `leave`, and a function that touches a ref must not be
   * called while rendering.
   */
  function submit() {
    const { validate } = current;
    // A step with nothing to check has nothing for Continue to validate, so it
    // simply advances.
    if (validate === undefined) {
      advance();
      return;
    }
    commit(validate);
  }

  return (
    <OnboardingShell
      step={step}
      totalSteps={steps.length}
      eyebrow={current.eyebrow}
      title={current.title}
      description={current.description}
      // Every action goes out of service while the save or the navigation is in
      // flight: an omitted handler is how the shell renders Back and Continue
      // inert, and a Back press mid-flight would race a change it cannot cancel.
      onBack={step === 1 || busy ? undefined : goBack}
      onNext={busy ? undefined : submit}
      // Offered from the second step on. Step one asks for the name the workspace
      // addresses the student by, and a way out of the very first question reads
      // as an invitation to take it. On the last step Skip and Continue both reach
      // the dashboard today, but they are not the same act — see `skip` — so the
      // offer stays there too rather than disappearing on the one step where the
      // difference is about to start mattering.
      onSkip={step === 1 ? undefined : skip}
      // Inert rather than gone for the length of the push, so the card does not
      // change height on the way out.
      skipDisabled={busy}
      nextLabel={
        saving
          ? "Saving your setup…"
          : leaving
            ? "Opening your workspace…"
            : undefined
      }
      // The action's sanitized failure copy, announced as an alert. It shows
      // only after a real write attempt failed, and the retry is the same
      // Continue button it sits above.
      error={saveError}
    >
      <current.Fields
        value={data}
        errors={errors}
        onChange={updateField}
        onSubjectsChange={updateSubjects}
        onCommit={submit}
      />
    </OnboardingShell>
  );
}
