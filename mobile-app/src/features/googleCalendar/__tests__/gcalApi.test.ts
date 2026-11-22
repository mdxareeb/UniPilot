import { createGcalApi, type GcalApiError } from "../gcalApi";
import { GCAL_COPY } from "../gcalValues";

type Call = { url: string; init: RequestInit };

function fakeFetch(status: number, body: unknown, calls: Call[] = []): typeof fetch {
  return (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response;
  }) as typeof fetch;
}

const TOKEN = "header.payload.signature";
const make = (
  fetchImpl: typeof fetch,
  token: string | null = TOKEN,
  baseUrl = "https://api.test/",
) => createGcalApi({ baseUrl, getToken: async () => token, fetch: fetchImpl });

const SNAPSHOT = {
  configured: true,
  status: "connected",
  lastError: null,
  autoExport: false,
  lastSyncedAt: "2026-11-22T10:00:00Z",
  calendars: [
    { id: "c1", googleCalendarId: "primary", summary: "Primary", timezone: "UTC", isActive: true },
  ],
};

describe("request shape", () => {
  it("sends the session token as a Bearer header and no body on reads", async () => {
    const calls: Call[] = [];
    const snapshot = await make(fakeFetch(200, SNAPSHOT, calls)).getSnapshot();
    expect(snapshot.status).toBe("connected");
    expect(calls[0].url).toBe("https://api.test/api/integrations/google-calendar");
    expect(calls[0].init.method).toBe("GET");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${TOKEN}`,
    );
    expect(calls[0].init.body).toBeUndefined();
  });

  it("never calls anything when the build has no server address", async () => {
    const calls: Call[] = [];
    await expect(
      make(fakeFetch(200, SNAPSHOT, calls), TOKEN, "").getSnapshot(),
    ).rejects.toMatchObject({
      kind: "parse",
      message: GCAL_COPY.NOT_CONFIGURED,
    });
    expect(calls).toHaveLength(0);
  });
});

describe("actions", () => {
  it("returns the consent URL from connect", async () => {
    const { authorizationUrl } = await make(
      fakeFetch(200, { authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?x=1" }),
    ).connect();
    expect(authorizationUrl).toContain("accounts.google.com");
  });

  it("posts the toggle to the calendar's own route", async () => {
    const calls: Call[] = [];
    await make(fakeFetch(200, { ok: true }, calls)).setCalendarActive("c1", false);
    expect(calls[0].url).toBe(
      "https://api.test/api/integrations/google-calendar/calendars/c1/active",
    );
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ active: false });
  });

  it("maps the three honest sync outcomes and refuses an unknown one", async () => {
    for (const outcome of ["accepted", "throttled", "not_connected"]) {
      expect(await make(fakeFetch(200, { status: outcome })).sync()).toBe(outcome);
    }
    await expect(make(fakeFetch(200, { status: "started" })).sync()).rejects.toMatchObject({
      kind: "parse",
    });
  });

  it("posts the auto-export opt-in", async () => {
    const calls: Call[] = [];
    await make(fakeFetch(200, { ok: true }, calls)).setAutoExport(true);
    expect(calls[0].url).toBe(
      "https://api.test/api/integrations/google-calendar/auto-export",
    );
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ enabled: true });
  });
});

describe("failures", () => {
  it("classifies a 401 as an auth failure with sign-in copy", async () => {
    const error = (await make(fakeFetch(401, { error: "unauthorized" }))
      .getSnapshot()
      .catch((caught: GcalApiError) => caught)) as GcalApiError;
    expect(error.kind).toBe("unauthorized");
    expect(error.message).toBe("Sign in again to continue.");
  });

  it("keeps the server's own sanitized message for a 500", async () => {
    const error = (await make(fakeFetch(500, { error: "Google Calendar is not configured." }))
      .getSnapshot()
      .catch((caught: GcalApiError) => caught)) as GcalApiError;
    expect(error.kind).toBe("server");
    expect(error.message).toBe("Google Calendar is not configured.");
  });

  it("treats a network throw as a retryable connection error", async () => {
    const throwing = (async () => {
      throw new Error("socket");
    }) as typeof fetch;
    const error = (await make(throwing)
      .getSnapshot()
      .catch((caught: GcalApiError) => caught)) as GcalApiError;
    expect(error.kind).toBe("network");
    expect(error.message).toBe(GCAL_COPY.CONNECT_ERROR);
  });
});
