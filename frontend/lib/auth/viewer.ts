import { cache } from "react";
import { sessionFirstName } from "./displayName";
import { sessionUser } from "./session";

/**
 * What a page or a piece of chrome is allowed to know about whoever is looking
 * at the workspace. Deliberately not the Supabase `User`: an id, an email and a
 * bag of provider metadata are things to guard, not things to render.
 */
export type SessionViewer = {
  /**
   * True only for a session Supabase verified. An outage or missing credentials
   * resolves to false — the guest state is the safe render, and every gated
   * route still runs its own `requireUser`.
   */
  signedIn: boolean;
  /**
   * Provider-supplied given name. Absent for every email/password account,
   * which is why the no-name case is the one each caller must render well.
   */
  name?: string;
};

/**
 * Who is looking at the workspace, read once per request.
 *
 * `/dashboard` renders from this, and so do the rail, the mobile drawer and the
 * plan panel — four places in one tree that need the same answer. It composes
 * over `sessionUser`, the request-scoped session read, so this and every other
 * server consumer (14.10's affordances included) share one `getUser()` round
 * trip rather than each paying for their own.
 *
 * `sessionUser` rather than `requireUser` on purpose. This is what a public
 * page and its chrome read, so it must never throw and never redirect: absent is
 * a state to render, not a failure. `requireUser` remains the gate on /tasks,
 * /calendar, /documents, /assistant and /onboarding.
 */
export const sessionViewer = cache(async (): Promise<SessionViewer> => {
  const { user } = await sessionUser();

  return user
    ? { signedIn: true, name: sessionFirstName(user) }
    : { signedIn: false };
});
