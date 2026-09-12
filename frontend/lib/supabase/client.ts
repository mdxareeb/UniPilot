import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseEnv } from "./config";
import type { Database } from "./database.types";

export function createClient() {
  const { url, anonKey } = getSupabaseEnv();
  return createBrowserClient<Database>(url, anonKey);
}
