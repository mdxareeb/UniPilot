"use server";

/**
 * The onboarding Server Action (Task 13.10), the repo pattern of
 * `lib/auth/actions.ts`: session gate first, sanitized result out, never a raw
 * database or provider message.
 *
 * The client sends the flow's answers; the server re-validates and re-maps
 * them (`parseOnboardingPayload`) before the data layer writes, so a crafted
 * request cannot skip a required answer, smuggle a label the schema does not
 * know, or reach another student's row. `completeOnboarding` is atomic, so a
 * failure leaves the profile untouched and `onboarding_completed_at` NULL.
 *
 * `requireUser` runs outside the try block on purpose: its redirect throws
 * (Next's control-flow signal) and must propagate, not be folded into the
 * sanitized save error.
 */
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { ONBOARDING_SAVE_ERROR } from "@/lib/auth/errors";
import { completeOnboarding, parseOnboardingPayload } from "./onboarding";
import type { OnboardingPayload } from "./onboarding";

export type CompleteOnboardingActionResult = {
  error: string | null;
};

export async function completeOnboardingAction(
  payload: OnboardingPayload,
): Promise<CompleteOnboardingActionResult> {
  await requireUser("/onboarding");

  try {
    const answers = parseOnboardingPayload(payload);
    if (answers === null) {
      return { error: ONBOARDING_SAVE_ERROR };
    }
    await completeOnboarding(answers);
  } catch {
    return { error: ONBOARDING_SAVE_ERROR };
  }

  // The dashboard renders this student's profile and subjects. Drop its cached
  // render so the navigation that follows cannot show the pre-setup state.
  revalidatePath("/dashboard");

  return { error: null };
}
