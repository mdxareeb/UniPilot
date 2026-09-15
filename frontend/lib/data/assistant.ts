/**
 * Tasks 26.2/26.5/26.6/26.7/26.8/26.10–26.12/26.14/26.15 — the server-only
 * turn pipeline (the chat service).
 *
 * A turn is prepared once (`prepareTurn`): validate + rate-limit, ensure the
 * conversation, persist the user message (service role), retrieve workspace
 * context through 25.x's search (session client = RLS scope) and select it
 * under the 26.6 budget with document/page provenance intact. Then it is
 * answered, either non-streaming (`runAssistantTurn`) or streaming
 * (`streamAssistantTurn`), with the same honest branches:
 *
 *   - no provider configured → the unconfigured copy, persisted complete;
 *   - provider + no retrieved sources → the empty-retrieval copy, no paid
 *     call (26.14);
 *   - provider + sources → strict prompt separation (26.16), timeout/retry
 *     (26.12), sources persisted (26.7), token usage recorded (26.11)
 *     against the documented monthly guard (26.15);
 *   - any provider failure → a `failed` assistant message with sanitized
 *     copy, never a half-answer presented as complete.
 *
 * The streaming generator emits the frame contract the 19.x UI consumes; the
 * route at `/api/assistant/turn` serializes it as SSE. The provider leg is
 * compile-checked against the interface and reachable the moment a provider
 * client is registered — no route or frame changes are needed then.
 */
import {
  resolveChatProvider,
  withTimeoutAndRetries,
  PROVIDER_TIMEOUT_MS,
  type ProviderUsage,
} from "@/lib/ai/provider";
import { buildChatMessages, type AssistantContextChunk } from "@/lib/ai/prompt";
import { selectContextChunks } from "@/lib/ai/context";
import { STRUCTURED_ACTION_INSTRUCTION } from "@/lib/ai/toolContracts";
import { searchDocumentChunks } from "./search";
import { appendMessage } from "./messages";
import {
  createConversation,
  getConversation,
  titleFromFirstMessage,
  touchConversation,
} from "./conversations";
import { createServiceClient } from "@/lib/supabase/service";
import {
  MESSAGE_CONTENT_MAX_LENGTH,
  type AssistantSource,
  type MessageItem,
} from "./assistantValues";

/** 26.10 — per-user turn rate limit. */
export const ASSISTANT_RATE_LIMIT_PER_MINUTE = 10;
/** 26.15 — the documented default monthly token guard (billing 49.x owns plans). */
export const ASSISTANT_MONTHLY_TOKEN_BUDGET = 200_000;

export const ASSISTANT_COPY = {
  UNCONFIGURED:
    "The assistant isn't configured yet. No AI provider is connected in this environment, so I can't answer questions.",
  EMPTY_RETRIEVAL:
    "I couldn't find anything in your documents about that. Try rephrasing, or upload the source material first.",
  RATE_LIMITED:
    "You're sending messages faster than the limit allows. Wait a moment and try again.",
  SPEND_LIMIT:
    "The assistant's usage limit for this month has been reached. It resets next month.",
  FAILED: "The assistant couldn't answer that just now. Please try again.",
  INVALID: `Send a message between 1 and ${MESSAGE_CONTENT_MAX_LENGTH} characters.`,
} as const;

export type AssistantTurnInput = {
  /** null/omitted starts a new conversation. */
  conversationId?: string | null;
  content: string;
};

export type AssistantTurnResult = {
  error: string | null;
  configured: boolean;
  conversationId: string | null;
  userMessage: MessageItem | null;
  assistantMessage: MessageItem | null;
  sources: AssistantSource[];
};

export type AssistantStreamFrame =
  | { type: "start"; conversationId: string; configured: boolean }
  | { type: "delta"; text: string }
  | { type: "sources"; sources: AssistantSource[] }
  | {
      type: "done";
      status: "complete" | "failed" | "unconfigured";
      messageId: string | null;
    }
  | { type: "error"; error: string };

function parseContent(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > MESSAGE_CONTENT_MAX_LENGTH) return null;
  return trimmed;
}

/** 26.10/26.15 — the rate + spend guards, read from the usage ledger. */
export async function checkAssistantLimits(
  userId: string,
): Promise<{ ok: true } | { ok: false; copy: string }> {
  const service = createServiceClient();
  const now = Date.now();
  const minuteAgo = new Date(now - 60_000).toISOString();
  const monthStart = new Date(
    Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), 1),
  ).toISOString();

  const [turns, tokens] = await Promise.all([
    service
      .from("usage_events")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("kind", "assistant_turn")
      .gte("occurred_at", minuteAgo),
    service
      .from("usage_events")
      .select("quantity")
      .eq("user_id", userId)
      .eq("kind", "assistant_tokens")
      .gte("occurred_at", monthStart),
  ]);

  if (turns.error || tokens.error) {
    // A ledger that cannot be read must not silently disable the guards.
    return { ok: false, copy: ASSISTANT_COPY.FAILED };
  }

  if ((turns.count ?? 0) >= ASSISTANT_RATE_LIMIT_PER_MINUTE) {
    return { ok: false, copy: ASSISTANT_COPY.RATE_LIMITED };
  }

  const usedTokens = (tokens.data ?? []).reduce(
    (sum, row) => sum + (row.quantity ?? 0),
    0,
  );
  if (usedTokens >= ASSISTANT_MONTHLY_TOKEN_BUDGET) {
    return { ok: false, copy: ASSISTANT_COPY.SPEND_LIMIT };
  }

  return { ok: true };
}

