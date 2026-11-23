import { supabase } from "@/lib/supabase";

import { createChatApi, type ChatApi } from "./chatApi";

/**
 * The app's wiring of the Ask AI Bearer client. The web server is named by
 * `EXPO_PUBLIC_API_BASE_URL`; unset, the screen says the build is not
 * connected instead of failing with a raw fetch error.
 */
const apiBaseUrl = (process.env.EXPO_PUBLIC_API_BASE_URL ?? "").trim();

export const isAskAiApiConfigured =
  apiBaseUrl !== "" && supabase !== null;

export const askAiApi: ChatApi = createChatApi({
  baseUrl: apiBaseUrl,
  getToken: async () => {
    if (supabase === null) return null;
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  },
});
