/**
 * Ask AI's study-chat service (server-only).
 *
 * Reads use the caller's Bearer client, so the owner RLS policies are the
 * authority. Messages are written with the service client because the
 * migration revoked INSERT/UPDATE/DELETE on `ai_chat_messages` from
 * `authenticated`: only the server may decide a message's role, status and
 * citations. Every service write is still preceded by an owner-scoped read of
 * the parent session.
 *
 * One turn follows the web assistant's honest branches, with course scoping:
 *
 *   - validate + rate/spend guards (`checkAssistantLimits`, shared ledger);
 *   - verify the session belongs to the caller (foreign id = not found);
 *   - persist the user turn, then retrieve chunks narrowed by the session's
 *     subject/document scope (keyword + bounded recency fallback);
 *   - no Gemini pair → persist the unconfigured answer, never fabricate;
 *   - no chunks → persist the empty-retrieval answer, no paid call;
 *   - otherwise ask Gemini with the shared system prompt/context contract and
 *     persist the answer plus `{documentId, documentName, page, chunkIndex,
 *     snippet}` citations;
 *   - provider failure → a `failed` assistant message with sanitized copy and
 *     a retryable flag; no provider body is stored or logged.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { createServiceClient } from "@/lib/supabase/service";
import { searchDocumentChunks } from "./search";
import { selectContextChunks } from "@/lib/ai/context";
import { buildChatMessages } from "@/lib/ai/prompt";
import {
  chatWithGemini,
  GeminiChatError,
  geminiChatStatus,
} from "@/lib/ai/geminiChat";
import { checkAssistantLimits, recordAssistantUsage } from "./assistant";
import {
  STUDY_CHAT_COPY,
  STUDY_CHAT_MESSAGE_MAX_LENGTH,
  STUDY_CHAT_SESSIONS_LIMIT,
  STUDY_CHAT_TITLE_MAX_LENGTH,
  buildStudyChatSources,
  titleFromQuestion,
  type StudyChatMessage,
  type StudyChatSessionDetail,
  type StudyChatSessionSummary,
  type StudyChatSource,
  type StudyChatStatus,
} from "./studyChatValues";

export * from "./studyChatValues";

type Client = SupabaseClient<Database>;
type SessionRow = Pick<
  Database["public"]["Tables"]["ai_chat_sessions"]["Row"],
  | "id"
  | "title"
  | "scope_subject_id"
  | "scope_document_id"
  | "created_at"
  | "updated_at"
>;
type MessageRow = Pick<
  Database["public"]["Tables"]["ai_chat_messages"]["Row"],
  "id" | "role" | "content" | "status" | "sources" | "created_at"
>;

const SESSION_COLUMNS =
  "id, title, scope_subject_id, scope_document_id, created_at, updated_at";
const MESSAGE_COLUMNS =
  "id, role, content, status, sources, created_at";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isStudyChatId(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function toSession(row: SessionRow): StudyChatSessionSummary {
  return {
    id: row.id,
    title: row.title ?? "New chat",
    scopeSubjectId: row.scope_subject_id,
    scopeDocumentId: row.scope_document_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSources(value: Json | null): StudyChatSource[] {
  if (!Array.isArray(value)) return [];
  const sources: StudyChatSource[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const { documentId, documentName, page, chunkIndex, snippet } = item;
    if (
      typeof documentId !== "string" ||
      typeof documentName !== "string" ||
      typeof chunkIndex !== "number" ||
      typeof snippet !== "string"
    ) {
      continue;
    }
    const source: StudyChatSource = {
      documentId,
      documentName,
      chunkIndex,
      snippet,
    };
    if (typeof page === "number") source.page = page;
    sources.push(source);
  }
  return sources;
}

function toMessage(row: MessageRow): StudyChatMessage {
  return {
    id: row.id,
    role: row.role === "assistant" ? "assistant" : "user",
    content: row.content,
    status: row.status === "failed" ? "failed" : "complete",
    sources: parseSources(row.sources),
    createdAt: row.created_at,
  };
}

/** A title is optional on create, but never an unbounded or blank string. */
export function parseStudyChatTitle(
  value: unknown,
): { ok: true; title: string | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, title: null };
  if (typeof value !== "string") return { ok: false };
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > STUDY_CHAT_TITLE_MAX_LENGTH) {
    return { ok: false };
  }
  return { ok: true, title: trimmed };
}

/** Both scope columns may be absent; both present is the one invalid shape. */
export function parseStudyChatScope(input: {
  subjectId?: unknown;
  documentId?: unknown;
}):
  | { ok: true; subjectId: string | null; documentId: string | null }
  | { ok: false; reason: "both" | "malformed" } {
  const subject = input.subjectId;
  const document = input.documentId;

  if (subject !== undefined && subject !== null && typeof subject !== "string") {
    return { ok: false, reason: "malformed" };
  }
  if (
    document !== undefined &&
    document !== null &&
    typeof document !== "string"
  ) {
    return { ok: false, reason: "malformed" };
  }

  const subjectId = typeof subject === "string" ? subject.trim() : "";
  const documentId = typeof document === "string" ? document.trim() : "";

  if (subjectId !== "" && documentId !== "") {
    return { ok: false, reason: "both" };
  }
  if (
    (subjectId !== "" && !UUID_PATTERN.test(subjectId)) ||
    (documentId !== "" && !UUID_PATTERN.test(documentId))
  ) {
    return { ok: false, reason: "malformed" };
  }

  return {
    ok: true,
    subjectId: subjectId === "" ? null : subjectId,
    documentId: documentId === "" ? null : documentId,
  };
}

