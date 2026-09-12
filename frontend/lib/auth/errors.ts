/**
 * Single source of user-facing authentication copy.
 *
 * Every message the auth UI can show lives here, so a raw Supabase/provider
 * error, stack trace, or token is never rendered, and the same failure always
 * reads the same way on every surface.
 *
 * Deliberately free of `@supabase/supabase-js` imports so client components can
 * use these strings without pulling the SDK into the browser bundle. The
 * `AuthError` mapping that needs the SDK stays server-side in
 * `lib/auth/actions.ts` and imports its copy from here.
 */

export const GENERIC_ERROR = "Something went wrong. Please try again.";
export const INVALID_CREDENTIALS = "Invalid email or password.";
export const NOT_CONFIGURED =
  "Authentication is not configured yet. Please try again later.";
export const SIGN_OUT_ERROR = "Could not sign you out. Please try again.";
export const CREDENTIALS_REQUIRED = "Email and password are required.";
export const EMAIL_REQUIRED = "Email is required.";
export const INVALID_EMAIL = "Enter a valid email address.";
export const PASSWORD_TOO_SHORT = "Password must be at least 8 characters.";
export const PASSWORD_MISMATCH = "Passwords do not match.";
export const EMAIL_ALREADY_REGISTERED =
  "An account with this email already exists.";
export const PASSWORD_POLICY = "Password does not meet the required policy.";
export const RATE_LIMITED =
  "Too many attempts. Please wait a moment and try again.";
export const OAUTH_FAILED =
  "Google sign-in could not be completed. Please try again.";
export const VERIFICATION_LINK_INVALID =
  "That verification link is invalid or has expired. Sign in to request a new one.";
export const SESSION_EXPIRED = "Your session has expired. Please sign in again.";
export const ONBOARDING_SAVE_ERROR =
  "We couldn't save your setup. Please try again.";

/** Query parameter carrying a sanitized failure code to /login. */
export const AUTH_NOTICE_PARAM = "error";

/**
 * Failure codes that may appear as `?error=` on /login. Codes are opaque labels,
 * never provider text, so nothing sensitive travels in the URL or browser history.
 */
export const AUTH_NOTICE = {
  oauth: "oauth",
  verification: "verification",
  session: "session",
} as const;

export type AuthNoticeCode = (typeof AUTH_NOTICE)[keyof typeof AUTH_NOTICE];

const NOTICE_MESSAGES: Record<AuthNoticeCode, string> = {
  [AUTH_NOTICE.oauth]: OAUTH_FAILED,
  [AUTH_NOTICE.verification]: VERIFICATION_LINK_INVALID,
  [AUTH_NOTICE.session]: SESSION_EXPIRED,
};

/**
 * Maps a `?error=` code to display copy.
 *
 * Unknown or repeated values resolve to `null` rather than being echoed back, so
 * a crafted query string cannot inject arbitrary text into the page.
 */
export function authNoticeMessage(
  code: string | string[] | undefined,
): string | null {
  if (typeof code !== "string") return null;
  return NOTICE_MESSAGES[code as AuthNoticeCode] ?? null;
}
