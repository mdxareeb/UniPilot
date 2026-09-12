import type { Metadata } from "next";
import { requireUnfinishedOnboarding } from "@/lib/onboarding/gate";
import { OnboardingFlow } from "./_components/OnboardingFlow";

export const metadata: Metadata = {
  title: "Set up your workspace",
  description: "Set up your UniPilot workspace.",
};

export default async function OnboardingPage() {
  // Session gate + the other half of 13.10's redirect rule: a student who
  // already completed setup is sent to the dashboard, so this route can never
  // re-run a finished flow. The proxy gates this path too, but Server
  // Functions bypass its matcher.
  await requireUnfinishedOnboarding();

  return <OnboardingFlow />;
}
