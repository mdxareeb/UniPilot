import { cache } from "react";
import type { User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { LOGIN_PATH, REDIRECT_PARAM } from "./constants";
import { AUTH_NOTICE, AUTH_NOTICE_PARAM } from "./errors";
import { sanitizeRedirectPath } from "./redirects";

export type SessionState = {
  /** The authenticated user, or null for any non-authenticated outcome. */
  user: User | null;
  /**
   * True when no verdict was possible — Supabase is unconfigured or the auth
   * request failed — as opposed to a confirmed "no session". Both are treated as
   * unauthenticated; the flag only lets a caller explain itself differently.
   */
  unavailable: boolean;
};

/**
 * Reads the session server-side without redirecting.
 *
 * Never throws and never surfaces Supabase error text. `getUser()` validates the
 * token with Supabase Auth rather than trusting the cookie, so expired, revoked,
 * and tampered sessions all resolve to `user: null`.
 */
export async function getSessionUser(): Promise<SessionState> {
  if (!isSupabaseConfigured()) {
    return { user: null, unavailable: true };
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      return { user: null, unavailable: false };
    }
    return { user: data.user, unavailable: false };
  } catch {
    // Network/transport failure: fail closed rather than assume a session.
    return { user: null, unavailable: true };
  }
}

/**
 * The request-scoped session read.
 *
 * `getSessionUser` is the raw read; this is the same call memoized for one
 * render pass, so a page, the rail's chrome and the Task 14.10 affordances all
 * share one `getUser()` validation instead of each paying for its own. It has
 * the same contract — never throws, never redirects, absent is a state.
 *
 * Server-only by import: callers that hand anything to the client must still
 * narrow to what the client may know (`sessionViewer` is that boundary).
 */
export const sessionUser = cache(getSessionUser);

function loginRedirectPath(intendedPath: string, code: string): string {
  const params = new URLSearchParams();
  params.set(REDIRECT_PARAM, sanitizeRedirectPath(intendedPath));
  params.set(AUTH_NOTICE_PARAM, code);
  return `${LOGIN_PATH}?${params.toString()}`;
}

/**
 * Session gate for an authenticated page or Server Function.
 *
 * `proxy.ts` already redirects unauthenticated visitors, but Server Functions
 * POST to the route they are used on and therefore bypass the matcher — so this
 * is the defence-in-depth check every authenticated surface must run, with RLS as
 * the final layer at the database.
 *
 * `intendedPath` is passed explicitly because pages cannot read their own
 * pathname on the server; it is validated by `sanitizeRedirectPath` before being
 * placed in `?next=`, so a bad value degrades to the default destination instead
 * of becoming an open redirect. Reaching this redirect means the proxy did not
 * run or the session died in between, which is why it carries the `session`
 * notice — the ordinary unauthenticated visit is caught earlier by the proxy and
 * arrives at /login with no error code.
 *
 * `redirect()` throws (and defaults to `replace` outside Server Actions, so no
 * dead history entry is left behind), hence the `never` fallthrough.
 */
export async function requireUser(intendedPath: string): Promise<User> {
  const { user } = await getSessionUser();

  if (!user) {
    redirect(loginRedirectPath(intendedPath, AUTH_NOTICE.session));
  }

  return user;
}
