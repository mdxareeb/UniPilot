import { supabase } from "@/lib/supabase";

export type ApiHealthStatus = "online" | "offline" | "unconfigured";

export type ApiHealth = {
  status: ApiHealthStatus;
  /** The server has a Gemini chat/extraction pair configured. */
  aiConfigured: boolean;
  checkedAt: number;
};

type HealthDeps = {
  baseUrl: string;
  getToken: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 8_000;

/**
 * Probe the Bearer health route. Every failure is a plain offline state; the
 * screen never shows a green dot for a request that did not complete.
 */
export async function checkApiHealth(deps: HealthDeps): Promise<ApiHealth> {
  const checkedAt = Date.now();
  const baseUrl = deps.baseUrl.trim().replace(/\/+$/, "");
  if (baseUrl === "") {
    return { status: "unconfigured", aiConfigured: false, checkedAt };
  }

  const token = await deps.getToken();
  if (token === null || token === "") {
    return { status: "unconfigured", aiConfigured: false, checkedAt };
  }

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    deps.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  try {
    const response = await (deps.fetchImpl ?? fetch)(
      `${baseUrl}/api/mobile/health`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      return { status: "offline", aiConfigured: false, checkedAt };
    }
    const body = (await response.json().catch(() => null)) as {
      ok?: unknown;
      aiConfigured?: unknown;
    } | null;
    if (body?.ok !== true) {
      return { status: "offline", aiConfigured: false, checkedAt };
    }
    return {
      status: "online",
      aiConfigured: body.aiConfigured === true,
      checkedAt,
    };
  } catch {
    return { status: "offline", aiConfigured: false, checkedAt };
  } finally {
    clearTimeout(timer);
  }
}

/** The app's wiring: the configured web origin and the current session token. */
export async function probeApiHealth(): Promise<ApiHealth> {
  return checkApiHealth({
    baseUrl: (process.env.EXPO_PUBLIC_API_BASE_URL ?? "").trim(),
    getToken: async () => {
      if (supabase === null) return null;
      const { data } = await supabase.auth.getSession();
      return data.session?.access_token ?? null;
    },
  });
}
