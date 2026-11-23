import { createChatApi } from "../chatApi";
import { ChatApiError } from "../chatErrors";
import { CHAT_COPY } from "../chatValues";

const SESSION = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "OS scheduling",
  scopeSubjectId: null,
  scopeDocumentId: "22222222-2222-4222-8222-222222222222",
  createdAt: "2026-11-23T10:00:00.000Z",
  updatedAt: "2026-11-23T10:05:00.000Z",
};

const MESSAGE = {
  id: "33333333-3333-4333-8333-333333333333",
  role: "user" as const,
  content: "Summarize this.",
  status: "complete" as const,
  sources: [],
  createdAt: "2026-11-23T10:00:00.000Z",
};

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    json: async () => body,
  } as unknown as Response;
}

function apiWith(fetchImpl: jest.Mock, token: string | null = "jwt") {
  const getToken = jest.fn(async () => token);
  const api = createChatApi({
    baseUrl: "https://api.test/",
    getToken,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    timeoutMs: 1_000,
  });
  return { api, getToken };
}

function callAt(fetchImpl: jest.Mock, index = 0): [string, RequestInit] {
  return fetchImpl.mock.calls[index] as unknown as [string, RequestInit];
}

describe("createChatApi", () => {
  it("lists sessions with the Bearer token and no-store header", async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse(200, { sessions: [SESSION] }),
    );
    const { api } = apiWith(fetchImpl);

    await expect(api.listSessions()).resolves.toEqual([SESSION]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = callAt(fetchImpl);
    expect(url).toBe("https://api.test/api/mobile/chat/sessions");
    expect(init.method).toBe("GET");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer jwt");
    expect(headers["Cache-Control"]).toBe("no-store");
  });

  it("creates a scoped session with only one scope id", async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse(201, { session: SESSION }),
    );
    const { api } = apiWith(fetchImpl);

    await api.createSession({ documentId: SESSION.scopeDocumentId! });
    const [url, init] = callAt(fetchImpl);
    expect(url).toBe("https://api.test/api/mobile/chat/sessions");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      documentId: SESSION.scopeDocumentId,
    });
  });

  it("fetches a thread and deletes it", async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          session: { ...SESSION, messages: [MESSAGE] },
        }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const { api } = apiWith(fetchImpl);

    const detail = await api.getSession(SESSION.id);
    expect(detail.messages).toHaveLength(1);
    await expect(api.deleteSession(SESSION.id)).resolves.toBeUndefined();

    expect(callAt(fetchImpl, 1)[0]).toBe(
      `https://api.test/api/mobile/chat/sessions/${SESSION.id}`,
    );
    expect(callAt(fetchImpl, 1)[1].method).toBe("DELETE");
  });

  it("parses a successful turn, including configured false", async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse(200, {
        configured: false,
        sessionId: SESSION.id,
        userMessage: MESSAGE,
        assistantMessage: {
          ...MESSAGE,
          id: "44444444-4444-4444-8444-444444444444",
          role: "assistant",
          content: "Not configured.",
        },
        sources: [],
      }),
    );
    const { api } = apiWith(fetchImpl);

    const turn = await api.sendTurn({
      sessionId: SESSION.id,
      content: "Summarize this.",
    });
    expect(turn.configured).toBe(false);
    expect(turn.assistantMessage.role).toBe("assistant");
    expect(JSON.parse(String(callAt(fetchImpl)[1].body))).toEqual({
      sessionId: SESSION.id,
      content: "Summarize this.",
    });
  });

  it("maps 429, 502 and 503 into retryable UI states", async () => {
    const cases: {
      status: number;
      kind: "rate_limited" | "provider" | "unavailable";
      message: string;
    }[] = [
      {
        status: 429,
        kind: "rate_limited",
        message: "You're sending messages faster than the limit allows.",
      },
      {
        status: 502,
        kind: "provider",
        message: "The AI service rejected the request.",
      },
      {
        status: 503,
        kind: "unavailable",
        message: "The AI service is temporarily unavailable.",
      },
    ];

    for (const item of cases) {
      const fetchImpl = jest.fn(async () =>
        jsonResponse(item.status, { error: item.message }),
      );
      const { api } = apiWith(fetchImpl);
      await expect(
        api.sendTurn({ sessionId: SESSION.id, content: "question" }),
      ).rejects.toMatchObject({
        name: "ChatApiError",
        kind: item.kind,
        status: item.status,
        retryable: true,
        message: item.message,
      });
    }
  });

  it("keeps auth copy fixed even when the route sends other text", async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse(401, { error: "internal token detail" }),
    );
    const { api } = apiWith(fetchImpl);

    await expect(api.listSessions()).rejects.toMatchObject({
      kind: "unauthorized",
      message: CHAT_COPY.SIGNED_OUT,
      retryable: false,
    });
    await expect(api.listSessions()).rejects.toBeInstanceOf(ChatApiError);
  });

  it("maps a transport failure to the network state", async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error("ECONNRESET");
    });
    const { api } = apiWith(fetchImpl);

    await expect(api.listSessions()).rejects.toMatchObject({
      kind: "network",
      retryable: true,
      message: CHAT_COPY.NETWORK,
    });
  });

  it("does not call fetch without a token or a base URL", async () => {
    const missingToken = jest.fn();
    const { api } = apiWith(missingToken, null);
    await expect(api.listSessions()).rejects.toMatchObject({
      kind: "unauthorized",
    });
    expect(missingToken).not.toHaveBeenCalled();

    const noBaseFetch = jest.fn();
    const noBase = createChatApi({
      baseUrl: "  ",
      getToken: async () => "jwt",
      fetchImpl: noBaseFetch as unknown as typeof fetch,
    });
    await expect(noBase.listSessions()).rejects.toMatchObject({
      kind: "config",
    });
    expect(noBaseFetch).not.toHaveBeenCalled();
  });

  it("rejects a session id that is not a UUID without a network call", async () => {
    const fetchImpl = jest.fn();
    const { api } = apiWith(fetchImpl);
    await expect(api.getSession("not-an-id")).rejects.toMatchObject({
      kind: "not_found",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("turns an unreadable success body into one parse error", async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(200, { nope: true }));
    const { api } = apiWith(fetchImpl);
    await expect(api.listSessions()).rejects.toMatchObject({
      kind: "parse",
      retryable: true,
      message: CHAT_COPY.PARSE,
    });
  });

  it("maps a foreign/missing thread to not_found", async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse(404, { error: CHAT_COPY.NOT_FOUND }),
    );
    const { api } = apiWith(fetchImpl);
    await expect(api.getSession(SESSION.id)).rejects.toMatchObject({
      kind: "not_found",
      status: 404,
      message: CHAT_COPY.NOT_FOUND,
    });
  });
});
