import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { getSupabaseEnv } from "./config";

/**
 * The service-role client — the one Supabase client that bypasses RLS.
 *
 * Used only by server-only code that legitimately writes around the
 * client-role policies: the 29.1 enqueue helper (`lib/data/jobs.ts`) and the
 * QA/seed scripts' Node entry points. Never import this from a page read or a
 * client component, and never log the key.
 *
 * The key is read from the server environment (`SUPABASE_SERVICE_ROLE_KEY`,
 * see `frontend/.env.example`); a missing key throws rather than silently
 * degrading to an anonymous client that would fail in confusing ways.
 */
export function createServiceClient() {
  const { url } = getSupabaseEnv();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set; the service client is server-only.",
    );
  }

  return createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
