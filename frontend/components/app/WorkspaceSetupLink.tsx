import { sessionNeedsSetup } from "@/lib/onboarding/gate";
import { WorkspaceAction } from "./WorkspaceAction";

/** The onboarding flow, reachable from inside the workspace. */
const SETUP_PATH = "/onboarding";

/**
 * The way back into onboarding — now completion-aware (Task 14.10).
 *
 * Onboarding is optional at signup (Task 14.1.1): email signup, the
 * confirmation link and the Google roundtrip all land on `/dashboard`, and
 * 13.9's Skip leaves the flow for the same place. Since 13.10 there is a
 * persisted completion marker (`profiles.onboarding_completed_at`), and this
 * component is its first reader: it renders the link only for a signed-in
 * student whose setup is unfinished, and returns null for a completed student
 * and for a guest (a guest has `GuestCallout` / the profile menu instead).
 *
 * The condition itself lives in `sessionNeedsSetup` — one check shared with
 * `FinishSetupAffordance`, so the rail, the drawer and the dashboard banner
 * can never disagree. The read streams behind a `Suspense` boundary at both
 * call sites; the fallback is nothing, because the link's own presence is the
 * answer and a placeholder would be a flash of a state we do not know yet.
 *
 * `WorkspaceAction`, the project's quiet arrow link, because this is a
 * secondary offer beside the five routes — not a sixth place to go, and not
 * something that should compete with them for attention.
 */
export async function WorkspaceSetupLink() {
  if (!(await sessionNeedsSetup())) return null;

  return (
    <WorkspaceAction href={SETUP_PATH}>Set up your workspace</WorkspaceAction>
  );
}
