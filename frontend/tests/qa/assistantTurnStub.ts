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
 * `chunks` are raw SSE writes, so the caller controls exactly what arrives:
 * whole `data: <json>\n\n` frames, one frame split across two entries (the
 * split-frame case), malformed blocks that must be dropped, anything.
 * `holdAfter` stops the response after that many writes until `release()` —
 * which is how a test observes a genuinely in-flight turn (mid-stream
 * rendering, double-send blocking) instead of guessing at timing.
 *
 * The stub counts requests (`requestCount()`), so a double-send is proven by
 * the second POST never arriving, not by an UI count alone.
 */
import { createServer, type Server } from "node:http";
import type { Page, Route } from "@playwright/test";

/** The exact path the UI posts a turn to. */
export const ASSISTANT_TURN_ROUTE = "**/api/assistant/turn";

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
  /** Lets a held response continue (a no-op when nothing is held). */
  release(): void;
  /** Removes the interception and shuts the loopback server down. */
  dispose(): Promise<void>;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    request.resume();

    if (request.method === "OPTIONS") {
      response.writeHead(204, cors);
      response.end();
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(405, cors);
      response.end();
      return;
    }

    requests += 1;
    void (async () => {
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
    })();
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  if (port <= 0) {
    server.close();
    throw new Error("assistant turn stub failed to bind a loopback port");
  }

  const handler = (route: Route) =>
    route.continue({ url: `http://127.0.0.1:${port}/stub/assistant-turn` });
  await page.route(ASSISTANT_TURN_ROUTE, handler);

  return {
    requestCount: () => requests,
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
}
