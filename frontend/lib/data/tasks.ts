/**
 * The tasks service (Task 21.1) â€” the only module that reads or writes a
 * student's task rows.
 *
 * The repo pattern of `lib/data/onboarding.ts`: server-only, typed against the
 * generated `Database` view, and using the request-scoped cookie client, so
 * the authenticated session identifies the caller and the owner-only RLS
 * policies on `tasks` are the enforcement layer. Every query is additionally
 * scoped by `user_id` â€” belt and braces, never a substitute for RLS â€” and the
 * service never uses the service role.
 *
 * Callers pass already-validated payloads: the Server Actions in
 * `lib/data/taskActions.ts` run `parseTaskDraft` / `parseTaskPatch` /
 * `parseTaskStatus` / `parseTaskPriority` first. A query failure throws a
 * plain internal error with no database text; the action turns it into the
 * domain's sanitized copy.
 *
 * Mutations return the settled row mapped to the 16.5 display contract, which
 * is what a later optimistic UI needs to reconcile or roll back (21.9's
 * server half). A mutation that matched no row (another user's id, or a
 * already-deleted task) returns null / false instead of inventing a success.
 */
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { readProfileTimeZone } from "./profileTime";
import {
  taskRowToItem,
  type TaskDraft,
  type TaskItem,
  type TaskPatch,
  type TaskPriority,
  type TaskStatus,
} from "./taskValues";
import { zonedDateOnlyToInstant } from "./taskDates";

const TASK_COLUMNS = "id, title, status, due_date, priority";

type TaskUpdate = Database["public"]["Tables"]["tasks"]["Update"];

/**
 * 21.2 Load â€” every task the caller owns, deterministically ordered:
 * soonest due date first with undated tasks last, then oldest first, then id
 * so two rows created in the same instant still have one stable order.
 */
export async function listTasks(userId: string): Promise<TaskItem[]> {
  const supabase = await createClient();

  const [timeZone, tasksResult] = await Promise.all([
    readProfileTimeZone(supabase, userId),
    supabase
      .from("tasks")
      .select(TASK_COLUMNS)
      .eq("user_id", userId)
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
  ]);

  if (tasksResult.error) throw new Error("Failed to load tasks.");

  return (tasksResult.data ?? []).map((row) => taskRowToItem(row, timeZone));
}

/** 21.2 Load â€” one owned task by immutable id, or null when it is not ours. */
export async function getTask(
  userId: string,
  taskId: string,
): Promise<TaskItem | null> {
  const supabase = await createClient();

  const [timeZone, result] = await Promise.all([
    readProfileTimeZone(supabase, userId),
    supabase
      .from("tasks")
      .select(TASK_COLUMNS)
      .eq("id", taskId)
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  if (result.error) throw new Error("Failed to load task.");
  return result.data ? taskRowToItem(result.data, timeZone) : null;
}

/** 21.3 Create â€” a new todo, with the due date stored at the zone's start of day. */
export async function createTask(
  userId: string,
  draft: TaskDraft,
): Promise<TaskItem> {
  const supabase = await createClient();
  const timeZone = await readProfileTimeZone(supabase, userId);

  const { data, error } = await supabase
    .from("tasks")
    .insert({
      user_id: userId,
      title: draft.title,
      description: draft.description,
      due_date:
        draft.dueDate === null
          ? null
          : zonedDateOnlyToInstant(draft.dueDate, timeZone),
      effort_minutes: draft.effortMinutes,
      priority: draft.priority,
      status: "todo",
    })
    .select(TASK_COLUMNS)
    .single();

  if (error || !data) throw new Error("Failed to create task.");
  return taskRowToItem(data, timeZone);
}

/** 21.4 Update â€” patch semantics; null when no owned row matched. */
export async function updateTask(
  userId: string,
  taskId: string,
  patch: TaskPatch,
): Promise<TaskItem | null> {
  const supabase = await createClient();
  const timeZone = await readProfileTimeZone(supabase, userId);

  const update: TaskUpdate = {};
  if (patch.title !== undefined) update.title = patch.title;
  if (patch.description !== undefined) update.description = patch.description;
  if (patch.dueDate !== undefined) {
    update.due_date =
      patch.dueDate === null
        ? null
        : zonedDateOnlyToInstant(patch.dueDate, timeZone);
  }
  if (patch.effortMinutes !== undefined) {
    update.effort_minutes = patch.effortMinutes;
  }
  if (patch.priority !== undefined) {
    update.priority = patch.priority;
  }

  const { data, error } = await supabase
    .from("tasks")
    .update(update)
    .eq("id", taskId)
    .eq("user_id", userId)
    .select(TASK_COLUMNS)
    .maybeSingle();

  if (error) throw new Error("Failed to update task.");
  return data ? taskRowToItem(data, timeZone) : null;
}

/** 21.5 Delete â€” true when an owned row was removed, false otherwise. */
export async function deleteTask(
  userId: string,
  taskId: string,
): Promise<boolean> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("tasks")
    .delete()
    .eq("id", taskId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();

  if (error) throw new Error("Failed to delete task.");
  return data !== null;
}

/** 21.6 Status â€” one of the schema's three states; null when unowned. */
export async function setTaskStatus(
  userId: string,
  taskId: string,
  status: TaskStatus,
): Promise<TaskItem | null> {
  const supabase = await createClient();
  const timeZone = await readProfileTimeZone(supabase, userId);

  const { data, error } = await supabase
    .from("tasks")
    .update({ status })
    .eq("id", taskId)
    .eq("user_id", userId)
    .select(TASK_COLUMNS)
    .maybeSingle();

  if (error) throw new Error("Failed to update task status.");
  return data ? taskRowToItem(data, timeZone) : null;
}

/** 21.7 Priority â€” low | medium | high, or null to clear. */
export async function setTaskPriority(
  userId: string,
  taskId: string,
  priority: TaskPriority | null,
): Promise<TaskItem | null> {
  const supabase = await createClient();
  const timeZone = await readProfileTimeZone(supabase, userId);

  const { data, error } = await supabase
    .from("tasks")
    .update({ priority })
    .eq("id", taskId)
    .eq("user_id", userId)
    .select(TASK_COLUMNS)
    .maybeSingle();

  if (error) throw new Error("Failed to update task priority.");
  return data ? taskRowToItem(data, timeZone) : null;
}

