/**
 * Task 26.4 — the messages service (server-only).
 *
 * Reads use the request-scoped session client, so the parent-conversation RLS
 * policy is the authority. Writes use the **service-role** client because the
 * migration revoked INSERT/UPDATE/DELETE on `messages` from `authenticated`:
 * the server is the only writer that can be trusted about `role`, `status`
 * and `sources`, and a client can never forge an assistant or system message.
 * Every write still verifies that the conversation belongs to the user before
 * inserting — RLS cannot do that check for a service-role write.
 */
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { readProfileTimeZone } from "./profileTime";
import { formatTaskDueDate } from "./taskDates";
import type { AssistantSource, MessageItem, MessageRole, MessageStatus } from "./assistantValues";

const MESSAGE_COLUMNS =
  "id, conversation_id, role, content, status, sources, created_at";

type MessageRow = {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  status: string;
  sources: unknown;
  created_at: string;
};

/** jsonb is untrusted shape even though we wrote it; keep only real sources. */
export function parseAssistantSources(value: unknown): AssistantSource[] {
  if (!Array.isArray(value)) return [];
  const sources: AssistantSource[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    if (
      typeof record.documentId !== "string" ||
      typeof record.documentName !== "string" ||
      typeof record.chunkIndex !== "number"
    ) {
      continue;
    }
    const source: AssistantSource = {
      documentId: record.documentId,
      documentName: record.documentName,
      chunkIndex: record.chunkIndex,
    };
    if (typeof record.page === "number") source.page = record.page;
    sources.push(source);
  }
  return sources;
}

function toItem(row: MessageRow, timeZone: string): MessageItem {
  const item: MessageItem = {
    id: row.id,
    conversationId: row.conversation_id,
    role: (["user", "assistant", "system"] as const).includes(
      row.role as MessageRole,
    )
      ? (row.role as MessageRole)
      : "system",
    content: row.content,
    status: row.status === "failed" ? "failed" : "complete",
    createdLabel: formatTaskDueDate(row.created_at, timeZone),
  };
  const sources = parseAssistantSources(row.sources);
  if (sources.length > 0) item.sources = sources;
  return item;
}

/** 26.4 — one conversation's messages in creation order (stable ties). */
export async function listMessages(
  userId: string,
  conversationId: string,
): Promise<MessageItem[]> {
  const supabase = await createClient();

  const [timeZone, result] = await Promise.all([
    readProfileTimeZone(supabase, userId),
    supabase
      .from("messages")
      .select(MESSAGE_COLUMNS)
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
  ]);

  if (result.error) throw new Error("Failed to load messages.");
  return (result.data ?? []).map((row) => toItem(row, timeZone));
}

/**
 * The server-only write. Verifies ownership first (service role bypasses RLS),
 * then inserts and returns the settled row mapped to the display contract.
 */
export async function appendMessage(
  userId: string,
  input: {
    conversationId: string;
    role: MessageRole;
    content: string;
    status?: MessageStatus;
    sources?: AssistantSource[];
  },
): Promise<MessageItem> {
  const service = createServiceClient();

  const owner = await service
    .from("conversations")
    .select("id")
    .eq("id", input.conversationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (owner.error) throw new Error("Failed to load conversation.");
  if (!owner.data) throw new Error("Conversation not found.");

  const timeZone = await readProfileTimeZone(service, userId);

  const { data, error } = await service
    .from("messages")
    .insert({
      conversation_id: input.conversationId,
      role: input.role,
      content: input.content,
      status: input.status ?? "complete",
      sources: input.sources && input.sources.length > 0 ? input.sources : null,
    })
    .select(MESSAGE_COLUMNS)
    .single();

  if (error || !data) throw new Error("Failed to save message.");
  return toItem(data, timeZone);
}
