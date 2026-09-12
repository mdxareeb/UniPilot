import { AUTH_NOTICE, AUTH_NOTICE_PARAM } from "./errors";

export const LOGIN_PATH = "/login";
export const SIGNUP_PATH = "/signup";
export const FORGOT_PASSWORD_PATH = "/forgot-password";

export const AUTH_CALLBACK_PATH = "/auth/callback";
export const AUTH_CONFIRM_PATH = "/auth/confirm";
export const POST_AUTH_REDIRECT = "/dashboard";
export const RESET_PASSWORD_PATH = "/reset-password";

/**
 * Failure destinations. Built from the codes in `lib/auth/errors.ts` so the
 * notice a user sees is always defined next to the code that triggers it.
 */
export const AUTH_ERROR_REDIRECT = `${LOGIN_PATH}?${AUTH_NOTICE_PARAM}=${AUTH_NOTICE.oauth}`;
export const VERIFICATION_ERROR_REDIRECT = `${LOGIN_PATH}?${AUTH_NOTICE_PARAM}=${AUTH_NOTICE.verification}`;

/** Query parameter carrying the intended destination through /login. */
export const REDIRECT_PARAM = "next";

/**
 * Routes that require a valid session, and so the only routes the proxy
 * redirects. Every route listed here also runs its own server guard.
 *
 * Only `/onboarding` remains protected. `/dashboard`, `/tasks`, `/calendar`,
 * `/documents` and `/assistant` are all guest-viewable: a visitor without a
 * session is shown the workspace's real UI with empty states there rather than
 * a login form, and any attempt to use a surface opens the skippable
 * `SignInPrompt` instead of redirecting. They read the session
 * (`lib/auth/viewer.ts` / `getWorkspaceAccess` in `lib/onboarding/gate.ts`)
 * instead of demanding one, and their Server Actions keep the hard
 * `requireOnboardedUser` gate as the fallback.
 *
 * All of them stay in the `matcher` in `proxy.ts` for session refresh, for the
 * reason documented there, which is why these two lists are not identical: the
 * matcher is a superset. Adding a *protected* route means adding it to both.
 */
export const PROTECTED_PREFIXES: readonly string[] = ["/onboarding"];

/** Auth routes that must stay reachable without a session. */
export const PUBLIC_AUTH_PATHS: readonly string[] = [
  LOGIN_PATH,
  SIGNUP_PATH,
  FORGOT_PASSWORD_PATH,
  AUTH_CALLBACK_PATH,
  AUTH_CONFIRM_PATH,
  RESET_PASSWORD_PATH,
];

/**
 * Auth routes an already-authenticated user is redirected away from.
 * `/auth/confirm` and `/auth/callback` are excluded: both are reached *with* a
 * fresh session and perform their own redirect.
 */
export const AUTHENTICATED_REDIRECT_PATHS: readonly string[] = [
  LOGIN_PATH,
  SIGNUP_PATH,
];
