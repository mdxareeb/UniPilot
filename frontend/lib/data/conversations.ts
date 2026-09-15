/**
 * Task 26.3 — the conversations service (server-only).
 *
 * The repo pattern: typed against the generated `Database`, request-scoped
 * cookie client, RLS owner policies as the authority, `user_id` also in every
 * filter. Conversations are the one assistant table clients still write
 * (create/rename/delete — owner CRUD per the matrix); messages became
 * server-write-only in `20260912103529_assistant_persistence.sql`.
 */
import { createClient } from "@/lib/supabase/server";
import { readProfileTimeZone } from "./profileTime";
import { formatTaskDueDate } from "./taskDates";

export const CONVERSATION_TITLE_MAX_LENGTH = 120;

export type ConversationItem = {
  id: string;
  title: string;
  createdLabel: string;
  updatedLabel: string;
};

const CONVERSATION_COLUMNS = "id, title, created_at, updated_at";

/** A trimmed, bounded title, or null when it is junk. */
export function parseConversationTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > CONVERSATION_TITLE_MAX_LENGTH) {
    return null;
  }
  return trimmed;
}

/** The default title for a conversation started from a first message. */
export function titleFromFirstMessage(content: string): string {
  const collapsed = content.trim().replace(/\s+/g, " ");
  if (collapsed === "") return "New conversation";
  return collapsed.length > 60 ? `${collapsed.slice(0, 57).trimEnd()}…` : collapsed;
}

type ConversationRow = {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
};

function toItem(row: ConversationRow, timeZone: string): ConversationItem {
  return {
    id: row.id,
    title: row.title?.trim() || "Untitled conversation",
    createdLabel: formatTaskDueDate(row.created_at, timeZone),
    updatedLabel: formatTaskDueDate(row.updated_at, timeZone),
  };
}

/** 26.3 — the caller's conversations, most recently active first. */
export async function listConversations(
  userId: string,
): Promise<ConversationItem[]> {
  const supabase = await createClient();

  const [timeZone, result] = await Promise.all([
    readProfileTimeZone(supabase, userId),
    supabase
      .from("conversations")
      .select(CONVERSATION_COLUMNS)
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .order("id", { ascending: true }),
  ]);

  if (result.error) throw new Error("Failed to load conversations.");
  return (result.data ?? []).map((row) => toItem(row, timeZone));
}

export async function getConversation(
  userId: string,
  conversationId: string,
): Promise<ConversationItem | null> {
  const supabase = await createClient();

  const [timeZone, result] = await Promise.all([
    readProfileTimeZone(supabase, userId),
    supabase
      .from("conversations")
      .select(CONVERSATION_COLUMNS)
      .eq("id", conversationId)
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  if (result.error) throw new Error("Failed to load conversation.");
  return result.data ? toItem(result.data, timeZone) : null;
}

export async function createConversation(
  userId: string,
  title: string,
): Promise<ConversationItem> {
  const supabase = await createClient();
  const timeZone = await readProfileTimeZone(supabase, userId);

  const { data, error } = await supabase
    .from("conversations")
    .insert({ user_id: userId, title })
    .select(CONVERSATION_COLUMNS)
    .single();

  if (error || !data) throw new Error("Failed to create conversation.");
  return toItem(data, timeZone);
}

export async function renameConversation(
  userId: string,
  conversationId: string,
  title: string,
): Promise<ConversationItem | null> {
  const supabase = await createClient();
  const timeZone = await readProfileTimeZone(supabase, userId);

  const { data, error } = await supabase
    .from("conversations")
    .update({ title })
    .eq("id", conversationId)
    .eq("user_id", userId)
    .select(CONVERSATION_COLUMNS)
    .maybeSingle();

  if (error) throw new Error("Failed to rename conversation.");
  return data ? toItem(data, timeZone) : null;
}

/** Deleting a conversation cascades its messages. */
export async function deleteConversation(
  userId: string,
  conversationId: string,
): Promise<boolean> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("conversations")
    .delete()
    .eq("id", conversationId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();

  if (error) throw new Error("Failed to delete conversation.");
  return data !== null;
}

/** The turn pipeline's touch: a new message makes the conversation recent. */
export async function touchConversation(
  userId: string,
  conversationId: string,
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", conversationId)
    .eq("user_id", userId);
  if (error) throw new Error("Failed to touch conversation.");
}
