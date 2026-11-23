/**
 * The Bearer client for Ask AI's Phase 2 endpoints.
 *
 * The Supabase session's access token is the only credential; it travels in
 * the Authorization header and is never logged. Every response is parsed by
 * the client-safe validators before the UI sees it. Failures become one
 * `ChatApiError` whose copy is already sanitized for a screen.
 */
import {
  parseSessionDetail,
  parseSessionList,
  parseSessionResponse,
  parseTurnResponse,
  type ChatSessionDetail,
  type ChatSessionSummary,
  type ChatTurnResponse,
} from "./chatValues";
import {
  ChatApiError,
  chatErrorFromConfig,
  chatErrorFromNetwork,
  chatErrorFromParse,
  chatErrorFromResponse,
} from "./chatErrors";

const ROOT = "/api/mobile/chat";
const DEFAULT_TIMEOUT_MS = 60_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ChatApi = {
  listSessions: () => Promise<ChatSessionSummary[]>;
  createSession: (scope: {
    subjectId?: string;
    documentId?: string;
  }) => Promise<ChatSessionSummary>;
  getSession: (sessionId: string) => Promise<ChatSessionDetail>;
  deleteSession: (sessionId: string) => Promise<void>;
  sendTurn: (input: {
    sessionId: string;
    content: string;
  }) => Promise<ChatTurnResponse>;
};

export function createChatApi(deps: {
  baseUrl: string;
  getToken: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): ChatApi {
  const base = deps.baseUrl.trim().replace(/\/+$/, "");
  const doFetch = deps.fetchImpl ?? fetch;

  async function call(
    path: string,
    init: { method: "GET" | "POST" | "DELETE"; body?: unknown } = {
      method: "GET",
    },
  ): Promise<{ status: number; json: unknown }> {
    if (base === "") throw chatErrorFromConfig();

    const token = await deps.getToken();
    if (token === null || token === "") {
      throw new ChatApiError("unauthorized", "Sign in again to continue.");
    }

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      deps.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );

    let response: Response;
    try {
      response = await doFetch(`${base}${ROOT}${path}`, {
        method: init.method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Cache-Control": "no-store",
          ...(init.body === undefined
            ? null
            : { "Content-Type": "application/json" }),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: controller.signal,
      });
    } catch {
      throw chatErrorFromNetwork();
    } finally {
      clearTimeout(timer);
    }

    let json: unknown = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    return { status: response.status, json };
  }

  function expectId(sessionId: string): void {
    if (!UUID_PATTERN.test(sessionId)) {
      throw new ChatApiError("not_found", "That chat no longer exists.", {
        status: 404,
      });
    }
  }

  return {
    async listSessions() {
      const { status, json } = await call("/sessions");
      if (status !== 200) throw chatErrorFromResponse(status, json);
      const sessions = parseSessionList(json);
      if (sessions === null) throw chatErrorFromParse();
      return sessions;
    },

    async createSession(scope) {
      const { status, json } = await call("/sessions", {
        method: "POST",
        body: scope,
      });
      if (status !== 200 && status !== 201) {
        throw chatErrorFromResponse(status, json);
      }
      const session = parseSessionResponse(json);
      if (session === null) throw chatErrorFromParse();
      return session;
    },

    async getSession(sessionId) {
      expectId(sessionId);
      const { status, json } = await call(`/sessions/${sessionId}`);
      if (status !== 200) throw chatErrorFromResponse(status, json);
      const session = parseSessionDetail(json);
      if (session === null) throw chatErrorFromParse();
      return session;
    },

    async deleteSession(sessionId) {
      expectId(sessionId);
      const { status, json } = await call(`/sessions/${sessionId}`, {
        method: "DELETE",
      });
      if (status !== 200) throw chatErrorFromResponse(status, json);
      const ok =
        typeof json === "object" &&
        json !== null &&
        (json as { ok?: unknown }).ok === true;
      if (!ok) throw chatErrorFromParse();
    },

    async sendTurn(input) {
      expectId(input.sessionId);
      const { status, json } = await call("", {
        method: "POST",
        body: { sessionId: input.sessionId, content: input.content },
      });
      if (status !== 200) throw chatErrorFromResponse(status, json);
      const turn = parseTurnResponse(json);
      if (turn === null) throw chatErrorFromParse();
      return turn;
    },
  };
}
