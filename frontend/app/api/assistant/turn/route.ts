/**
 * Task 26.8 — the streaming turn endpoint.
 *
 * POST /api/assistant/turn  { conversationId?: string | null, content: string }
 * → `text/event-stream` of `AssistantStreamFrame`s, one JSON object per
 *   `data:` line:
 *
 *     { "type": "start",  "conversationId": "...", "configured": false }
 *     { "type": "delta",  "text": "..." }
 *     { "type": "sources","sources": [{ documentId, documentName, page, … }] }
 *     { "type": "done",   "status": "complete" | "failed" | "unconfigured",
 *                         "messageId": "..." }
 *     { "type": "error",  "error": "<sanitized copy>" }
 *
 * This is the exact contract 19.x consumes; every frame is produced by the
 * server pipeline, and no frame ever carries provider or database internals.
 * The route is an API boundary, so auth failures answer JSON statuses rather
 * than redirects.
 */
import { sessionUser } from "@/lib/auth/session";
import { getOnboardingState } from "@/lib/data/onboarding";
import {
  ASSISTANT_COPY,
  streamAssistantTurn,
  type AssistantStreamFrame,
} from "@/lib/data/assistant";

function frameToSse(frame: AssistantStreamFrame): string {
  return `data: ${JSON.stringify(frame)}\n\n`;
}

export async function POST(request: Request): Promise<Response> {
  const { user } = await sessionUser();
  if (!user) {
    return Response.json(
      { error: "Sign in to use the assistant." },
      { status: 401 },
    );
  }

  const state = await getOnboardingState(user.id);
  if (!state.completed) {
    return Response.json(
      { error: "Finish onboarding before using the assistant." },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: ASSISTANT_COPY.INVALID }, { status: 400 });
  }
  const record =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};
  const content = typeof record.content === "string" ? record.content : "";
  const conversationId =
    typeof record.conversationId === "string" &&
    record.conversationId.trim() !== ""
      ? record.conversationId.trim()
      : null;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const frame of streamAssistantTurn(user.id, {
          conversationId,
          content,
        })) {
          controller.enqueue(encoder.encode(frameToSse(frame)));
        }
      } catch {
        controller.enqueue(
          encoder.encode(
            frameToSse({ type: "error", error: ASSISTANT_COPY.FAILED }),
          ),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
