/**
 * P7.1 — the Google Calendar OAuth callback.
 *
 * `GET /api/integrations/google/callback?code=…&state=…`, the redirect URI
 * `connectGoogleCalendarAction` builds. The contract, in order:
 *
 * 1. No OAuth env pair on this server → `302` to
 *    `/integrations?google=not_configured`, before any cookie or session read;
 * 2. missing `code`, missing/invalid `state`, or a `state` that does not match
 *    the httpOnly cookie (or a session whose user is not the cookie's owner) →
 *    `302` to `/integrations?google=error` — no credential row is written;
 * 3. a failed token exchange (or a response without a refresh token) → the
 *    same honest error redirect. The provider's response text is never read
 *    into a message, logged, or echoed; the authorization code is a credential
 *    and never appears in an error either;
 * 4. success → the refresh token is stored through the service-only
 *    `upsert_google_credentials` RPC with `UNIPILOT_INTEGRATIONS_KEY` (the
 *    access token is discarded and never stored), the caller's single google
 *    connection row is upserted `connected`, `backfillGooglePushes` enqueues the
 *    bounded ids-only push jobs, the state cookie is cleared, and the browser
 *    lands on `/integrations?google=connected`.
 *
 * The backfill is best-effort by design: the connection is already real when
 * it runs, so a transient enqueue failure must not turn a successful connect
 * into an error page — a later connect or confirm can enqueue again.
 */
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getTrustedSiteOrigin } from "@/lib/auth/origin";
import { sessionUser } from "@/lib/auth/session";
import {
  GOOGLE_CALENDAR_SCOPE,
  GOOGLE_OAUTH_CALLBACK_PATH,
  GOOGLE_OAUTH_STATE_COOKIE,
  backfillGooglePushes,
  isGoogleConfigured,
  storeGoogleCredentials,
} from "@/lib/data/integrations";
import { createServiceClient } from "@/lib/supabase/service";

const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

const NOT_CONFIGURED_REDIRECT = "/integrations?google=not_configured";
const ERROR_REDIRECT = "/integrations?google=error";
const CONNECTED_REDIRECT = "/integrations?google=connected";

/**
 * A same-origin redirect, expressed as a relative `Location` (the auth
 * callback's `sameOriginRedirect` rule: no request origin to forge), with the
 * spec'd `302`.
 */
function sameOriginRedirect(path: string): NextResponse {
  return new NextResponse(null, { status: 302, headers: { location: path } });
}

export async function GET(request: Request) {
  if (!isGoogleConfigured()) {
    return sameOriginRedirect(NOT_CONFIGURED_REDIRECT);
  }

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(GOOGLE_OAUTH_STATE_COOKIE)?.value ?? "";
  const separator = cookieValue.indexOf(":");
  const cookieState = separator === -1 ? "" : cookieValue.slice(0, separator);
  const cookieUserId = separator === -1 ? "" : cookieValue.slice(separator + 1);

  if (
    !code ||
    !state ||
    cookieState === "" ||
    cookieUserId === "" ||
    state !== cookieState
  ) {
    return sameOriginRedirect(ERROR_REDIRECT);
  }

  const { user } = await sessionUser();
  if (!user || user.id !== cookieUserId) {
    return sameOriginRedirect(ERROR_REDIRECT);
  }

  let refreshToken = "";
  let scope = GOOGLE_CALENDAR_SCOPE;
  try {
    const origin = await getTrustedSiteOrigin();
    const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_OAUTH_CLIENT_ID ?? "",
        client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "",
        redirect_uri: `${origin}${GOOGLE_OAUTH_CALLBACK_PATH}`,
        grant_type: "authorization_code",
      }),
    });
    if (!response.ok) return sameOriginRedirect(ERROR_REDIRECT);

    const payload = (await response.json()) as {
      refresh_token?: unknown;
      scope?: unknown;
    };
    // Without a refresh token there is nothing a worker could push with, so a
    // repeated authorization that omits it is an honest failure.
    if (typeof payload.refresh_token !== "string" || payload.refresh_token === "") {
      return sameOriginRedirect(ERROR_REDIRECT);
    }
    refreshToken = payload.refresh_token;
    if (typeof payload.scope === "string" && payload.scope.trim() !== "") {
      scope = payload.scope;
    }
  } catch {
    // Never surface the provider's error body, the code, or the tokens.
    return sameOriginRedirect(ERROR_REDIRECT);
  }

  try {
    await storeGoogleCredentials(user.id, refreshToken, scope);
    const service = createServiceClient();
    const connection = await service.from("integration_connections").upsert(
      {
        user_id: user.id,
        provider: "google",
        mode: null,
        status: "connected",
        last_error: null,
      },
      { onConflict: "user_id,provider" },
    );
    if (connection.error) {
      throw new Error("Failed to store the Google connection.");
    }
  } catch {
    return sameOriginRedirect(ERROR_REDIRECT);
  }

  try {
    await backfillGooglePushes(user.id);
  } catch {
    // Best-effort after a real connect; see the route's docstring.
  }

  cookieStore.delete(GOOGLE_OAUTH_STATE_COOKIE);
  revalidatePath("/integrations");
  return sameOriginRedirect(CONNECTED_REDIRECT);
}
