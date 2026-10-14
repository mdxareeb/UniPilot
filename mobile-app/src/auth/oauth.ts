import * as WebBrowser from "expo-web-browser";

import { supabase } from "@/lib/supabase";
import { AUTH_COPY } from "./authErrors";

/** The app scheme's OAuth landing (registered in the local GoTrue allow-list). */
export const AUTH_CALLBACK_URL = "unipilot://auth-callback";

export type OAuthResult =
  | { status: "signed_in" }
  | { status: "cancelled" }
  | { status: "error"; error: string };

/** The pieces a callback URL can carry; anything else is ignored. */
export function parseAuthCallbackUrl(url: string): {
  code: string | null;
  error: string | null;
  /** The PKCE flow id (`sb_flow_id`) when the library appended one. */
  flowId: string | null;
} {
  try {
    const parsed = new URL(url);
    const code = parsed.searchParams.get("code");
    const error =
      parsed.searchParams.get("error_description") ??
      parsed.searchParams.get("error");
    const flowId = parsed.searchParams.get("sb_flow_id");
    return {
      code: code !== null && code.trim() !== "" ? code.trim() : null,
      error: error !== null && error.trim() !== "" ? error.trim() : null,
      flowId: flowId !== null && flowId.trim() !== "" ? flowId.trim() : null,
    };
  } catch {
    return { code: null, error: null, flowId: null };
  }
}

/**
 * Exchange a PKCE code for a session. The code verifier was stored (encrypted,
 * chunked) when `signInWithOAuth` started the flow; on React Native the flow
 * id must travel explicitly — it was appended to the redirect as `sb_flow_id`
 * and is passed back here, because there is no `window.location` to read it
 * from (the M2b failure this fixes).
 */
export async function exchangeAuthCode(
  code: string,
  flowId: string | null = null,
): Promise<OAuthResult> {
  if (supabase === null) {
    return { status: "error", error: AUTH_COPY.UNCONFIGURED };
  }
  try {
    const { error } = await supabase.auth.exchangeCodeForSession(
      code,
      flowId !== null ? { flowId } : undefined,
    );
    if (error) return { status: "error", error: AUTH_COPY.GOOGLE_FAILED };
    return { status: "signed_in" };
  } catch {
    return { status: "error", error: AUTH_COPY.GOOGLE_FAILED };
  }
}

/**
 * Start the Google sign-in: `signInWithOAuth` returns the authorize URL
 * (PKCE, `skipBrowserRedirect`), the in-app browser session opens it, and the
 * redirect back to the app scheme is exchanged for a session. A user cancel
 * resolves to the honest `cancelled` result — never a spinner, never a fake
 * success.
 */
export async function startGoogleSignIn(): Promise<OAuthResult> {
  if (supabase === null) {
    return { status: "error", error: AUTH_COPY.UNCONFIGURED };
  }

  let authorizeUrl: string;
  try {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: AUTH_CALLBACK_URL,
        skipBrowserRedirect: true,
      },
    });
    if (error || !data?.url) {
      return { status: "error", error: AUTH_COPY.GOOGLE_FAILED };
    }
    authorizeUrl = data.url;
  } catch {
    return { status: "error", error: AUTH_COPY.GOOGLE_FAILED };
  }

  const session = await WebBrowser.openAuthSessionAsync(
    authorizeUrl,
    AUTH_CALLBACK_URL,
  );

  if (session.type !== "success") {
    // "cancel" and "dismiss" are the user's choice, not a failure.
    return { status: "cancelled" };
  }

  const { code, error: urlError, flowId } = parseAuthCallbackUrl(session.url);
  if (urlError !== null) {
    return { status: "error", error: AUTH_COPY.GOOGLE_DENIED };
  }
  if (code === null) {
    return { status: "error", error: AUTH_COPY.GOOGLE_FAILED };
  }
  return exchangeAuthCode(code, flowId);
}
