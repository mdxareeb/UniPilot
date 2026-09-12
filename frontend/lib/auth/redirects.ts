import {
  AUTHENTICATED_REDIRECT_PATHS,
  POST_AUTH_REDIRECT,
  PROTECTED_PREFIXES,
  PUBLIC_AUTH_PATHS,
} from "./constants";

function matchesRoute(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

/** Rejects C0 control characters and DEL, which have no place in a path. */
function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((route) => matchesRoute(pathname, route));
}

/**
 * Load-time guard for the proxy's duplicated route list (Task 14.11).
 *
 * Next.js requires `config.matcher` to be static literals — variables are
 * ignored — so the protected routes are duplicated between
 * `PROTECTED_PREFIXES` and `proxy.ts`, and a route added to only one of them
 * would silently lose its gate. Since guests can browse the workspace the
 * protected set is only `/onboarding`; the matcher also covers the
 * guest-viewable app routes for session refresh, which is why it is a superset
 * rather than a mirror. `proxy.ts` calls this when the module loads (dev
 * server, build, tests); the committed auth-guards spec calls it too, and
 * proves it fails when an entry is missing.
 */
export function assertMatcherCoversProtectedRoutes(
  matcher: readonly string[],
): void {
  const missing = PROTECTED_PREFIXES.filter(
    (route) => !matcher.includes(route) || !matcher.includes(`${route}/:path*`),
  );

  if (missing.length > 0) {
    throw new Error(
      `proxy matcher is missing protected route(s): ${missing.join(", ")}. ` +
        "Add each route to PROTECTED_PREFIXES and to the static matcher in proxy.ts.",
    );
  }
}

export function isPublicAuthPath(pathname: string): boolean {
  return PUBLIC_AUTH_PATHS.some((route) => matchesRoute(pathname, route));
}

export function isAuthenticatedRedirectPath(pathname: string): boolean {
  return AUTHENTICATED_REDIRECT_PATHS.some((route) =>
    matchesRoute(pathname, route),
  );
}

/**
 * Validates a `?next=` destination before it is used in a redirect.
 *
 * Accepts only same-origin absolute paths. Rejects protocol-relative URLs
 * (`//evil.com`), backslash variants, control characters, and public auth paths
 * (which would bounce the user straight back to /login). Falls back to the
 * default post-auth destination.
 */
export function sanitizeRedirectPath(value: string | null | undefined): string {
  if (typeof value !== "string") return POST_AUTH_REDIRECT;

  const candidate = value.trim();

  if (!candidate.startsWith("/")) return POST_AUTH_REDIRECT;
  if (candidate.startsWith("//")) return POST_AUTH_REDIRECT;
  if (candidate.includes("\\")) return POST_AUTH_REDIRECT;
  if (hasControlChars(candidate)) return POST_AUTH_REDIRECT;

  const pathname = candidate.split("?")[0].split("#")[0];
  if (isPublicAuthPath(pathname)) return POST_AUTH_REDIRECT;

  return candidate;
}
