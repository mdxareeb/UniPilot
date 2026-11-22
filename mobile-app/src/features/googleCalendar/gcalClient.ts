import { supabase } from "@/lib/supabase";

import { createGcalApi, type GcalApi } from "./gcalApi";

/**
 * The app's wiring of the Google Calendar Bearer client: the web server named
 * by `EXPO_PUBLIC_API_BASE_URL` and the session's access token. Unset, the
 * screen says so instead of failing confusingly.
 */
const apiBaseUrl = (process.env.EXPO_PUBLIC_API_BASE_URL ?? "").trim();

export const isGcalApiConfigured = apiBaseUrl !== "" && supabase !== null;

export const gcalApi: GcalApi = createGcalApi({
  baseUrl: apiBaseUrl,
  getToken: async () => {
    if (supabase === null) return null;
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  },
});
