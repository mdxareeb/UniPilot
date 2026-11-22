/**
 * Pure helpers for Bearer-authenticated API routes (the mobile app's channel).
 *
 * No imports, so the Playwright specs can exercise them directly. The mobile
 * app sends `Authorization: Bearer <Supabase access token>`; nothing here
 * verifies the token (the route does that with Supabase), it only refuses a
 * header that could not possibly be one, before any network call is made.
 */

/** A Supabase access token is a JWT: three base64url segments. Bound the size. */
const JWT_SHAPE = /^[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}$/;
const MAX_TOKEN_LENGTH = 4096;

export function readBearerToken(header: string | null | undefined): string | null {
  if (typeof header !== "string") return null;
  const match = /^Bearer ([^\s]+)$/i.exec(header.trim());
  if (!match) return null;
  const token = match[1];
  if (token.length > MAX_TOKEN_LENGTH || !JWT_SHAPE.test(token)) return null;
  return token;
}
