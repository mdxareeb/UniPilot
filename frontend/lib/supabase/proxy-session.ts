import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv } from "./config";
import type { Database } from "./database.types";

export type ProxySession = {
  /** Authenticated user, or null when there is no valid session. */
  user: User | null;
  /** Response carrying any refreshed Supabase auth cookies. */
  response: NextResponse;
};

/**
 * Reads the Supabase session from request cookies and refreshes it when the
 * access token has expired. Uses the public anon key only — never the
 * service-role key.
 */
export async function updateSession(
  request: NextRequest,
): Promise<ProxySession> {
  const { url, anonKey } = getSupabaseEnv();
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  // getUser() validates the token with Supabase Auth rather than trusting the
  // cookie, and triggers a refresh when needed. Expired, invalid, or revoked
  // sessions resolve to null instead of throwing.
  try {
    const { data, error } = await supabase.auth.getUser();
    return { user: error ? null : data.user, response };
  } catch {
    return { user: null, response };
  }
}

/**
 * Copies refreshed Supabase auth cookies onto a redirect response so a token
 * refresh is not lost when the proxy redirects instead of continuing.
 */
export function withSessionCookies(
  target: NextResponse,
  source: NextResponse,
): NextResponse {
  source.cookies.getAll().forEach((cookie) => {
    target.cookies.set(cookie);
  });
  return target;
}
