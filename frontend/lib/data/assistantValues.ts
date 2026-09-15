/**
 * The assistant contract's client-safe half (Task 26.x): message/source
 * vocabulary and bounds, importable by UI and specs without touching the
 * server client. `assistant.ts` (server-only) owns the turn pipeline that
 * produces these values.
 */

export const MESSAGE_CONTENT_MAX_LENGTH = 4_000;

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
