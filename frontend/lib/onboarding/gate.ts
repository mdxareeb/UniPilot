/**
 * The onboarding redirect gate (Task 13.10) and the guest-aware workspace gate.
 *
 * Composes the existing session gate with the persisted completion marker:
 * a signed-in student who has not completed onboarding is sent into the flow
 * before they can use the workspace; a student who has completed it and opens
 * `/onboarding` is sent to the dashboard instead. Both directions read the
 * same row, so the two rules cannot disagree and no redirect loop exists:
 *
 *   /tasks (incomplete)   → /onboarding (renders: completion is NULL)
 *   /onboarding (complete) → /dashboard (guest-viewable: no gate re-runs)
 *
 * `/dashboard`, `/tasks`, `/calendar`, `/documents` and `/assistant` are
 * guest-viewable (TASK.md 0.17, extended to the workspace routes): a visitor
 * without a session is a state to render — real UI, honest empty states, no
 * data read — never a redirect. Using a surface is what opens the skippable
 * sign-in prompt, and the Server Actions keep `requireOnboardedUser` as the
 * hard server-side fallback. `/onboarding` itself calls
 * `requireUnfinishedOnboarding`, which is what makes a completed student's
 * visit loop-free.
 */
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { requireUser, sessionUser } from "@/lib/auth/session";
import { getOnboardingState } from "@/lib/data/onboarding";

export const ONBOARDING_PATH = "/onboarding";

/** Where a student who already completed onboarding belongs. */
export const WORKSPACE_PATH = "/dashboard";

/**
 * Session + completion gate for mutating Server Actions. Mirrors `requireUser`:
 * `intendedPath` is the action's own path for the `?next=` roundtrip through
 * /login, and a read that cannot be made throws rather than guessing a verdict.
 *
 * The pages no longer call this — they use `getWorkspaceAccess`, which lets a
 * guest render. This is the hard fallback behind every task write (21.x), so a
 * visitor who never signs in cannot use an action as a side door around the
 * prompt.
 */
export async function requireOnboardedUser(intendedPath: string): Promise<User> {
  const user = await requireUser(intendedPath);

  const { completed } = await getOnboardingState(user.id);
  if (!completed) {
    redirect(ONBOARDING_PATH);
  }

  return user;
}

/**
 * The guest-aware gate for the workspace pages (TASK.md 0.17 extended to the
 * workspace routes).
 *
 * Three outcomes, one read each:
 * - no session → `null`, the guest state: the page renders its real shell with
 *   empty states and no data service call. A guest is never redirected;
 * - signed in, onboarding incomplete → `/onboarding`, exactly the 13.10 rule;
 * - signed in, onboarding complete → the user, and the page loads real data
 *   as it always has.
 *
 * Unlike `requireUser` there is no `intendedPath`/`?next=` here: a guest is
 * not being sent to /login, so there is no destination to carry. The sign-in
 * prompt builds its own `/login?next=` from the current path when the guest
 * chooses to sign in.
 *
 * A session read that cannot be made (`sessionUser().unavailable`) resolves to
 * the guest state, the same fail-safe render `/dashboard` has always used — it
 * never throws, and no guard is weakened because the Server Actions still run
 * `requireOnboardedUser` before touching data.
 */
export async function getWorkspaceAccess(): Promise<User | null> {
  const { user } = await sessionUser();
  if (!user) return null;

  const { completed } = await getOnboardingState(user.id);
  if (!completed) {
    redirect(ONBOARDING_PATH);
  }

  return user;
}

/**
 * The `/onboarding` page's own gate: any signed-in student may reach the flow,
 * but one who already finished is sent to the dashboard rather than shown a
 * setup they cannot complete again.
 */
export async function requireUnfinishedOnboarding(): Promise<User> {
  const user = await requireUser(ONBOARDING_PATH);

  const { completed } = await getOnboardingState(user.id);
  if (completed) {
    redirect(WORKSPACE_PATH);
  }

  return user;
}

/**
 * Whether the signed-in student still has setup to finish — the visibility
 * condition shared by every 14.10 affordance (`WorkspaceSetupLink`,
 * `FinishSetupAffordance`), so the offer can never disagree between surfaces.
 *
 * The one place the condition is written. False for a guest, false once the
 * marker is set, and false when the state cannot be read: an affordance is an
 * offer, not a gate, so a Supabase outage hides the offer and never strips the
 * page or throws (unlike `requireOnboardedUser`, which must know).
 *
 * `sessionUser` is the same request-scoped read `sessionViewer` composes over,
 * so calling this does not add an auth round trip to the surfaces that already
 * read the session.
 */
export async function sessionNeedsSetup(): Promise<boolean> {
  const { user } = await sessionUser();
  if (!user) return false;

  try {
    const { completed } = await getOnboardingState(user.id);
    return !completed;
  } catch {
    return false;
  }
}
