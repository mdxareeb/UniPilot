/**
 * The assistant contract's client-safe half (Tasks 26.x/19.x/27.x):
 * message/source vocabulary, bounds, the SSE frame union **and the action
 * log's display vocabulary** — importable by UI and specs without touching
 * the server client. `assistant.ts` (server-only) owns the turn pipeline that
 * produces these values and re-exports the frame type for the route;
 * `assistantActionLog.ts` (server-only) owns the log/executor and re-exports
 * this module's action values so its existing server consumers keep their
 * import path.
 *
 * Why the action values live here: the 27.x confirmation card is a client
 * component. Importing `ASSISTANT_ACTION_COPY` or the item type from
 * `assistantActionLog.ts` would pull `node:crypto`/`next/headers` into the
 * browser bundle (the module's imports are server-only even where a type
 * would be erased); importing them from this module cannot. The item type
 * itself is type-only, and the copy/labels are plain strings — nothing here
 * reads a session or a database.
 */
import type {
  AssistantAction,
  AssistantActionStatus,
  AssistantActionType,
} from "@/lib/ai/actionSchema";

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

// ---------------------------------------------------------------------------
// The action log's client-safe display vocabulary (27.6/27.7)
// ---------------------------------------------------------------------------

/**
 * The sanitized copy the action log/executor and the Server Actions ever
 * return. Moved here from `assistantActionLog.ts` (T27-C) so the confirmation
 * card and the panel can render it without importing the server module.
 *
 * `FAILED` claims "nothing was created" and is therefore only used where that
 * is certain (registration, rejection, an unreadable stored payload).
 * `UNCERTAIN` is the catch-all for a call that may have reached the executor
 * before its response was lost: it never claims the write did not happen
 * (T27-C review hand-off).
 */
export const ASSISTANT_ACTION_COPY = {
  NOT_FOUND: "That action no longer exists.",
  INVALID: "That action couldn't be read, so nothing was created.",
  REJECTED: "This action was rejected, so nothing was created.",
  ALREADY_COMPLETED: "This action has already been completed.",
  UNAVAILABLE: "This action couldn't be completed right now.",
  DOCUMENT_NOT_FOUND:
    "That document isn't in your workspace, so nothing was created.",
  PRESENTATION_NOT_AVAILABLE:
    "Creating presentations from the assistant isn't available yet, so nothing was created.",
  FAILED: "That action couldn't be completed. Nothing was created.",
  UNCERTAIN:
    "That action's result couldn't be confirmed. Check your tasks or calendar before trying again.",
} as const;

/** What a succeeded action created — the settled facts stored in `result`. */
export const ASSISTANT_ACTION_OUTCOME_KINDS = [
  "task",
  "event",
  "presentation",
] as const;
export type AssistantActionOutcomeKind =
  (typeof ASSISTANT_ACTION_OUTCOME_KINDS)[number];

export type AssistantActionOutcome = {
  kind: AssistantActionOutcomeKind;
  /** The created row's id. */
  id: string;
  /** The created row's title — the honest name for the confirmation surface. */
  label: string;
};

/** The action's display name (the card's label). */
export const ASSISTANT_ACTION_TYPE_LABELS: Record<AssistantActionType, string> = {
  "task.create": "Task",
  "reminder.create": "Reminder",
  "event.create": "Event",
  "presentation.create": "Presentation",
};

/** The log's status in the confirmation surface's words. */
export const ASSISTANT_ACTION_STATUS_LABELS: Record<
  AssistantActionStatus,
  string
> = {
  proposed: "Proposed",
  confirmed: "Working…",
  rejected: "Dismissed",
  succeeded: "Created",
  failed: "Failed",
};

/** Where a settled outcome's created row lives (the card's link target). */
export const ASSISTANT_ACTION_OUTCOME_HREFS: Record<
  AssistantActionOutcomeKind,
  string
> = {
  task: "/tasks",
  event: "/calendar",
  presentation: "/tools/presentation",
};

/** The card's link label per settled outcome kind. */
export const ASSISTANT_ACTION_OUTCOME_LINK_LABELS: Record<
  AssistantActionOutcomeKind,
  string
> = {
  task: "Open in tasks",
  event: "Open in calendar",
  presentation: "Open in presentations",
};

export type AssistantActionItemBase = {
  id: string;
  status: AssistantActionStatus;
  /** The settled outcome, or null while proposed/confirmed/failed. */
  result: AssistantActionOutcome | null;
  /** Sanitized failure copy, or null. */
  error: string | null;
  messageId: string | null;
  /** The honest one-line copy (`summarizeAssistantAction`) derived from `payload`. */
  summary: string;
  /** Profile-zone display strings, like every other service contract. */
  createdLabel: string;
  settledLabel: string | null;
};

/**
 * The log's display contract: the parsed, normalized payload is carried
 * alongside the settled state so the confirmation UI never re-parses raw
 * jsonb and the executor's values and the card's cannot drift.
 */
export type AssistantActionItem = {
  [K in AssistantActionType]: AssistantActionItemBase & {
    type: K;
    payload: Extract<AssistantAction, { type: K }>["payload"];
  };
}[AssistantActionType];

export type AssistantActionMutationResult = {
  error: string | null;
  /** The settled/current row's contract; null only when no owned row exists. */
  action: AssistantActionItem | null;
};