async function scopeIsOwned(
  client: Client,
  userId: string,
  subjectId: string | null,
  documentId: string | null,
): Promise<boolean> {
  const checks: Promise<boolean>[] = [];

  if (subjectId !== null) {
    checks.push(
      (async () => {
        const { data, error } = await client
          .from("subjects")
          .select("id")
          .eq("id", subjectId)
          .eq("user_id", userId)
          .maybeSingle();
        if (error) throw new Error("Failed to read the subject scope.");
        return data !== null;
      })(),
    );
  }

  if (documentId !== null) {
    checks.push(
      (async () => {
        const { data, error } = await client
          .from("documents")
          .select("id")
          .eq("id", documentId)
          .eq("user_id", userId)
          .maybeSingle();
        if (error) throw new Error("Failed to read the document scope.");
        return data !== null;
      })(),
    );
  }

  const results = await Promise.all(checks);
  return results.every(Boolean);
}

export type CreateStudyChatResult =
  | { status: "ok"; session: StudyChatSessionSummary }
  | { status: "invalid_scope"; reason: "both" | "malformed" }
  | { status: "scope_unavailable" };

export async function createStudyChatSession(
  client: Client,
  userId: string,
  input: {
    title: string | null;
    subjectId: string | null;
    documentId: string | null;
  },
): Promise<CreateStudyChatResult> {
  if (input.subjectId !== null && input.documentId !== null) {
    return { status: "invalid_scope", reason: "both" };
  }

  const owned = await scopeIsOwned(
    client,
    userId,
    input.subjectId,
    input.documentId,
  );
  if (!owned) return { status: "scope_unavailable" };

  const { data, error } = await client
    .from("ai_chat_sessions")
    .insert({
      user_id: userId,
      title: input.title,
      scope_subject_id: input.subjectId,
      scope_document_id: input.documentId,
    })
    .select(SESSION_COLUMNS)
    .single();

  if (error || !data) throw new Error("Failed to create the chat session.");
  return { status: "ok", session: toSession(data) };
}

export async function listStudyChatSessions(
  client: Client,
  userId: string,
): Promise<StudyChatSessionSummary[]> {
  const { data, error } = await client
    .from("ai_chat_sessions")
    .select(SESSION_COLUMNS)
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .order("id", { ascending: true })
    .limit(STUDY_CHAT_SESSIONS_LIMIT);

  if (error) throw new Error("Failed to load chat sessions.");
  return (data ?? []).map(toSession);
}

