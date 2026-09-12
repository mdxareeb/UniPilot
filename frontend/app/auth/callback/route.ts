import { NextResponse } from "next/server";
import {
  AUTH_ERROR_REDIRECT,
  POST_AUTH_REDIRECT,
  VERIFICATION_ERROR_REDIRECT,
} from "@/lib/auth/constants";
import { createClient } from "@/lib/supabase/server";

/**
 * A same-origin redirect, expressed as a relative `Location`.
 *
 * Task 14.11: this used to be `${origin}${path}` with `origin` taken from
 * `new URL(request.url).origin` — the request's Host header, which a
 * non-browser caller can forge, which would have made this route an
 * open-redirect (and a phishing stage) for those callers. A relative
 * `Location` has no origin to forge: the browser resolves it against the URL
 * it actually requested. `NextResponse` (not `NextResponse.redirect`, which
 * requires an absolute URL in this Next version) still works with the cookie
 * store: Next merges `cookies()` mutations from `exchangeCodeForSession` onto
 * whatever response the handler returns.
 */
function sameOriginRedirect(path: string): NextResponse {
  return new NextResponse(null, { status: 307, headers: { location: path } });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const code = searchParams.get("code");
  const flowId = searchParams.get("sb_flow_id");
  const providerError = searchParams.get("error");
  const isSignupFlow = searchParams.get("flow") === "signup";

  // Both destinations carry an opaque notice code that /login turns into copy —
  // the provider's own error text is never forwarded to the browser.
  const errorTarget = isSignupFlow
    ? VERIFICATION_ERROR_REDIRECT
    : AUTH_ERROR_REDIRECT;

  if (providerError || !code) {
    return sameOriginRedirect(errorTarget);
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(
      code,
      flowId ? { flowId } : undefined,
    );

    if (error) {
      return sameOriginRedirect(errorTarget);
    }
    return sameOriginRedirect(POST_AUTH_REDIRECT);
  } catch {
    return sameOriginRedirect(errorTarget);
  }
}
