import Constants from "expo-constants";

/**
 * The Supabase client, initialised lazily from the public env pair.
 *
 * Security posture (plan §B): only the anon key ever reaches the device; RLS
 * is the authority. M1 does not sign in or query — M2 adds the PKCE session
 * and the `expo-secure-store` adapter (never AsyncStorage for tokens). Until
 * then the client is constructed without persistence so no half-session can
 * exist.
 *
 * The `Database` type is imported READ-ONLY from the web workspace
 * (`frontend/lib/supabase/database.types.ts`, generated from the local
 * schema; tsconfig maps `@unipilot/db-types`). It is a type-only import, so
 * Metro never resolves it at runtime; the app never edits it.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@unipilot/db-types";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

/** Whether this build carries the public Supabase pair. */
export const isSupabaseConfigured =
  supabaseUrl.trim() !== "" && supabaseAnonKey.trim() !== "";

let client: SupabaseClient<Database> | null = null;

/** The shared client, or null when the build is not configured (honest state). */
export function getSupabaseClient(): SupabaseClient<Database> | null {
  if (!isSupabaseConfigured) return null;
  if (client === null) {
    client = createClient<Database>(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}

/** The app identity shown on the More screen; values come from the build. */
export const appIdentity = {
  version: Constants.expoConfig?.version ?? "—",
  packageId: Constants.expoConfig?.android?.package ?? "—",
  scheme:
    typeof Constants.expoConfig?.scheme === "string"
      ? Constants.expoConfig.scheme
      : "—",
} as const;