export async function recordAssistantUsage(
  userId: string,
  entries: { kind: string; quantity: number }[],
): Promise<void> {
  if (entries.length === 0) return;
  const service = createServiceClient();
  const { error } = await service.from("usage_events").insert(
    entries.map((entry) => ({
      user_id: userId,
      kind: entry.kind,
      quantity: entry.quantity,
    })),
  );
  // Usage is bookkeeping: a failed ledger write must not fail the turn, but
  // it is not silently swallowed either.
  if (error) console.error("assistant usage write failed");
}

/** 26.5/26.7 — retrieve + budget; provenance survives trimming. */
export async function retrieveContext(query: string): Promise<{
  chunks: AssistantContextChunk[];
  sources: AssistantSource[];
}> {
  const hits = await searchDocumentChunks({ query });
  const chunks = selectContextChunks(hits);
  const sources = chunks.map((chunk) => {
    const source: AssistantSource = {
      documentId: chunk.documentId,
      documentName: chunk.documentName,
      chunkIndex: chunk.chunkIndex,
    };
    if (chunk.page !== undefined) source.page = chunk.page;
    return source;
  });
  return { chunks, sources };
}

/** The prompt for the provider path, with the action contract appended. */
export function buildProviderMessages(
  userContent: string,
  context: readonly AssistantContextChunk[],
) {
  const messages = buildChatMessages({ userContent, context });
  const system = messages[0];
  messages[0] = {
    role: "system",
    content: `${system.content}\n\n${STRUCTURED_ACTION_INSTRUCTION}`,
  };
  return messages;
}

export type PreparedTurn =
  | { error: string; configured: false }
  | {
      error: null;
      configured: boolean;
      conversationId: string;
      content: string;
      userMessage: MessageItem;
      chunks: AssistantContextChunk[];
      sources: AssistantSource[];
    };

/**
 * The shared first half of every turn: guards, conversation, user message,
 * retrieval. Returns the sanitized error without persisting when a guard fails
 * (a rate-limited message is not stored).
 */
export async function prepareTurn(
  userId: string,
  input: AssistantTurnInput,
): Promise<PreparedTurn> {
  const content = parseContent(input.content);
  if (content === null) {
    return { error: ASSISTANT_COPY.INVALID, configured: false };
  }

  const limits = await checkAssistantLimits(userId);
  if (!limits.ok) {
    return { error: limits.copy, configured: false };
  }

  let conversationId = input.conversationId ?? null;
  if (conversationId !== null) {
    const existing = await getConversation(userId, conversationId);
    if (!existing) conversationId = null;
  }
  if (conversationId === null) {
    const created = await createConversation(
      userId,
      titleFromFirstMessage(content),
    );
    conversationId = created.id;
  }

  const userMessage = await appendMessage(userId, {
    conversationId,
    role: "user",
    content,
  });
  await touchConversation(userId, conversationId);
  await recordAssistantUsage(userId, [
    { kind: "assistant_turn", quantity: 1 },
  ]);

  const { chunks, sources } = await retrieveContext(content);

  return {
    error: null,
    configured: resolveChatProvider().status.configured,
    conversationId,
    content,
    userMessage,
    chunks,
    sources,
  };
}

/** The unconfigured / empty-retrieval answers persisted as complete. */
async function persistHonestAnswer(
  userId: string,
  conversationId: string,
  content: string,
): Promise<MessageItem> {
  return appendMessage(userId, {
    conversationId,
    role: "assistant",
    content,
    status: "complete",
  });
}

/**
 * The non-streaming turn (Server Action path and the tests). The streaming
 * generator mirrors these branches frame by frame.
 */
