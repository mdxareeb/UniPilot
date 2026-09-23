/**
 * The assistant contract's client-safe half (Tasks 26.x/19.x): message/source
 * vocabulary, bounds and the SSE frame union, importable by UI and specs
 * without touching the server client. `assistant.ts` (server-only) owns the
 * turn pipeline that produces these values and re-exports the frame type for
 * the route.
 */

export const MESSAGE_CONTENT_MAX_LENGTH = 4_000;

/**
 * 26.12/19.16 — the sanitized copy a failed assistant turn carries when no
 * more specific message exists (a transport failure, a truncated stream, a
 * missing response body). Client-safe by construction: the server pipeline
 * re-exports it as `ASSISTANT_COPY.FAILED`, and the global chrome (the
 * launcher's `failedCopy` prop) imports it from here, so the two shells do
 * not pull the service client, retrieval or provider modules for one string.
 */
export const ASSISTANT_FAILED_COPY =
  "The assistant couldn't answer that just now. Please try again.";

export type MessageRole = "user" | "assistant" | "system";
export type MessageStatus = "complete" | "failed";

/** One cited workspace chunk (26.7). */
export type AssistantSource = {
  documentId: string;
  documentName: string;
  page?: number;
  chunkIndex: number;
};

export type MessageItem = {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  status: MessageStatus;
  /** Present only when the assistant cited sources. */
  sources?: AssistantSource[];
  createdLabel: string;
};

/** The terminal statuses a `done` frame can carry (26.8/19.x). */
export type AssistantTurnStatus = "complete" | "failed" | "unconfigured";

/**
 * One SSE frame of the streaming turn contract (26.8), exactly the shapes
 * `POST /api/assistant/turn` emits as `data: <json>\n\n`:
 *
 *   { type: "start",   conversationId, configured }
 *   { type: "delta",   text }
 *   { type: "sources", sources }
 *   { type: "done",    status: "complete" | "failed" | "unconfigured",
 *                      messageId: string | null }
 *   { type: "error",   error }                     // sanitized copy
 *
 * Client-safe: this union is the browser's half of the contract. The parser
 * that turns SSE bytes into these frames lives in `assistantFrames.ts`.
 */
export type AssistantStreamFrame =
  | { type: "start"; conversationId: string; configured: boolean }
  | { type: "delta"; text: string }
  | { type: "sources"; sources: AssistantSource[] }
  | { type: "done"; status: AssistantTurnStatus; messageId: string | null }
  | { type: "error"; error: string };
