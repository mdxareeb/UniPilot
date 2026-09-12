/**
 * The tasks domain's sanitized user-facing copy (Task 21.10).
 *
 * The same discipline as `lib/auth/errors.ts`: every message a task action can
 * show lives here, so a raw Supabase/Postgres error, a constraint name, a
 * token or a stack trace is never rendered. The service throws its own
 * plain internal error one layer down; the actions catch it and answer with
 * one of these strings.
 *
 * Free of server imports so client components can use the constants without
 * pulling the server client into the browser bundle.
 */

export const TASK_INVALID_INPUT_ERROR =
  "Check the task details and try again.";
export const TASK_SAVE_ERROR =
  "We couldn't save that task. Please try again.";
export const TASK_DELETE_ERROR =
  "We couldn't delete that task. Please try again.";
export const TASK_NOT_FOUND_ERROR = "That task no longer exists.";
