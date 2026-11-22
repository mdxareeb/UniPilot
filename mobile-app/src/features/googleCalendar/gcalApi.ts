import {
  GCAL_COPY,
  parseGcalSnapshot,
  type GcalSnapshot,
} from "./gcalValues";

/**
 * The Bearer client for the web app's Google Calendar routes (channel iii).
 * The Supabase session's access token is the credential; it travels only in
 * the Authorization header and is never logged. Errors are plain sanitized
 * copy - the server's own message when it sent one.
 */
export type GcalApiError = Error & { kind: "unauthorized" | "server" | "network" | "parse" };

export type GcalApi = {
  getSnapshot: () => Promise<GcalSnapshot>;
  connect: () => Promise<{ authorizationUrl: string }>;
  setCalendarActive: (calendarId: string, active: boolean) => Promise<void>;
  sync: () => Promise<"accepted" | "throttled" | "not_connected">;
  setAutoExport: (enabled: boolean) => Promise<void>;
  disconnect: () => Promise<void>;
};

const ROOT = "/api/integrations/google-calendar";

export function createGcalApi(deps: {
  baseUrl: string;
  getToken: () => Promise<string | null>;
  fetch?: typeof fetch;
}): GcalApi {
  const base = deps.baseUrl.trim().replace(/\/+$/, "");
  const doFetch = deps.fetch ?? fetch;

  async function call(
    path: string,
    init: { method: "GET" | "POST"; body?: unknown } = { method: "GET" },
  ): Promise<{ status: number; json: unknown }> {
    if (base === "") {
      throw gcalError("parse", GCAL_COPY.NOT_CONFIGURED);
    }
    const token = await deps.getToken();
    if (token === null || token === "") {
      throw gcalError("unauthorized", "Sign in again to continue.");
    }
    let response: Response;
    try {
      response = await doFetch(`${base}${ROOT}${path}`, {
        method: init.method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(init.body === undefined ? null : { "Content-Type": "application/json" }),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
    } catch {
      throw gcalError("network", GCAL_COPY.CONNECT_ERROR);
    }
    let json: unknown = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    return { status: response.status, json };
  }

  function failFrom(status: number, json: unknown): GcalApiError {
    const message =
      typeof (json as { error?: unknown })?.error === "string"
        ? (json as { error: string }).error
        : GCAL_COPY.CONNECT_ERROR;
    if (status === 401) return gcalError("unauthorized", "Sign in again to continue.");
    if (status === 403) return gcalError("unauthorized", "Finish setting up your account first.");
    return gcalError("server", message);
  }

  return {
    async getSnapshot() {
      const { status, json } = await call("");
      if (status !== 200) throw failFrom(status, json);
      const snapshot = parseGcalSnapshot(json);
      if (snapshot === null) throw gcalError("parse", GCAL_COPY.CONNECT_ERROR);
      return snapshot;
    },

    async connect() {
      const { status, json } = await call("/connect", { method: "POST" });
      if (status !== 200) throw failFrom(status, json);
      const url =
        typeof (json as { authorizationUrl?: unknown })?.authorizationUrl === "string"
          ? (json as { authorizationUrl: string }).authorizationUrl
          : null;
      if (url === null || url === "") throw gcalError("parse", GCAL_COPY.CONNECT_ERROR);
      return { authorizationUrl: url };
    },

    async setCalendarActive(calendarId, active) {
      const { status, json } = await call(`/calendars/${calendarId}/active`, {
        method: "POST",
        body: { active },
      });
      if (status !== 200) throw failFrom(status, json);
    },

    async sync() {
      const { status, json } = await call("/sync", { method: "POST" });
      if (status !== 200) throw failFrom(status, json);
      const outcome = (json as { status?: unknown })?.status;
      if (outcome === "accepted" || outcome === "throttled" || outcome === "not_connected") {
        return outcome;
      }
      throw gcalError("parse", GCAL_COPY.CONNECT_ERROR);
    },

    async setAutoExport(enabled) {
      const { status, json } = await call("/auto-export", {
        method: "POST",
        body: { enabled },
      });
      if (status !== 200) throw failFrom(status, json);
    },

    async disconnect() {
      const { status, json } = await call("/disconnect", { method: "POST" });
      if (status !== 200) throw failFrom(status, json);
    },
  };
}

function gcalError(kind: GcalApiError["kind"], message: string): GcalApiError {
  const error = new Error(message) as GcalApiError;
  error.kind = kind;
  return error;
}
