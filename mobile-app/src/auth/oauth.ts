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

/** The route params a `/auth-callback` URL carries, or null when the URL is
 * not the app's OAuth landing. Used by the root layout's cold-start handler:
 * on Android the router can miss the launch URL (its `getInitialURL` races a
 * 150 ms timeout and the URL is consumed as the launch intent, so no later
 * `url` event follows), while expo-linking's native module still holds it. */
export function authCallbackParams(
  url: string | null | undefined,
): Record<string, string> | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const landing = new URL(AUTH_CALLBACK_URL);
    if (
      parsed.protocol !== landing.protocol ||
      parsed.hostname !== landing.hostname
    ) {
      return null;
    }
    const params: Record<string, string> = {};
    for (const key of ["code", "error", "error_description", "sb_flow_id"]) {
      const value = parsed.searchParams.get(key);
      if (value !== null && value.trim() !== "") params[key] = value;
    }
    return Object.keys(params).length > 0 ? params : null;
  } catch {
    return null;
  }
}

/**
 * Exchange a PKCE code for a session. The code verifier was stored (encrypted,
 * chunked) when `signInWithOAuth` started the flow; on React Native the flow
 * id must travel explicitly — it was appended to the redirect as `sb_flow_id`
 * and is passed back here, because there is no `window.location` to read it
 * from (the M2b failure this fixes).
 *
 * Single-flight (M2b defect, 2026-11-16): one callback URL can reach the app
 * twice — the `auth-callback` route (which can also re-mount) and the in-app
 * browser result. Submitting the same code twice raced GoTrue into minting two
 * sessions. Every submission of the same code now shares one `/token` call and
 * one result; a different code always starts a fresh exchange, and a failure is
 * not cached (a re-delivery may retry).
 */
let pendingExchange: { code: string; promise: Promise<OAuthResult> } | null = null;

export function exchangeAuthCode(
  code: string,
  flowId: string | null = null,
): Promise<OAuthResult> {
  if (pendingExchange !== null && pendingExchange.code === code) {
    return pendingExchange.promise;
  }
  const promise = performExchange(code, flowId).then((result) => {
    if (result.status !== "signed_in" && pendingExchange?.code === code) {
      pendingExchange = null;
    }
    return result;
  });
  pendingExchange = { code, promise };
  return promise;
}

async function performExchange(
  code: string,
  flowId: string | null,
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
