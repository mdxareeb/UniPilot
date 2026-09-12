import { NextResponse, type NextRequest } from "next/server";
import { LOGIN_PATH, REDIRECT_PARAM } from "@/lib/auth/constants";
import {
  assertMatcherCoversProtectedRoutes,
  isAuthenticatedRedirectPath,
  isProtectedPath,
  sanitizeRedirectPath,
} from "@/lib/auth/redirects";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import {
  updateSession,
  withSessionCookies,
} from "@/lib/supabase/proxy-session";

function loginRedirectUrl(request: NextRequest, intended: string): URL {
  const target = new URL(LOGIN_PATH, request.nextUrl);
  target.searchParams.set(REDIRECT_PARAM, intended);
  return target;
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isProtected = isProtectedPath(pathname);

  // Without Supabase credentials no session can be verified, so protected
  // routes fail closed while public routes (including all marketing pages)
  // continue to work. getSupabaseEnv() throws when unset, so this guard must
  // come before updateSession().
  if (!isSupabaseConfigured()) {
    return isProtected
      ? NextResponse.redirect(loginRedirectUrl(request, `${pathname}${search}`))
      : NextResponse.next();
  }

  const { user, response } = await updateSession(request);

  if (isProtected && !user) {
    return withSessionCookies(
      NextResponse.redirect(loginRedirectUrl(request, `${pathname}${search}`)),
      response,
    );
  }

  // An authenticated visitor is only bounced onward when they arrived with an
  // explicit post-auth destination (e.g. after being redirected off a gated
  // route). A deliberate visit to /login or /signup renders normally, so a
  // "Sign in" link is never a dead end for someone who still holds a session.
  if (user && isAuthenticatedRedirectPath(pathname)) {
    const requested = request.nextUrl.searchParams.get(REDIRECT_PARAM);
    if (requested !== null) {
      const destination = sanitizeRedirectPath(requested);
      return withSessionCookies(
        NextResponse.redirect(new URL(destination, request.nextUrl)),
        response,
      );
    }
  }

  return response;
}

/**
 * Narrow matcher: every route whose session has to be kept fresh, plus the two
 * auth pages an authenticated user is redirected away from. Marketing routes
 * never reach the proxy, so the public site stays free of Supabase calls.
 *
 * A superset of PROTECTED_PREFIXES in `lib/auth/constants.ts` rather than a
 * mirror of it. Only `/onboarding` is protected since guests can browse the
 * workspace: `/dashboard`, `/tasks`, `/calendar`, `/documents`, `/assistant`,
 * `/tools` and `/integrations` return `isProtectedPath === false`, so the
 * branch above lets them through to render their guest states — but they must
 * still be matched, because
 * `updateSession` is the only place a rotated Supabase refresh token can be
 * written back: the Server Component client in `lib/supabase/server.ts` cannot
 * set cookies during render and swallows the attempt. Drop them from this list
 * and a returning student whose access token expired renders as a guest on the
 * first page they open.
 *
 * Values must be static literals — Next.js analyses them at build time and
 * ignores variables — so a protected route added to PROTECTED_PREFIXES has to be
 * added here too. Task 14.11 makes that duplication safe: the load-time guard
 * below throws when the matcher stops covering every protected prefix, so the
 * dev server, the build and the committed spec fail loudly instead of shipping
 * a route without its gate.
 */
export const config = {
  matcher: [
    "/dashboard",
    "/dashboard/:path*",
    "/tasks",
    "/tasks/:path*",
    "/calendar",
    "/calendar/:path*",
    "/documents",
    "/documents/:path*",
    "/assistant",
    "/assistant/:path*",
    "/tools",
    "/tools/:path*",
    "/integrations",
    "/integrations/:path*",
    "/onboarding",
    "/onboarding/:path*",
    "/login",
    "/signup",
  ],
};

// Runs when this module loads: if a protected route is missing from the
// matcher (or vice versa), the mismatch is a hard error rather than a quietly
// ungated route. PROTECTED_PREFIXES is the same list `isProtectedPath` reads.
assertMatcherCoversProtectedRoutes(config.matcher);
