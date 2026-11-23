/**
 * POST /api/mobile/chat — one grounded Ask AI turn.
 *
 * Body: `{ sessionId: string, content: string }`
 * → `{ configured, sessionId, userMessage, assistantMessage, sources }`
 *
 * The turn is run by `runStudyChatTurn` (owner-scoped session, shared rate and
 * token guards, subject/document-scoped retrieval, Gemini, persisted
 * citations). Failures keep the vocabulary honest:
 *
 *   400 invalid body       401 no/expired token      403 onboarding unfinished
 *   404 missing/foreign id 429 rate or spend guard   503 provider retryable
 *   502 provider rejection 500 unexpected server error
 *
 * No provider response body is ever returned or logged.
 *
 * `createChatPost` exposes the same handler with injectable dependencies so
 * the route's status mapping can be tested without calling a live provider or
 * writing fake rows just to trip a guard.
 */
import { authenticateBearer, noStoreJson } from "@/lib/auth/apiAuth";
import {
  isStudyChatId,
  runStudyChatTurn,
  STUDY_CHAT_COPY,
} from "@/lib/data/studyChat";

export type ChatRouteDependencies = {
  authenticate: typeof authenticateBearer;
  runTurn: typeof runStudyChatTurn;
};

const defaults: ChatRouteDependencies = {
  authenticate: authenticateBearer,
  runTurn: runStudyChatTurn,
};

export function createChatPost(
  dependencies: ChatRouteDependencies = defaults,
): (request: Request) => Promise<Response> {
  return async function POST(request: Request): Promise<Response> {
    const auth = await dependencies.authenticate(request);
    if (!auth.ok) return auth.response;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return noStoreJson({ error: STUDY_CHAT_COPY.INVALID }, 400);
    }
    const record =
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>)
        : {};
    const sessionId =
      typeof record.sessionId === "string" ? record.sessionId.trim() : "";
    const content = typeof record.content === "string" ? record.content : "";

    if (!isStudyChatId(sessionId)) {
      return noStoreJson({ error: STUDY_CHAT_COPY.NOT_FOUND }, 404);
    }

    try {
      const result = await dependencies.runTurn({
        client: auth.user.client,
        userId: auth.user.id,
        sessionId,
        content,
      });

      switch (result.status) {
        case "invalid":
          return noStoreJson({ error: result.error }, 400);
        case "not_found":
          return noStoreJson({ error: result.error }, 404);
        case "limited":
          return Response.json(
            { error: result.error },
            {
              status: 429,
              headers: {
                "Cache-Control": "no-store",
                "Retry-After": "60",
              },
            },
          );
        case "provider_error":
          return noStoreJson(
            {
              error: result.error,
              retryable: result.retryable,
              sessionId: result.sessionId,
              userMessage: result.userMessage,
              assistantMessage: result.assistantMessage,
              sources: result.sources,
            },
            result.retryable ? 503 : 502,
          );
        case "ok":
          return noStoreJson({
            configured: result.configured,
            sessionId: result.sessionId,
            userMessage: result.userMessage,
            assistantMessage: result.assistantMessage,
            sources: result.sources,
          });
      }
    } catch {
      return noStoreJson({ error: STUDY_CHAT_COPY.GENERIC }, 500);
    }
  };
}

export const POST = createChatPost();
