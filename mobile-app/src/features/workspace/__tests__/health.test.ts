import { checkApiHealth } from "../health";

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

const make = (fetchImpl: typeof fetch, baseUrl = "https://api.test/") =>
  checkApiHealth({ baseUrl, getToken: async () => "token", fetchImpl });

describe("checkApiHealth", () => {
  it("probes the Bearer route and reports the AI flag", async () => {
    const calls: Call[] = [];
    const health = await make(
      fakeFetch(200, { ok: true, aiConfigured: true }, calls),
    );
    expect(health.status).toBe("online");
    expect(health.aiConfigured).toBe(true);
    expect(calls[0].url).toBe("https://api.test/api/mobile/health");
    expect(
      (calls[0].init.headers as Record<string, string>).Authorization,
    ).toBe("Bearer token");
  });

  it("refuses to invent an online state without a server address", async () => {
    const calls: Call[] = [];
    const health = await make(fakeFetch(200, { ok: true }, calls), "");
    expect(health.status).toBe("unconfigured");
    expect(calls).toHaveLength(0);
  });

  it("maps an auth failure and a network failure to offline", async () => {
    expect((await make(fakeFetch(401, { error: "unauthorized" }))).status).toBe(
      "offline",
    );
    const throwing = (async () => {
      throw new Error("socket");
    }) as typeof fetch;
    expect((await make(throwing)).status).toBe("offline");
  });

  it("rejects a malformed success body", async () => {
    expect((await make(fakeFetch(200, { ok: "yes" }))).status).toBe("offline");
  });
});
