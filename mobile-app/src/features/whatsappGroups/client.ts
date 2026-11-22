import { supabase } from "@/lib/supabase";

import { createWhatsAppApi, type WhatsAppApi } from "./api";
import type { GroupWriter } from "./groupToggle";

/**
 * The app's wiring of the group-sync clients: the Bearer API (session token →
 * the web server named by `EXPO_PUBLIC_API_BASE_URL`) and the direct,
 * RLS-guarded `is_active` write for the group switches.
 *
 * `EXPO_PUBLIC_API_BASE_URL` is public by design (it is a URL, not a secret).
 * Unset, the app says so instead of failing in a confusing way.
 */
const apiBaseUrl = (process.env.EXPO_PUBLIC_API_BASE_URL ?? "").trim();

export const isApiConfigured = apiBaseUrl !== "" && supabase !== null;

export const whatsappApi: WhatsAppApi = createWhatsAppApi({
  baseUrl: apiBaseUrl,
  getToken: async () => {
    if (supabase === null) return null;
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  },
});

export const writeGroupActive: GroupWriter = async (id, active) => {
  if (supabase === null) return "error";
  const { data, error } = await supabase
    .from("monitored_groups")
    .update({ is_active: active })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return "error";
  return data === null ? "missing" : "ok";
};