export async function getStudyChatSession(
  client: Client,
  userId: string,
  sessionId: string,
): Promise<StudyChatSessionDetail | null> {
  if (!UUID_PATTERN.test(sessionId)) return null;

  const { data: session, error } = await client
    .from("ai_chat_sessions")
    .select(SESSION_COLUMNS)
    .eq("id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error("Failed to load the chat session.");
  if (!session) return null;

  const messages = await client
    .from("ai_chat_messages")
    .select(MESSAGE_COLUMNS)
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (messages.error) throw new Error("Failed to load the chat messages.");

  return {
    ...toSession(session),
    messages: (messages.data ?? []).map(toMessage),
  };
}

/** Owner-scoped delete; a foreign or missing id is indistinguishable. */
export async function deleteStudyChatSession(
  client: Client,
  userId: string,
  sessionId: string,
): Promise<boolean> {
  if (!UUID_PATTERN.test(sessionId)) return false;

  const { data, error } = await client
    .from("ai_chat_sessions")
    .delete()
    .eq("id", sessionId)
    .eq("user_id", userId)
    .select("id");
  if (error) throw new Error("Failed to delete the chat session.");
  return (data ?? []).length > 0;
}

type MessageInsert = {
  role: "user" | "assistant";
  content: string;
  status?: StudyChatStatus;
  sources?: StudyChatSource[];
};

async function insertMessage(
  service: Client,
  sessionId: string,
  input: MessageInsert,
): Promise<StudyChatMessage> {
  const { data, error } = await service
    .from("ai_chat_messages")
    .insert({
      session_id: sessionId,
      role: input.role,
      content: input.content,
      status: input.status ?? "complete",
      sources:
        input.sources === undefined
          ? null
          : (input.sources as unknown as Json),
    })
    .select(MESSAGE_COLUMNS)
    .single();
  if (error || !data) throw new Error("Failed to persist the chat message.");
  return toMessage(data);
}

async function touchSession(
  service: Client,
  sessionId: string,
  userId: string,
): Promise<void> {
  const { error } = await service
    .from("ai_chat_sessions")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", sessionId)
    .eq("user_id", userId);
  if (error) console.error("study chat session touch failed");
}

export type StudyChatTurnResult =
  | {
      status: "ok";
      configured: boolean;
      sessionId: string;
      userMessage: StudyChatMessage;
      assistantMessage: StudyChatMessage;
      sources: StudyChatSource[];
    }
  | { status: "invalid"; error: string; sessionId: string }
  | { status: "not_found"; error: string; sessionId: string }
  | { status: "limited"; error: string; sessionId: string }
  | {
      status: "provider_error";
      error: string;
      retryable: boolean;
      sessionId: string;
      userMessage: StudyChatMessage;
      assistantMessage: StudyChatMessage;
      sources: [];
    };

/**
 * One Ask AI turn. The session must already belong to the caller; content is
 * validated here as well as at the route boundary.
 */
export async function runStudyChatTurn(options: {
  client: Client;
  userId: string;
  sessionId: string;
  content: string;
}): Promise<StudyChatTurnResult> {
  const { client, userId, sessionId } = options;

  const content = options.content.trim();
  if (
    content === "" ||
    content.length > STUDY_CHAT_MESSAGE_MAX_LENGTH
  ) {
    return { status: "invalid", error: STUDY_CHAT_COPY.INVALID, sessionId };
  }

  const limits = await checkAssistantLimits(userId);
  if (!limits.ok) {
    return { status: "limited", error: limits.copy, sessionId };
  }

  if (!UUID_PATTERN.test(sessionId)) {
    return {
      status: "not_found",
      error: STUDY_CHAT_COPY.NOT_FOUND,
      sessionId,
    };
  }

  const { data: session, error: sessionError } = await client
    .from("ai_chat_sessions")
    .select(SESSION_COLUMNS)
    .eq("id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (sessionError) throw new Error("Failed to load the chat session.");
  if (!session) {
    return {
      status: "not_found",
      error: STUDY_CHAT_COPY.NOT_FOUND,
      sessionId,
    };
  }

  const service = createServiceClient();
  const userMessage = await insertMessage(service, sessionId, {
    role: "user",
    content,
  });
  await recordAssistantUsage(userId, [
    { kind: "assistant_turn", quantity: 1 },
  ]);

  // The first question names an untitled thread; the title stays user-owned
  // (the route still allows an explicit rename on create).
  if (session.title === null) {
    await service
      .from("ai_chat_sessions")
      .update({ title: titleFromQuestion(content) })
      .eq("id", sessionId)
      .eq("user_id", userId);
  }

  const finish = async (): Promise<void> => {
    await touchSession(service, sessionId, userId);
  };

  // No provider pair: answer honestly and never pay for a call. This is
  // checked before retrieval because the answer does not depend on sources.
  if (!geminiChatStatus().configured) {
    const assistantMessage = await insertMessage(service, sessionId, {
      role: "assistant",
      content: STUDY_CHAT_COPY.UNCONFIGURED,
      status: "complete",
    });
    await finish();
    return {
      status: "ok",
      configured: false,
      sessionId,
      userMessage,
      assistantMessage,
      sources: [],
    };
  }

  const hits = await searchDocumentChunks({
    query: content,
    limit: 10,
    documentId: session.scope_document_id ?? undefined,
    subjectId: session.scope_subject_id ?? undefined,
    fallback: "recent",
  });
  const chunks = selectContextChunks(hits);
  const sources = buildStudyChatSources(hits, chunks);

  if (chunks.length === 0) {
    const assistantMessage = await insertMessage(service, sessionId, {
      role: "assistant",
      content: STUDY_CHAT_COPY.EMPTY_RETRIEVAL,
      status: "complete",
    });
    await finish();
    return {
      status: "ok",
      configured: true,
      sessionId,
      userMessage,
      assistantMessage,
      sources: [],
    };
  }

  try {
    const result = await chatWithGemini({
      messages: buildChatMessages({ userContent: content, context: chunks }),
    });
    const text = result.text.trim();
    if (text === "") {
      throw new GeminiChatError(
        "invalid_response",
        STUDY_CHAT_COPY.FAILED,
        true,
      );
    }

    const assistantMessage = await insertMessage(service, sessionId, {
      role: "assistant",
      content: text,
      status: "complete",
      sources,
    });
    await recordAssistantUsage(userId, [
      {
        kind: "assistant_tokens",
        quantity: result.usage.promptTokens + result.usage.completionTokens,
      },
    ]);
    await finish();

    return {
      status: "ok",
      configured: true,
      sessionId,
      userMessage,
      assistantMessage,
      sources,
    };
  } catch (error) {
    const providerError =
      error instanceof GeminiChatError
        ? error
        : new GeminiChatError("unavailable", STUDY_CHAT_COPY.FAILED, true);
    const assistantMessage = await insertMessage(service, sessionId, {
      role: "assistant",
      content: providerError.message,
      status: "failed",
    });
    await finish();
    return {
      status: "provider_error",
      error: providerError.message,
      retryable: providerError.retryable,
      sessionId,
      userMessage,
      assistantMessage,
      sources: [],
    };
  }
}
