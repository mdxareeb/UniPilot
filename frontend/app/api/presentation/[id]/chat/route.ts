/**
 * Task D8 — the streaming chat proxy (spec §7.8, §5.4 "AI chat edits").
 *
 * POST /api/presentation/{id}/chat  { message, conversationId? }
 * → `text/event-stream` of normalized chat frames, one JSON object per
 *   `data:` line (the vocabulary lives in `lib/presentation/chatFrames.ts`):
 *
 *     { "type": "chunk",    "text": "..." }
 *     { "type": "status",   "status": "..." }
 *     { "type": "trace",    "trace": { kind, round, tool, status, message } }
 *     { "type": "complete", "conversationId": "...", "response": "...",
 *                           "toolCalls": [...] }
 *     { "type": "error",    "message": "<sanitized copy>" }
 *
 * The route follows the 26.8 precedent (`app/api/assistant/turn/route.ts`):
 * session gate → onboarding gate → ownership read → a `ReadableStream` with a
 * sanitized error frame. It is an API boundary, so every refusal answers JSON
 * statuses rather than redirects, and a malformed or other-user deck id is a
 * plain 404 with no existence oracle.
 *
 * The browser never holds `PRESENTON_API_KEY`: the adapter opens the engine's
 * `POST /api/v1/ppt/chat/message/stream` with the bearer and this route pipes
 * normalized frames. The upstream error frame's `detail` (which may quote an
 * LLM provider) never crosses `normalizeChatFramePayload`, and a mid-stream
 * failure becomes the same sanitized frame. There is no timeout truncation.
 *
 * Abort (upstream workaround, verified 2026-09-19): the client's abort stops
 * frame delivery immediately, but the upstream turn is **drained** rather than
 * hard-cancelled. Closing the engine's stream mid-turn leaves its SQLAlchemy
 * session's SQLite transaction open — every subsequent engine request then
 * fails with `database is locked` until the container is restarted (reproduced
 * against the local engine: aborting after the first `status` frame makes
 * `GET /presentation/all` answer 500). Draining lets the engine settle its
 * session and release the lock; the browser still stops receiving frames the
 * moment it aborts, which is the observable half of propagation. Revisit once
 * upstream handles client disconnect cleanly.
 */
import { sessionUser } from "@/lib/auth/session";
import { getOnboardingState } from "@/lib/data/onboarding";
import { PRESENTATION_NOT_FOUND_ERROR } from "@/lib/data/presentationErrors";
import { getPresentation } from "@/lib/data/presentations";
import { isPresentationUuid } from "@/lib/data/presentationValues";
import { streamPresentationChat } from "@/lib/integrations/presenton";
import {
  CHAT_ERROR_COPY,
  CHAT_MESSAGE_MAX_LENGTH,
  frameToSse,
  normalizeChatFramePayload,
} from "@/lib/presentation/chatFrames";

const SIGN_IN_ERROR = "Sign in to edit this deck with the assistant.";
const ONBOARDING_ERROR = "Finish onboarding before using the deck assistant.";
const INVALID_MESSAGE_ERROR = "Type a message for the deck assistant.";
const CHAT_UNAVAILABLE_ERROR =
  "The deck assistant couldn't be reached. Try again in a moment.";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { user } = await sessionUser();
  if (!user) {
    return jsonError(SIGN_IN_ERROR, 401);
  }

  const state = await getOnboardingState(user.id);
  if (!state.completed) {
    return jsonError(ONBOARDING_ERROR, 403);
  }

  const { id } = await params;
  const presentationId = id.trim();
  if (!isPresentationUuid(presentationId)) {
    return jsonError(PRESENTATION_NOT_FOUND_ERROR, 404);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(INVALID_MESSAGE_ERROR, 400);
  }
  const record =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};
  const message = typeof record.message === "string" ? record.message.trim() : "";
  if (message === "" || message.length > CHAT_MESSAGE_MAX_LENGTH) {
    return jsonError(INVALID_MESSAGE_ERROR, 400);
  }
  let conversationId: string | null = null;
  if (record.conversationId !== undefined && record.conversationId !== null) {
    const raw =
      typeof record.conversationId === "string"
        ? record.conversationId.trim()
        : "";
    if (!UUID_PATTERN.test(raw)) {
      return jsonError(INVALID_MESSAGE_ERROR, 400);
    }
    conversationId = raw;
  }

  let presentation: Awaited<ReturnType<typeof getPresentation>>;
  try {
    presentation = await getPresentation(user.id, presentationId);
  } catch {
    // A data-store failure is not "not found": answer the same JSON envelope
    // every other refusal uses instead of letting Next render an HTML 500.
    return jsonError(CHAT_UNAVAILABLE_ERROR, 500);
  }
  if (presentation === null) {
    return jsonError(PRESENTATION_NOT_FOUND_ERROR, 404);
  }
  const engineDeckId = presentation.presentonPresentationId;
  if (!engineDeckId) {
    return jsonError(PRESENTATION_NOT_FOUND_ERROR, 404);
  }

  /* Abort propagation (with the drain workaround above): the moment the
     client goes away, frame delivery stops — but the upstream fetch keeps
     running to completion so the engine releases its SQLite transaction. */
  let delivering = true;
  const stopDelivery = () => {
    delivering = false;
  };
  if (request.signal.aborted) stopDelivery();
  else request.signal.addEventListener("abort", stopDelivery, { once: true });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const payload of streamPresentationChat({
          presentationId: engineDeckId,
          message,
          conversationId,
        })) {
          if (!delivering) continue;
          const frame = normalizeChatFramePayload(payload);
          if (frame !== null) {
            controller.enqueue(encoder.encode(frameToSse(frame)));
          }
        }
      } catch {
        if (delivering) {
          try {
            controller.enqueue(
              encoder.encode(
                frameToSse({ type: "error", message: CHAT_ERROR_COPY }),
              ),
            );
          } catch {
            // The consumer cancelled between the abort and this frame.
          }
        }
      } finally {
        request.signal.removeEventListener("abort", stopDelivery);
        try {
          controller.close();
        } catch {
          // The consumer already cancelled the stream.
        }
      }
    },
    cancel() {
      stopDelivery();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