export async function runAssistantTurn(
  userId: string,
  input: AssistantTurnInput,
): Promise<AssistantTurnResult> {
  const prepared = await prepareTurn(userId, input);
  if (prepared.error !== null) {
    return {
      error: prepared.error,
      configured: false,
      conversationId: input.conversationId ?? null,
      userMessage: null,
      assistantMessage: null,
      sources: [],
    };
  }

  const {
    conversationId,
    content,
    userMessage,
    chunks,
    sources,
    configured,
  } = prepared;

  if (!configured) {
    const matched = chunks.length > 0;
    const assistantMessage = await persistHonestAnswer(
      userId,
      conversationId,
      matched
        ? ASSISTANT_COPY.UNCONFIGURED
        : `${ASSISTANT_COPY.UNCONFIGURED} No matching workspace sources were found for that question either.`,
    );
    return {
      error: null,
      configured: false,
      conversationId,
      userMessage,
      assistantMessage,
      sources: [],
    };
  }

  if (chunks.length === 0) {
    const assistantMessage = await persistHonestAnswer(
      userId,
      conversationId,
      ASSISTANT_COPY.EMPTY_RETRIEVAL,
    );
    return {
      error: null,
      configured: true,
      conversationId,
      userMessage,
      assistantMessage,
      sources: [],
    };
  }

  const { provider, status } = resolveChatProvider();
  if (provider === null || status.model === null) {
    const assistantMessage = await appendMessage(userId, {
      conversationId,
      role: "assistant",
      content: ASSISTANT_COPY.FAILED,
      status: "failed",
    });
    return {
      error: null,
      configured: true,
      conversationId,
      userMessage,
      assistantMessage,
      sources: [],
    };
  }

  try {
    const result = await withTimeoutAndRetries((signal) =>
      provider.chat(buildProviderMessages(content, chunks), {
        model: status.model!,
        signal,
      }),
    );
    const text = result.text.trim();
    const assistantMessage = await appendMessage(userId, {
      conversationId,
      role: "assistant",
      content: text === "" ? ASSISTANT_COPY.FAILED : text,
      status: text === "" ? "failed" : "complete",
      sources: text === "" ? undefined : sources,
    });
    await recordProviderUsage(userId, result.usage);
    return {
      error: null,
      configured: true,
      conversationId,
      userMessage,
      assistantMessage,
      sources: assistantMessage.status === "complete" ? sources : [],
    };
  } catch {
    const assistantMessage = await appendMessage(userId, {
      conversationId,
      role: "assistant",
      content: ASSISTANT_COPY.FAILED,
      status: "failed",
    });
    return {
      error: null,
      configured: true,
      conversationId,
      userMessage,
      assistantMessage,
      sources: [],
    };
  }
}

async function recordProviderUsage(
  userId: string,
  usage: ProviderUsage | undefined,
): Promise<void> {
  if (usage === undefined) return;
  await recordAssistantUsage(userId, [
    {
      kind: "assistant_tokens",
      quantity: usage.promptTokens + usage.completionTokens,
    },
  ]);
}

/**
 * The SSE frame generator the route serializes (26.8). The provider path
 * streams real deltas through `provider.stream` with one attempt (a retry
 * after deltas would duplicate text) bounded by `PROVIDER_TIMEOUT_MS`, then
 * persists the settled message and announces sources + done.
 */
export async function* streamAssistantTurn(
  userId: string,
  input: AssistantTurnInput,
): AsyncGenerator<AssistantStreamFrame> {
  const prepared = await prepareTurn(userId, input);

  if (prepared.error !== null) {
    yield { type: "error", error: prepared.error };
    return;
  }

  const { conversationId, content, chunks, sources, configured } = prepared;

  yield { type: "start", conversationId, configured };

  if (!configured) {
    const matched = chunks.length > 0;
    const text = matched
      ? ASSISTANT_COPY.UNCONFIGURED
      : `${ASSISTANT_COPY.UNCONFIGURED} No matching workspace sources were found for that question either.`;
    const message = await persistHonestAnswer(userId, conversationId, text);
    yield { type: "delta", text };
    yield { type: "done", status: "unconfigured", messageId: message.id };
    return;
  }

  if (chunks.length === 0) {
    const message = await persistHonestAnswer(
      userId,
      conversationId,
      ASSISTANT_COPY.EMPTY_RETRIEVAL,
    );
    yield { type: "delta", text: ASSISTANT_COPY.EMPTY_RETRIEVAL };
    yield { type: "done", status: "complete", messageId: message.id };
    return;
  }

  const { provider, status } = resolveChatProvider();
  if (provider === null || status.model === null) {
    const message = await appendMessage(userId, {
      conversationId,
      role: "assistant",
      content: ASSISTANT_COPY.FAILED,
      status: "failed",
    });
    yield { type: "delta", text: ASSISTANT_COPY.FAILED };
    yield { type: "done", status: "failed", messageId: message.id };
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  let text = "";
  let usage: ProviderUsage | undefined;

  try {
    for await (const frame of provider.stream(
      buildProviderMessages(content, chunks),
      { model: status.model, signal: controller.signal },
    )) {
      if (frame.type === "delta" && frame.text !== "") {
        text += frame.text;
        yield { type: "delta", text: frame.text };
      }
      if (frame.type === "done") usage = frame.usage;
    }

    const trimmed = text.trim();
    if (trimmed === "") throw new Error("The provider returned no text.");

    const message = await appendMessage(userId, {
      conversationId,
      role: "assistant",
      content: text,
      status: "complete",
      sources,
    });
    await recordProviderUsage(userId, usage);
    yield { type: "sources", sources };
    yield { type: "done", status: "complete", messageId: message.id };
  } catch {
    const message = await appendMessage(userId, {
      conversationId,
      role: "assistant",
      content: ASSISTANT_COPY.FAILED,
      status: "failed",
    });
    yield { type: "delta", text: ASSISTANT_COPY.FAILED };
    yield { type: "done", status: "failed", messageId: message.id };
  } finally {
    clearTimeout(timer);
  }
}
