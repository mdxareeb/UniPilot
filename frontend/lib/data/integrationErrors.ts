/**
 * The WhatsApp integration's sanitized user-facing copy (Task 46.x, P4.1),
 * the same discipline as `documentErrors.ts`, `taskErrors.ts` and
 * `eventErrors.ts`: every message a WhatsApp action can show lives here, so a
 * raw Supabase/Storage error, a PostgREST path, a policy name or a stack
 * trace is never rendered. The service throws plain internal errors; the
 * actions and the client pipeline catch them and answer with these strings.
 *
 * `WHATSAPP_GOOGLE_*` and `WHATSAPP_LIVE_*` are consumed by P6/P7's actions;
 * the quota/limit sentence is shared by the reserve path and the rate-limit
 * proof. Free of server imports so client components can use the constants
 * without pulling the server client into the browser bundle.
 */

export const WHATSAPP_GENERIC_ERROR =
  "Something went wrong. Please try again.";

export const WHATSAPP_INVALID_FILE_ERROR =
  "Upload a WhatsApp export: a .txt file exported without media, up to 25 MB.";

export const WHATSAPP_UPLOAD_ERROR =
  "The export didn't finish uploading. Please try again.";

export const WHATSAPP_RUN_NOT_FOUND_ERROR =
  "That scan could no longer be found. Start a new one.";

export const WHATSAPP_ACTIVE_RUN_ERROR =
  "A scan is already running. Wait for it to finish before starting another.";

export const WHATSAPP_RATE_LIMIT_ERROR =
  "You've started 20 scans in the last 24 hours. Try again tomorrow.";

export const WHATSAPP_CANDIDATE_NOT_FOUND_ERROR =
  "That suggestion was already reviewed. Refresh to see the latest list.";

export const WHATSAPP_GOOGLE_NOT_CONFIGURED_ERROR =
  "Google Calendar isn't configured on this server.";

export const WHATSAPP_GOOGLE_ERROR =
  "Google Calendar couldn't be reached. Please try again.";

/**
 * P7.2 — the confirmed-row push note. A candidate whose last push failed is
 * still "Added" here and will be retried (the push worker or the next
 * connected overview backfill); the raw provider text never renders.
 */
export const WHATSAPP_GOOGLE_PUSH_RETRY_NOTE = "Google sync failed, retrying";

export const WHATSAPP_LIVE_DISABLED_ERROR =
  "Live WhatsApp access needs a self-hosted worker with a browser.";

export const WHATSAPP_LIVE_CHAT_ERROR =
  "Enter the chat name to scan (up to 100 characters).";
