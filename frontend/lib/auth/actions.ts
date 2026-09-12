"use server";

import { AuthError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { getTrustedSiteOrigin } from "./origin";
import {
  AUTH_CALLBACK_PATH,
  AUTH_CONFIRM_PATH,
  AUTH_ERROR_REDIRECT,
  LOGIN_PATH,
  RESET_PASSWORD_PATH,
} from "./constants";
import {
  CREDENTIALS_REQUIRED,
  EMAIL_ALREADY_REGISTERED,
  EMAIL_REQUIRED,
  GENERIC_ERROR,
  INVALID_CREDENTIALS,
  INVALID_EMAIL,
  NOT_CONFIGURED,
  PASSWORD_POLICY,
  PASSWORD_TOO_SHORT,
  RATE_LIMITED,
  SIGN_OUT_ERROR,
} from "./errors";

export type AuthActionResult = {
  error: string | null;
  needsEmailConfirmation?: boolean;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function toAuthError(error: unknown, fallback: string): string {
  if (error instanceof AuthError) {
    const message = error.message.toLowerCase();
    if (
      message.includes("invalid login credentials") ||
      message.includes("email not confirmed")
    ) {
      return INVALID_CREDENTIALS;
    }
    if (message.includes("already registered")) {
      return EMAIL_ALREADY_REGISTERED;
    }
    if (message.includes("password")) {
      return PASSWORD_POLICY;
    }
    if (message.includes("rate limit")) {
      return RATE_LIMITED;
    }
  }
  return fallback;
}

export async function signInWithEmail(
  email: string,
  password: string,
): Promise<AuthActionResult> {
  if (!isSupabaseConfigured()) {
    return { error: NOT_CONFIGURED };
  }

  const normalized = normalizeEmail(email);

  if (!normalized || !password) {
    return { error: CREDENTIALS_REQUIRED };
  }
  if (!isValidEmail(normalized)) {
    return { error: INVALID_EMAIL };
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: normalized,
      password,
    });

    if (error) {
      return { error: toAuthError(error, INVALID_CREDENTIALS) };
    }
    return { error: null };
  } catch {
    return { error: GENERIC_ERROR };
  }
}

export async function signUpWithEmail(
  email: string,
  password: string,
): Promise<AuthActionResult> {
  if (!isSupabaseConfigured()) {
    return { error: NOT_CONFIGURED };
  }

  const normalized = normalizeEmail(email);

  if (!normalized || !password) {
    return { error: CREDENTIALS_REQUIRED };
  }
  if (!isValidEmail(normalized)) {
    return { error: INVALID_EMAIL };
  }
  if (password.length < 8) {
    return { error: PASSWORD_TOO_SHORT };
  }

  try {
    const origin = await getTrustedSiteOrigin();
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signUp({
      email: normalized,
      password,
      options: {
        emailRedirectTo: `${origin}${AUTH_CONFIRM_PATH}`,
      },
    });

    if (error) {
      return { error: toAuthError(error, GENERIC_ERROR) };
    }
    return {
      error: null,
      needsEmailConfirmation: !data.session,
    };
  } catch {
    return { error: GENERIC_ERROR };
  }
}

export async function requestPasswordReset(
  email: string,
): Promise<AuthActionResult> {
  if (!isSupabaseConfigured()) {
    return { error: NOT_CONFIGURED };
  }

  const normalized = normalizeEmail(email);

  if (!normalized) {
    return { error: EMAIL_REQUIRED };
  }
  if (!isValidEmail(normalized)) {
    return { error: INVALID_EMAIL };
  }

  try {
    const origin = await getTrustedSiteOrigin();
    const supabase = await createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(normalized, {
      redirectTo: `${origin}${RESET_PASSWORD_PATH}`,
    });

    if (error) {
      return { error: toAuthError(error, GENERIC_ERROR) };
    }
    return { error: null };
  } catch {
    return { error: GENERIC_ERROR };
  }
}

export async function signInWithGoogle(): Promise<void> {
  if (!isSupabaseConfigured()) {
    redirect(AUTH_ERROR_REDIRECT);
  }

  let oauthUrl: string | null = null;
  try {
    const origin = await getTrustedSiteOrigin();
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${origin}${AUTH_CALLBACK_PATH}`,
        scopes: "openid email profile",
      },
    });

    if (!error && data.url) {
      oauthUrl = data.url;
    }
  } catch {
    oauthUrl = null;
  }

  redirect(oauthUrl ?? AUTH_ERROR_REDIRECT);
}

/**
 * Clears the Supabase session and returns the user to /login.
 *
 * Runs on the server so the auth cookies are cleared by `@supabase/ssr` through
 * `next/headers` — the same cookie plumbing every other auth action uses. On
 * failure the session is left intact and a sanitized message is returned rather
 * than redirecting, so the UI never reports a sign-out that did not happen.
 */
export async function signOut(): Promise<AuthActionResult> {
  if (isSupabaseConfigured()) {
    try {
      const supabase = await createClient();
      const { error } = await supabase.auth.signOut();
      if (error) {
        return { error: SIGN_OUT_ERROR };
      }
    } catch {
      return { error: SIGN_OUT_ERROR };
    }

    // Drop cached authenticated payloads so a Back navigation cannot render
    // signed-in content after the cookies are gone.
    revalidatePath("/", "layout");
  }

  // Unconfigured Supabase means there is no session to clear, and /login is
  // still the right destination. redirect() throws, so it stays outside the
  // try block above.
  redirect(LOGIN_PATH);
}
