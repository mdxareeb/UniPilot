/**
 * The events domain's sanitized user-facing copy (Task 22.x), the same
 * discipline as `lib/auth/errors.ts` and `lib/data/taskErrors.ts`: every
 * message an event action can show lives here, so a raw Supabase/Postgres
 * error, a constraint name or a stack trace is never rendered. The service
 * throws a plain internal error one layer down; the actions catch it and
 * answer with one of these strings.
 *
 * Free of server imports so client components can use the constants without
 * pulling the server client into the browser bundle.
 */

export const EVENT_INVALID_INPUT_ERROR =
  "Check the event details and try again.";
export const EVENT_SAVE_ERROR =
  "We couldn't save that event. Please try again.";
export const EVENT_DELETE_ERROR =
  "We couldn't delete that event. Please try again.";
export const EVENT_NOT_FOUND_ERROR = "That event no longer exists.";
