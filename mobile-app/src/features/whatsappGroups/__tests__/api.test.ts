import {
  API_COPY,
  createWhatsAppApi,
  mapFailure,
  parseSnapshot,
  WhatsAppApiError,
} from "../api";

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
const make = (fetchImpl: typeof fetch, token: string | null = TOKEN, baseUrl = "https://api.test/") =>
  createWhatsAppApi({ baseUrl, getToken: async () => token, fetch: fetchImpl });

describe("request shape", () => {
  it("sends the session token as a Bearer header and nothing else secret", async () => {
    const calls: Call[] = [];
    await make(fakeFetch(200, { state: "disconnected" }, calls)).getSnapshot();
    expect(calls[0].url).toBe("https://api.test/api/integrations/whatsapp-groups");
    expect(calls[0].init.method).toBe("GET");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(calls[0].init.body).toBeUndefined();
  });

  it("posts only the digits for a link", async () => {
    const calls: Call[] = [];
    await make(fakeFetch(200, { ok: true }, calls)).link("919876543210");
    expect(calls[0].url).toBe("https://api.test/api/integrations/whatsapp-groups/link");
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ phone: "919876543210" });
  });

  it("targets the candidate route for add and dismiss", async () => {
    const calls: Call[] = [];
    const api = make(fakeFetch(200, { ok: true }, calls));
    await api.decide("11111111-2222-3333-4444-555555555555", "confirm");
    await api.decide("11111111-2222-3333-4444-555555555555", "reject");
    expect(calls.map((c) => c.url.split("whatsapp-groups")[1])).toEqual([
      "/candidates/11111111-2222-3333-4444-555555555555/confirm",
      "/candidates/11111111-2222-3333-4444-555555555555/reject",
    ]);
  });

  it("returns the disconnect notice when the server sends one", async () => {
    expect(await make(fakeFetch(200, { ok: true, notice: "Also remove it on your phone." })).disconnect()).toEqual({
      notice: "Also remove it on your phone.",
    });
    expect(await make(fakeFetch(200, { ok: true })).disconnect()).toEqual({ notice: null });
  });
});

describe("failures never reach the network without a credential", () => {
  it("is unauthorized with no token", async () => {
    const calls: Call[] = [];
    await expect(make(fakeFetch(200, {}, calls), null).getSnapshot()).rejects.toMatchObject({
      kind: "unauthorized",
    });
    expect(calls).toHaveLength(0);
  });

  it("is unconfigured with no base URL", async () => {
    const calls: Call[] = [];
    await expect(make(fakeFetch(200, {}, calls), TOKEN, " ").getSnapshot()).rejects.toMatchObject({
      kind: "unconfigured",
    });
    expect(calls).toHaveLength(0);
  });

  it("maps a thrown fetch to a network error", async () => {
    const failing = (async () => {
      throw new TypeError("Network request failed");
    }) as unknown as typeof fetch;
    await expect(make(failing).getSnapshot()).rejects.toMatchObject({
      kind: "network",
      message: API_COPY.NETWORK,
    });
  });
});

describe("mapFailure", () => {
  it.each([
    [400, { error: "Use digits only.", field: "phone" }, "invalid_phone", "Use digits only."],
    [400, { error: "x" }, "server", "x"],
    [401, { error: "Sign in again." }, "unauthorized", API_COPY.UNAUTHORIZED],
    [403, { error: "Finish onboarding." }, "onboarding", "Finish onboarding."],
    [404, { error: "Gone." }, "not_found", "Gone."],
    [409, { error: "Already linked." }, "already_linked", "Already linked."],
    [413, null, "too_large", API_COPY.TOO_LARGE],
    [429, { error: "Wait a few seconds." }, "throttled", "Wait a few seconds."],
    [500, { error: "stack trace: secret" }, "server", API_COPY.SERVER],
    [503, null, "server", API_COPY.SERVER],
  ])("%s → %s", (status, body, kind, message) => {
    const error = mapFailure(status as number, body);
    expect(error).toBeInstanceOf(WhatsAppApiError);
    expect(error.kind).toBe(kind);
    expect(error.message).toBe(message);
  });

  it("falls back to its own copy when the server said nothing useful", () => {
    expect(mapFailure(429, { error: "   " }).message).toBe(API_COPY.THROTTLED);
    expect(mapFailure(409, 42).message).toBe(API_COPY.ALREADY_LINKED);
  });
});

describe("parseSnapshot", () => {
  const valid = {
    enabled: true,
    state: "code_ready",
    lastError: null,
    qr: null,
    pairing: { code: "ABCD1234", expiresAt: "2026-11-19T12:00:00Z" },
    groups: [{ id: "g1", name: "CS 2026", active: true, activatedAt: null, lastSyncedAt: null }],
    review: [
      {
        id: "c1",
        title: "Submit lab 3",
        kind: "task",
        typeLabel: "Assignment",
        whenLabel: "Fri, Nov 20",
        allDay: true,
        sender: "Asha",
        messageText: "lab 3 due friday",
        confidencePercent: 72,
        subjectName: "Databases",
        proposedSubjectName: null,
        groupName: "CS 2026",
      },
    ],
  };

  it("reads a full snapshot", () => {
    const snapshot = parseSnapshot(valid);
    expect(snapshot?.state).toBe("code_ready");
    expect(snapshot?.pairing).toEqual({ code: "ABCD1234", expiresAt: "2026-11-19T12:00:00Z" });
    expect(snapshot?.groups).toHaveLength(1);
    expect(snapshot?.review[0].title).toBe("Submit lab 3");
  });

  it("rejects an unknown state or a non-object instead of half-rendering", () => {
    expect(parseSnapshot({ ...valid, state: "teleporting" })).toBeNull();
    expect(parseSnapshot(null)).toBeNull();
    expect(parseSnapshot("nope")).toBeNull();
    expect(parseSnapshot([])).toBeNull();
  });

  it("drops malformed list entries and keeps the rest", () => {
    const snapshot = parseSnapshot({
      ...valid,
      groups: [valid.groups[0], { id: 1 }, null],
      review: [valid.review[0], { title: "no id" }],
    });
    expect(snapshot?.groups).toHaveLength(1);
    expect(snapshot?.review).toHaveLength(1);
  });

  it("ignores a pairing block unless the state is code_ready", () => {
    expect(parseSnapshot({ ...valid, state: "connected" })?.pairing).toBeNull();
  });

  it("treats a server with the feature off as not enabled", () => {
    expect(parseSnapshot({ ...valid, enabled: false, state: "disconnected" })?.state).toBe(
      "not_enabled",
    );
  });
});
