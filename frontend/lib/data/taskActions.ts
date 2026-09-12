"use server";

/**
 * The tasks Server Actions (Tasks 21.1/21.10), the repo pattern of
 * `lib/data/onboardingActions.ts`: the gate runs first and outside the try
 * block, untrusted payloads are parsed and validated on the server, the
 * service does the write, and only sanitized copy ever travels back to the
 * client.
 *
 * The gate is `requireOnboardedUser("/tasks")` — the same session +
 * completion check the page itself runs, so an unfinished student cannot use
 * the action as a side door around 13.10's redirect. Ownership comes from the
 * session (`user.id`); RLS on `tasks` is the enforcement layer, and the
 * service's request-scoped client is the anon/authenticated one — the service
 * role is never used here.
 *
 * Mutations answer with the settled row (the display contract the 16.5 card
 * reads), which is what lets a future optimistic UI reconcile or roll back;
 * "no owned row matched" is reported honestly as the not-found copy rather
 * than a fabricated success. `revalidatePath("/tasks")` drops the page's
 * cached render after a successful write; no dashboard surface reads tasks
 * yet, so no other path is invalidated.
 */
import { revalidatePath } from "next/cache";
import { requireOnboardedUser } from "@/lib/onboarding/gate";
import {
  TASK_DELETE_ERROR,
  TASK_INVALID_INPUT_ERROR,
  TASK_NOT_FOUND_ERROR,
  TASK_SAVE_ERROR,
} from "./taskErrors";
import {
  parseTaskDraft,
  parseTaskId,
  parseTaskPatch,
  parseTaskPriority,
  parseTaskStatus,
  type TaskItem,
} from "./taskValues";
import {
  createTask,
  deleteTask,
  getTask,
  setTaskPriority,
  setTaskStatus,
  updateTask,
} from "./tasks";

export type TaskActionResult = {
  error: string | null;
  /** The settled row on success; null on every failure. */
  task: TaskItem | null;
};

/**
 * The detail read (16.10): resolves one task by immutable id through the same
 * session gate, so a fabricated, altered or another user's id answers
 * `TASK_NOT_FOUND_ERROR` — ownership is enforced server-side and RLS is the
 * authority, never the URL.
 */
export async function getTaskAction(
  taskId: unknown,
): Promise<TaskActionResult> {
  const user = await requireOnboardedUser("/tasks");

  const id = parseTaskId(taskId);
  if (id === null) return { error: TASK_NOT_FOUND_ERROR, task: null };

  let task: TaskItem | null;
  try {
    task = await getTask(user.id, id);
  } catch {
    return { error: TASK_SAVE_ERROR, task: null };
  }

  if (task === null) return { error: TASK_NOT_FOUND_ERROR, task: null };
  return { error: null, task };
}

export type TaskDeleteResult = {
  error: string | null;
};

/** 21.3 Create. */
export async function createTaskAction(
  payload: unknown,
): Promise<TaskActionResult> {
  const user = await requireOnboardedUser("/tasks");

  const draft = parseTaskDraft(payload);
  if (draft === null) return { error: TASK_INVALID_INPUT_ERROR, task: null };

  let task: TaskItem;
  try {
    task = await createTask(user.id, draft);
  } catch {
    return { error: TASK_SAVE_ERROR, task: null };
  }

  revalidatePath("/tasks");
  return { error: null, task };
}

/** 21.4 Update. */
export async function updateTaskAction(
  taskId: unknown,
  patch: unknown,
): Promise<TaskActionResult> {
  const user = await requireOnboardedUser("/tasks");

  const id = parseTaskId(taskId);
  const parsed = parseTaskPatch(patch);
  if (id === null || parsed === null) {
    return { error: TASK_INVALID_INPUT_ERROR, task: null };
  }

  let task: TaskItem | null;
  try {
    task = await updateTask(user.id, id, parsed);
  } catch {
    return { error: TASK_SAVE_ERROR, task: null };
  }

  if (task === null) return { error: TASK_NOT_FOUND_ERROR, task: null };

  revalidatePath("/tasks");
  return { error: null, task };
}

/** 21.5 Delete. */
export async function deleteTaskAction(
  taskId: unknown,
): Promise<TaskDeleteResult> {
  const user = await requireOnboardedUser("/tasks");

  const id = parseTaskId(taskId);
  if (id === null) return { error: TASK_INVALID_INPUT_ERROR };

  let deleted: boolean;
  try {
    deleted = await deleteTask(user.id, id);
  } catch {
    return { error: TASK_DELETE_ERROR };
  }

  if (!deleted) return { error: TASK_NOT_FOUND_ERROR };

  revalidatePath("/tasks");
  return { error: null };
}

/** 21.6 Status. */
export async function setTaskStatusAction(
  taskId: unknown,
  status: unknown,
): Promise<TaskActionResult> {
  const user = await requireOnboardedUser("/tasks");

  const id = parseTaskId(taskId);
  const parsed = parseTaskStatus(status);
  if (id === null || parsed === null) {
    return { error: TASK_INVALID_INPUT_ERROR, task: null };
  }

  let task: TaskItem | null;
  try {
    task = await setTaskStatus(user.id, id, parsed);
  } catch {
    return { error: TASK_SAVE_ERROR, task: null };
  }

  if (task === null) return { error: TASK_NOT_FOUND_ERROR, task: null };

  revalidatePath("/tasks");
  return { error: null, task };
}

/** 21.7 Priority; "none" parses to null (clear). */
export async function setTaskPriorityAction(
  taskId: unknown,
  priority: unknown,
): Promise<TaskActionResult> {
  const user = await requireOnboardedUser("/tasks");

  const id = parseTaskId(taskId);
  const parsed = parseTaskPriority(priority);
  if (id === null || parsed === undefined) {
    return { error: TASK_INVALID_INPUT_ERROR, task: null };
  }

  let task: TaskItem | null;
  try {
    task = await setTaskPriority(user.id, id, parsed);
  } catch {
    return { error: TASK_SAVE_ERROR, task: null };
  }

  if (task === null) return { error: TASK_NOT_FOUND_ERROR, task: null };

  revalidatePath("/tasks");
  return { error: null, task };
}
