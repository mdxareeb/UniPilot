import { PageHeading } from "@/components/PageHeading";
import { Screen } from "@/components/Screen";
import { OnboardingForm } from "@/features/onboarding/OnboardingForm";

/**
 * Native onboarding (M2b) — signed-in only; the shell gate sends an unfinished
 * account here and a finished one away. The form persists through the existing
 * `complete_onboarding` RPC (see the M2b record).
 */
export default function OnboardingScreen() {
  return (
    <Screen>
      <PageHeading
        eyebrow="Setup"
        title="Your setup"
        description="Tell UniPilot about your studies so it can plan around them."
      />
      <OnboardingForm />
    </Screen>
  );
}
