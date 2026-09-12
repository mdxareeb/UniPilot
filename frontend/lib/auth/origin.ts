import { headers } from "next/headers";

/**
 * The app's own origin, for the Supabase calls that require an absolute URL
 * (signup confirmation, password recovery, the Google OAuth callback).
 *
 * Task 14.11: these URLs used to be built from the request's `Origin`/`Host`
 * headers. Those headers are attacker-controlled on a direct (non-browser)
 * request, so a forged Host could mint a confirmation/recovery link pointing
 * at another domain — a token-phishing path, even though Supabase's redirect
 * allow-list is a second fence. The configured origin is the fix: the request
 * headers are never the source outside local development.
 */

/** Hostnames that can only be local development, never a public origin. */
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

function hostnameOf(host: string): string {
  const trimmed = host.trim();
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    return end === -1 ? trimmed : trimmed.slice(1, end);
  }
  return trimmed.split(":")[0];
}

/**
 * The configured public origin, validated, or null when unset or unusable.
 * Only http/https origins are accepted; a value with a path is reduced to its
 * origin so a stray trailing slash cannot produce `https://site//auth/callback`.
 */
export function configuredSiteOrigin(): string | null {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!configured) return null;

  try {
    const url = new URL(configured);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * The origin auth redirects are built from.
 *
 * `NEXT_PUBLIC_SITE_URL` first, always. Without it, the request Host is
 * trusted only when it is a loopback address (local development cannot know a
 * public origin yet, and only the developer's own machine can reach it there);
 * any other host refuses rather than guessing, and the caller turns the throw
 * into its sanitized failure copy. A missing production configuration
 * therefore fails closed instead of mailing links to a forged origin.
 */
export async function getTrustedSiteOrigin(): Promise<string> {
  const configured = configuredSiteOrigin();
  if (configured) return configured;

  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "";

  if (!LOOPBACK_HOSTNAMES.has(hostnameOf(host).toLowerCase())) {
    throw new Error(
      "NEXT_PUBLIC_SITE_URL must be set to build auth redirect URLs outside local development.",
    );
  }

  return `http://${host}`;
}
