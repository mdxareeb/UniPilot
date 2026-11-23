/**
 * Ask AI's client-safe wire contract.
 *
 * The mobile app never trusts a response shape: every session, message and
 * citation is validated here before the UI renders it. Invalid shapes become
 * `null` (or are dropped) and surface as one sanitized "unreadable response"
 * error, never as half a thread or a fabricated citation.
 */

export const CHAT_MESSAGE_MAX_LENGTH = 4_000;

export type ChatRole = "user" | "assistant";
export type ChatStatus = "complete" | "failed";

export type ChatSource = {
  documentId: string;
  documentName: string;
  page?: number;
  chunkIndex: number;
  snippet: string;
};

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  status: ChatStatus;
  sources: ChatSource[];
  createdAt: string;
};

export type ChatSessionSummary = {
  id: string;
  title: string;
  scopeSubjectId: string | null;
  scopeDocumentId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ChatSessionDetail = ChatSessionSummary & {
  messages: ChatMessage[];
};

export type ChatTurnResponse = {
  configured: boolean;
  sessionId: string;
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
  sources: ChatSource[];
};

export const CHAT_COPY = {
  NOT_CONNECTED:
    "This build isn't connected to the UniPilot server, so Ask AI can't load or answer anything.",
  AI_NOT_CONFIGURED:
    "The AI assistant isn't configured on the server yet. An administrator needs to add the Gemini key before questions can be answered.",
  STATUS_UNKNOWN:
    "Couldn't check whether the assistant is configured. Questions may fail until the connection recovers.",
  NO_MATERIALS:
    "Ask AI answers from your indexed course materials. Upload or sync a course file first, then come back.",
  WORKSPACE_ERROR: "Couldn't load your courses and materials. Try again.",
  MATERIALS_LINK: "Open Course Materials",
  THREAD_ERROR: "Couldn't load that conversation. Try again.",
  HISTORY_ERROR: "Couldn't load your chat history. Try again.",
  DELETE_ERROR: "Couldn't delete that chat. Try again.",
  SEND_FAILED:
    "The study assistant couldn't answer that just now. Please try again.",
  NETWORK:
    "Couldn't reach the study assistant. Check your connection and try again.",
  RATE_LIMITED:
    "You're sending messages faster than the limit allows. Wait a moment and try again.",
  UNAVAILABLE:
    "The study assistant is temporarily unavailable. Try again in a moment.",
  PROVIDER:
    "The assistant's AI service rejected the answer. Try again in a moment.",
  SIGNED_OUT: "Sign in again to continue.",
  FORBIDDEN: "Finish setting up your account first.",
  INVALID: "That message couldn't be sent. Check the question and try again.",
  NOT_FOUND: "That chat no longer exists.",
  SERVER: "Something went wrong. Please try again.",
  PARSE: "The assistant returned an unreadable response. Please try again.",
  GENERIC: "Something went wrong. Please try again.",
  THINKING: "Reading your materials…",
  COMPOSER_PLACEHOLDER: "Ask about your course materials…",
  EMPTY_THREAD_TITLE: "Grounded study chat",
  EMPTY_THREAD_BODY:
    "Ask about a concept, a deadline or an exam, and open the exact material behind every answer.",
  HISTORY_TITLE: "History",
  HISTORY_SUBTITLE: "Your previous Ask AI threads",
  NEW_CHAT: "New Chat",
  DELETE_CHAT: "Delete chat",
  DELETE_CONFIRM_TITLE: "Delete this chat?",
  DELETE_CONFIRM_BODY:
    "This removes the thread and its messages from your account. It cannot be undone.",
  CANCEL: "Cancel",
  OPEN_DOCUMENT: "Open Document",
  SOURCE: "Source",
  SOURCES: "Sources",
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSource(value: unknown): ChatSource | null {
  if (!isRecord(value)) return null;
  const { documentId, documentName, page, chunkIndex, snippet } = value;
  if (
    typeof documentId !== "string" ||
    documentId.trim() === "" ||
    typeof documentName !== "string" ||
    typeof chunkIndex !== "number" ||
    !Number.isFinite(chunkIndex) ||
    chunkIndex < 0 ||
    typeof snippet !== "string"
  ) {
    return null;
  }

  const source: ChatSource = {
    documentId,
    documentName,
    chunkIndex,
    snippet,
  };
  if (typeof page === "number" && Number.isFinite(page) && page > 0) {
    source.page = page;
  }
  return source;
}

export function parseChatSources(value: unknown): ChatSource[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => parseSource(entry))
    .filter((entry): entry is ChatSource => entry !== null);
}

function parseMessage(value: unknown): ChatMessage | null {
  if (!isRecord(value)) return null;
  const { id, role, content, status, sources, createdAt } = value;
  if (
    typeof id !== "string" ||
    id.trim() === "" ||
    (role !== "user" && role !== "assistant") ||
    typeof content !== "string" ||
    (status !== "complete" && status !== "failed") ||
    typeof createdAt !== "string"
  ) {
    return null;
  }
  return {
    id,
    role,
    content,
    status,
    sources: parseChatSources(sources),
    createdAt,
  };
}

function parseSession(value: unknown): ChatSessionSummary | null {
  if (!isRecord(value)) return null;
  const {
    id,
    title,
    scopeSubjectId,
    scopeDocumentId,
    createdAt,
    updatedAt,
  } = value;
  if (
    typeof id !== "string" ||
    id.trim() === "" ||
    typeof title !== "string" ||
    (scopeSubjectId !== null && typeof scopeSubjectId !== "string") ||
    (scopeDocumentId !== null && typeof scopeDocumentId !== "string") ||
    typeof createdAt !== "string" ||
    typeof updatedAt !== "string"
  ) {
    return null;
  }
  return {
    id,
    title,
    scopeSubjectId,
    scopeDocumentId,
    createdAt,
    updatedAt,
  };
}

export function parseSessionList(value: unknown): ChatSessionSummary[] | null {
  if (!isRecord(value) || !Array.isArray(value.sessions)) return null;
  const sessions = value.sessions
    .map((entry) => parseSession(entry))
    .filter((entry): entry is ChatSessionSummary => entry !== null);
  return sessions.length === value.sessions.length ? sessions : null;
}

export function parseSessionResponse(
  value: unknown,
): ChatSessionSummary | null {
  if (!isRecord(value)) return null;
  return parseSession(value.session);
}

export function parseSessionDetail(
  value: unknown,
): ChatSessionDetail | null {
  if (!isRecord(value) || !isRecord(value.session)) return null;
  const session = parseSession(value.session);
  if (session === null || !Array.isArray(value.session.messages)) return null;

  const messages = value.session.messages
    .map((entry) => parseMessage(entry))
    .filter((entry): entry is ChatMessage => entry !== null);
  if (messages.length !== value.session.messages.length) return null;

  return { ...session, messages };
}

export function parseTurnResponse(value: unknown): ChatTurnResponse | null {
  if (!isRecord(value)) return null;
  const { configured, sessionId, userMessage, assistantMessage, sources } =
    value;
  if (typeof configured !== "boolean" || typeof sessionId !== "string") {
    return null;
  }
  const user = parseMessage(userMessage);
  const assistant = parseMessage(assistantMessage);
  if (user === null || assistant === null) return null;

  return {
    configured,
    sessionId,
    userMessage: user,
    assistantMessage: assistant,
    sources: parseChatSources(sources),
  };
}

/** The client-side title rule, matching the server's first-question rule. */
export function titleFromQuestion(content: string): string {
  const collapsed = content.trim().replace(/\s+/g, " ");
  if (collapsed === "") return "New chat";
  return collapsed.length > 60
    ? `${collapsed.slice(0, 57).trimEnd()}…`
    : collapsed;
}
