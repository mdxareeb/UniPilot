import type { User } from "@supabase/supabase-js";

/**
 * Longer than any given name, so a value this long is junk rather than a name.
 * Greeting someone with a paragraph is worse than not greeting them by name.
 */
const MAX_FIRST_NAME_LENGTH = 40;

function firstWord(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;

  // Providers send a whole display name; only its first part belongs in a
  // greeting.
  const [word = ""] = value.trim().split(/\s+/);
  if (word === "" || word.length > MAX_FIRST_NAME_LENGTH) return undefined;

  // A word with an `@` in it is an address, not a name. Google always sends a real
  // display name, but an attribute mapping or a `raw_user_meta_data` edit can put an
  // email in `full_name` — and "Welcome, m.khan21@uni.ac.uk" is the greeting this
  // module exists to avoid, whichever field it arrived in.
  if (word.includes("@")) return undefined;

  return word;
}

/**
 * The name to greet the signed-in user by, or `undefined` when the session does
 * not carry one.
 *
 * `user_metadata` is whatever the identity provider wrote: Google OAuth supplies
 * `full_name`/`name`, while email/password signup supplies neither (`signUp` in
 * `lib/auth/actions.ts` passes only `emailRedirectTo`). It is loosely typed and
 * outside our control, so each value is narrowed before it reaches the page —
 * which is also why the absent case is the one every caller must render well.
 *
 * There is deliberately no fall back to the email local part: "Welcome,
 * m.khan21" reads worse than a greeting with no name in it.
 */
export function sessionFirstName(user: User): string | undefined {
  const metadata: Record<string, unknown> = user.user_metadata ?? {};
  return firstWord(metadata.full_name) ?? firstWord(metadata.name);
}
