/**
 * Bearer authentication for API route handlers (the mobile app's channel).
 *
 * The web app authenticates with a cookie session; a native app has no cookie
 * and cannot call Server Actions, so anything it needs that holds server
 * secrets (here: linking WhatsApp, which writes the encrypted session store)
 * goes through a route handler that authenticates with
 * `Authorization: Bearer <Supabase access token>`.
 *
 * What this does, in order:
 *  1. refuse a header that cannot be a token (no network call);
 *  2. ask Supabase to verify the token (`auth.getUser(token)`), which also
 *     rejects an expired or revoked one;
 *  3. build a client that carries the caller's own JWT, so every read made with
 *     it is still governed by row-level security, exactly like the web;
 *  4. apply the onboarding gate (a student who has not finished onboarding
 *     cannot use the workspace, here either).
 *
 * Failures are fixed, generic JSON. A route never learns, and a client never
 * sees, why a token was refused beyond "sign in again".
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "@/lib/supabase/config";
import type { Database } from "@/lib/supabase/database.types";
import { readBearerToken } from "./bearer";

export type ApiUser = {
  id: string;
  /** Carries the caller's JWT: RLS applies to everything run through it. */
  client: SupabaseClient<Database>;
};

export type ApiAuthResult =
  | { ok: true; user: ApiUser }
  | { ok: false; response: Response };

const NO_STORE = { "Cache-Control": "no-store" } as const;

function fail(status: 401 | 403 | 500, error: string): ApiAuthResult {
  const headers: Record<string, string> = { ...NO_STORE };
  if (status === 401) headers["WWW-Authenticate"] = 'Bearer realm="unipilot"';
  return { ok: false, response: Response.json({ error }, { status, headers }) };
}

export async function authenticateBearer(request: Request): Promise<ApiAuthResult> {
  const token = readBearerToken(request.headers.get("authorization"));
  if (!token) return fail(401, "Sign in again.");

  let env: { url: string; anonKey: string };
  try {
    env = getSupabaseEnv();
  } catch {
    return fail(500, "The server is not configured.");
  }

  const client = createClient<Database>(env.url, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return fail(401, "Sign in again.");

  const profile = await client
    .from("profiles")
    .select("onboarding_completed_at")
    .eq("id", data.user.id)
    .maybeSingle();
  if (profile.error) return fail(500, "Something went wrong. Please try again.");
  if (!profile.data?.onboarding_completed_at) {
    return fail(403, "Finish setting up your account first.");
  }

  return { ok: true, user: { id: data.user.id, client } };
}

/** JSON response that is never cached (a QR/pairing code is a login credential). */
export function noStoreJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}
