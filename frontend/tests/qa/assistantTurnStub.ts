/**
 * tests/qa/assistantTurnStub.ts — C3's per-test UI-level SSE stub for
 * `POST /api/assistant/turn`.
 *
 * The UI's streaming turn (19.10) needs a provider-like stream in the browser:
 * real chunks arriving at real intervals, a frame split across a chunk
 * boundary, a `sources` frame, and terminal `done`/`error` frames. Playwright's
 * `route.fulfill` writes a fulfilled body in one piece, so it cannot produce
 * that. This helper therefore follows the repo's proven streaming-stub pattern
 * (`presentations-ui.spec.ts`, the D8 chat panel): one loopback HTTP server
 * writes the crafted chunks with an optional pause, and `page.route` intercepts
 * the page's own POST to `**\/api/assistant/turn`, continuing it to the stub.
 * The request never leaves the machine, nothing is persisted, and the
 * interception and server are torn down by `dispose()` — no leakage across
 * tests.
 *
 * Local development fixture story (19.13): local development deliberately has
 * no AI provider configured (26.1), so the real route is itself the first
 * fixture — `POST /api/assistant/turn` streams the honest `unconfigured` copy
 * through the complete production path (auth, persistence, SSE framing, the
 * client reducer) with no model and no fake data anywhere in the app. This
 * stub is the second, test-level fixture: it exercises the *configured* frame
 * vocabulary (deltas, split frames, sources, terminal statuses, transport
 * failures) that no configured provider exists locally to produce. It lives in
 * `tests/qa/`, is never imported by application code, never enters the app
 * bundle, and persists nothing; there is no fake-data path in the product.
 *
 * `chunks` are raw SSE writes, so the caller controls exactly what arrives:
 * whole `data: <json>\n\n` frames, one frame split across two entries (the
 * split-frame case), malformed blocks that must be dropped, anything.
 * `holdAfter` stops the response after that many writes until `release()` —
 * which is how a test observes a genuinely in-flight turn (mid-stream
 * rendering, double-send blocking, and a stream that never closes) instead of
 * guessing at timing.
 *
 * The stub counts requests (`requestCount()`), so a double-send is proven by
 * the second POST never arriving, not by an UI count alone. It also records
 * each request's parsed body (`requests()`), which is how the 19.16 launcher
 * case proves a follow-up send targets the conversation the `start` frame
 * announced rather than starting a new one.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { Page, Route } from "@playwright/test";

/** The exact path the UI posts a turn to. */
export const ASSISTANT_TURN_ROUTE = "**/api/assistant/turn";

/** The parsed body of one POST that reached the stub. */
export type AssistantTurnRequest = {
  /** Exactly what the UI aimed the turn at (`null` = start a conversation). */
  conversationId: string | null;
  /** The exact typed content the UI sent. */
  content: string;
};

export type AssistantTurnStubOptions = {
  /** Raw SSE writes, in order; a frame may be split across entries. */
  chunks: readonly string[];
  /**
   * Hold the response open once this many chunks have been written, until
   * `release()` is called. Default: never hold (the stream ends normally).
   */
  holdAfter?: number;
  /** Pause between chunk writes, so reads really arrive separately. */
  gapMs?: number;
  /** HTTP status for the response (default 200). */
  status?: number;
};

export type AssistantTurnStub = {
  /** How many POSTs have reached the stub so far. */
  requestCount(): number;
  /**
   * The parsed JSON body of every POST that reached the stub, in order — the
   * 19.16 launcher continuity proof reads the second send's `conversationId`
   * here (a follow-up must target the conversation `start` announced).
   */
  requests(): readonly AssistantTurnRequest[];
  /** Lets a held response continue (a no-op when nothing is held). */
  release(): void;
  /** Removes the interception and shuts the loopback server down. */
  dispose(): Promise<void>;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Reads a request body to a string; a stream error resolves what arrived. */
function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      data += chunk;
    });
    request.on("end", () => resolve(data));
    request.on("error", () => resolve(data));
  });
}

/**
 * Parses the route's body contract (`{ conversationId?, content }`) with the
 * same normalization the route applies: a blank/absent id is `null` (start a
 * conversation), and non-string content is `""`.
 */
function parseTurnRequest(raw: string): AssistantTurnRequest {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      return {
        conversationId:
          typeof record.conversationId === "string" &&
          record.conversationId.trim() !== ""
            ? record.conversationId.trim()
            : null,
        content: typeof record.content === "string" ? record.content : "",
      };
    }
  } catch {
    // Not JSON: the stub records an honest empty body rather than guessing.
  }
  return { conversationId: null, content: "" };
}

export async function stubAssistantTurn(
  page: Page,
  options: AssistantTurnStubOptions,
): Promise<AssistantTurnStub> {
  const { chunks, holdAfter, gapMs = 0, status = 200 } = options;

  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  };

  let requests = 0;
  const bodies: AssistantTurnRequest[] = [];
  let released = holdAfter === undefined;
  let releaseGate: (() => void) | null = null;
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });

  const hold = async () => {
    if (holdAfter === undefined || released) return;
    await gate;
  };

  const server: Server = createServer((request, response) => {
    /* A client that aborts the read — the composer's Stop, or a navigation
       while the body is held open — makes the socket's writes fail. Without a
       listener on the response, Node treats that as an unhandled 'error' and
       takes the test process down with it. */
    response.on("error", () => {
      /* The client went away; there is nobody left to write to. */
    });
    if (request.method === "OPTIONS") {
      request.resume();
      response.writeHead(204, cors);
      response.end();
      return;
    }
    if (request.method !== "POST") {
      request.resume();
      response.writeHead(405, cors);
      response.end();
      return;
    }

    void (async () => {
      try {
        /* Read the body before answering so `requests()` is exact: by the time
           the stub has replied, the body it replied to is recorded. */
        bodies.push(parseTurnRequest(await readBody(request)));
        requests += 1;

        response.writeHead(status, {
          ...cors,
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-store",
        });

        let written = 0;
        for (const chunk of chunks) {
          if (holdAfter !== undefined && written === holdAfter) await hold();
          response.write(chunk);
          written += 1;
          if (gapMs > 0) await sleep(gapMs);
        }
        if (holdAfter !== undefined && written === holdAfter) await hold();

        response.end();
      } catch {
        /* The response guard above already covers a vanished client; any
           other throw must not become an unhandled rejection that fails an
           unrelated test. */
      }
    })();
  });

  /* Registration inside a try: a bind or `page.route` failure must not leak
     the loopback server into the rest of the run. */
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address();
    const port =
      typeof address === "object" && address !== null ? address.port : 0;
    if (port <= 0) {
      throw new Error("assistant turn stub failed to bind a loopback port");
    }

    const handler = (route: Route) =>
      route.continue({ url: `http://127.0.0.1:${port}/stub/assistant-turn` });
    await page.route(ASSISTANT_TURN_ROUTE, handler);

    return {
      requestCount: () => requests,
      requests: () => bodies,
      release: () => {
        released = true;
        releaseGate?.();
      },
      dispose: async () => {
        releaseGate?.();
        await page.unroute(ASSISTANT_TURN_ROUTE, handler);
        const closed = new Promise<void>((resolve) => {
          server.close(() => resolve());
        });
        server.closeAllConnections();
        await closed;
      },
    };
  } catch (error) {
    server.closeAllConnections();
    server.close();
    throw error;
  }
}
