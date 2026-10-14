/**
 * The sanitized auth copy (M2). One source for every auth-adjacent failure,
 * mapped from the GoTrue error shape — the provider's raw text never reaches
 * the UI, the same rule the web app's `lib/auth/errors.ts` follows.
 */

export const AUTH_COPY = {
  UNCONFIGURED:
    "This build has no Supabase configuration. Add the public env pair and rebuild.",
  INVALID_CREDENTIALS: "That email and password don't match.",
  EMAIL_NOT_CONFIRMED:
    "This email isn't confirmed yet. Confirm it first, then sign in.",
  NETWORK:
    "Couldn't reach the local Supabase. Check the stack is running and adb reverse is connected.",
  RATE_LIMIT: "Too many attempts right now. Wait a moment and try again.",
  MISSING_FIELDS: "Enter your email and password.",
  GENERIC: "Sign-in failed. Try again.",
  GOOGLE_CANCELLED: "Google sign-in was cancelled.",
  GOOGLE_DENIED: "Google didn't complete the sign-in. Try again.",
  GOOGLE_FAILED: "Google sign-in couldn't be completed. Try again.",
  SIGNOUT_FAILED: "Sign-out failed. Try again.",
  PROFILE_FAILED: "Your profile couldn't be loaded.",
} as const;

type AuthErrorLike = {
  message?: unknown;
  code?: unknown;
  status?: unknown;
};

function text(error: AuthErrorLike): string {
  return typeof error.message === "string" ? error.message.toLowerCase() : "";
}

function isNetworkFailure(error: AuthErrorLike): boolean {
  const message = text(error);
  return (
    message.includes("network request failed") ||
    message.includes("failed to fetch") ||
    message.includes("networkerror") ||
    message.includes("fetch failed")
  );
}

/** Map a GoTrue error to the sanitized copy the sign-in screen renders. */
export function signInErrorMessage(error: AuthErrorLike | null): string {
  if (!error) return AUTH_COPY.GENERIC;
  if (isNetworkFailure(error)) return AUTH_COPY.NETWORK;

  const code = typeof error.code === "string" ? error.code : "";
  const status = typeof error.status === "number" ? error.status : 0;

  if (code === "invalid_credentials" || status === 400) {
    return AUTH_COPY.INVALID_CREDENTIALS;
  }
  if (code === "email_not_confirmed") return AUTH_COPY.EMAIL_NOT_CONFIRMED;
  if (
    code.includes("rate_limit") ||
    status === 429 ||
    text(error).includes("rate limit")
  ) {
    return AUTH_COPY.RATE_LIMIT;
  }
  return AUTH_COPY.GENERIC;
}
