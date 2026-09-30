import "react-native-url-polyfill/auto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@unipilot/db-types";
import { installCryptoPolyfill } from "./cryptoPolyfill";
import { secureStorage } from "./secureStorage";
import Constants from "expo-constants";

/**
 * The Supabase client, initialised from the public env pair (M2).
 *
 * Security posture (plan §B): only the anon key ever reaches the device; RLS
 * is the authority. Sessions live in `expo-secure-store` through the chunked
 * adapter — never AsyncStorage — and the flow is PKCE so the OAuth deep-link
 * return (M2b) is built on a real S256 challenge.
 *
 * The `Database` type is imported READ-ONLY from the web workspace
 * (`frontend/lib/supabase/database.types.ts`, generated from the local
 * schema; tsconfig maps `@unipilot/db-types`). It is a type-only import, so
 * Metro never resolves it at runtime; the app never edits it.
 */

installCryptoPolyfill();

const supabaseUrl = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? "").trim();
const supabaseAnonKey = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();

/** Whether this build carries the public Supabase pair. */
export const isSupabaseConfigured =
  supabaseUrl !== "" && supabaseAnonKey !== "";

/** The shared client, or null when the build is not configured (honest state). */
export const supabase: SupabaseClient<Database> | null = isSupabaseConfigured
  ? createClient<Database>(supabaseUrl, supabaseAnonKey, {
      auth: {
        storage: secureStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
        flowType: "pkce",
      },
    })
  : null;

/** The app identity shown on the More screen; values come from the build. */
export const appIdentity = {
  version: Constants.expoConfig?.version ?? "—",
  packageId: Constants.expoConfig?.android?.package ?? "—",
  scheme:
    typeof Constants.expoConfig?.scheme === "string"
      ? Constants.expoConfig.scheme
      : "—",
} as const;
