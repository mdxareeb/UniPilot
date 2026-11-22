import { supabase } from "@/lib/supabase";

import type { EventRowInput, TaskRowInput } from "./agenda";
import type { RawMessageRowInput } from "./sourceMessage";

/**
 * The student's own rows, read straight from Supabase with their session (RLS
 * scopes every query to them). Read-only: nothing here writes. A bounded read,
 * not pagination: the agenda shows what is coming up.
 */
export type QueryResult<T> = { rows: T[]; error: string | null };

const TASK_LIMIT = 200;
const EVENT_LIMIT = 200;
/** Events from a day ago onward, so "today" never drops off early across zones. */
const EVENT_LOOKBACK_MS = 24 * 60 * 60 * 1000;

export async function fetchTasks(): Promise<QueryResult<TaskRowInput>> {
  if (supabase === null) return { rows: [], error: "This build isn't configured." };
  const { data, error } = await supabase
    .from("tasks")
    .select(
      "id, title, status, due_date, priority, task_type, source, source_message_id, description, confidence_score, google_event_id, subject_id, subject:subjects(id, name, color_tag)",
    )
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(TASK_LIMIT);
  if (error) return { rows: [], error: "Couldn't load your tasks. Try again." };
  return { rows: (data ?? []) as TaskRowInput[], error: null };
}

export async function fetchEvents(now: number): Promise<QueryResult<EventRowInput>> {
  if (supabase === null) return { rows: [], error: "This build isn't configured." };
  const since = new Date(now - EVENT_LOOKBACK_MS).toISOString();
  const { data, error } = await supabase
    .from("events")
    .select(
      "id, title, start_at, end_at, all_day, type, location, source, source_message_id, description, confidence_score, subject:subjects(id, name, color_tag)",
    )
    .gte("start_at", since)
    .order("start_at", { ascending: true })
    .limit(EVENT_LIMIT);
  if (error) return { rows: [], error: "Couldn't load your calendar. Try again." };
  return { rows: (data ?? []) as EventRowInput[], error: null };
}

export type OriginalMessageResult = {
  row: RawMessageRowInput | null;
  error: string | null;
};

/**
 * One captured message by immutable id, or null when it is not ours or has
 * been purged. The owner-only RLS policy is the only guard needed: the id
 * travels from the student's own task/event row.
 */
export async function fetchOriginalMessage(
  messageId: string,
): Promise<OriginalMessageResult> {
  if (supabase === null) {
    return { row: null, error: "This build isn't configured." };
  }
  const { data, error } = await supabase
    .from("raw_messages")
    .select("sender_name, raw_text, sent_at, media_type")
    .eq("id", messageId)
    .maybeSingle();
  if (error) {
    return { row: null, error: "Couldn't load the original message." };
  }
  return { row: (data ?? null) as RawMessageRowInput | null, error: null };
}
