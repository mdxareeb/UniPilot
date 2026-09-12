import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * The caller's IANA timezone (R15), read through the request-scoped client.
 *
 * One helper for both data services — tasks (21.8) and events (22.x) resolve
 * their display strings and date-only values in the same zone, so neither
 * grows its own copy or its own notion of "local". `timezone` is
 * `not null default 'UTC'`, so a missing profile is the only absent case and
 * UTC is the honest fallback there.
 */
export async function readProfileTimeZone(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<string> {
  const { data, error } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw new Error("Failed to read profile timezone.");
  return data?.timezone ?? "UTC";
}
