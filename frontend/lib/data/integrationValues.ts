/**
 * The WhatsApp integration's shared vocabulary, validation and display
 * mapping (Task 46.x, P4.1), imported by the service, the Server Actions, the
 * client pipeline and the tests.
 *
 * Pure by design — no server imports — so the same parser that guards the
 * upload boundary can run in the browser for instant feedback without
 * becoming the authority, and the row → display mapping can be exercised
 * directly. The bucket migration (`..._whatsapp_exports_bucket.sql`) mirrors
 * the `.txt`/25 MiB allowlist and the finalize Server Action re-checks the
 * real object size; this module is the one place the numbers are written.
 *
 * A Playwright spec imports this module through a RELATIVE path, so runtime
 * imports here stay relative (`./taskDates` — pure `Intl` maths) and the
 * Database type is a type-only import: no `@/` alias is ever needed at
 * runtime.
 *
 * The Python service is the only writer of `integration_runs.error`; it
 * stores its own capped-run sentence or a sanitized service message. The
 * capped text is never rendered: consumers show a truncation sentence when
 * `capped` is true and never print `error` for a capped success. Candidates
 * carry only derived booleans (`pushed`/`pushFailed`); their raw `push_error`
 * is never mapped into the item.
 */
import type { Database } from "@/lib/supabase/database.types";
import { formatEventTime, formatTaskDueDate } from "./taskDates";

export const WHATSAPP_EXPORT_BUCKET = "whatsapp-exports";

/** 25 MiB — the documented export cap, matching the bucket constraint. */
export const WHATSAPP_EXPORT_MAX_BYTES = 25 * 1024 * 1024;

/** The per-run message cap the Python reader enforces (46.4). */
export const WHATSAPP_MESSAGE_CAP = 5000;

/** The per-run candidate cap the Python extractor enforces (46.10). */
export const WHATSAPP_CANDIDATE_CAP = 500;

/** One scan at a time; twenty scans per rolling day (46.x guards). */
export const WHATSAPP_ACTIVE_RUN_LIMIT = 1;
export const WHATSAPP_RUNS_PER_DAY = 20;

/** The live chat-name bound (P6.1), enforced at the form, the action and the service. */
export const WHATSAPP_LIVE_CHAT_MAX_LENGTH = 100;

/** The stale-run window: a run active longer than this is treated as dead. */
export const WHATSAPP_ACTIVE_WINDOW_MS = 3_600_000;

/**
 * P7.2 — after a terminal push failure (`failed`/`dead_letter`), the
 * connected-overview backfill waits this long before enqueuing another
 * `whatsapp.push` for the same candidate, so a dead job cannot be retried by
 * every page read (including the 3 s status poll). Still self-heals after it.
 */
export const GOOGLE_PUSH_RETRY_WINDOW_MS = 3_600_000;

export type WhatsAppRunRow =
  Database["public"]["Tables"]["integration_runs"]["Row"];
export type WhatsAppCandidateRow =
  Database["public"]["Tables"]["integration_candidates"]["Row"];
export type WhatsAppConnectionRow =
  Database["public"]["Tables"]["integration_connections"]["Row"];

/** The schema's mode vocabulary (`integration_runs_mode_check`). */
export const WHATSAPP_RUN_MODES = ["export", "live"] as const;
export type WhatsAppRunMode = (typeof WHATSAPP_RUN_MODES)[number];

/** The schema's run-status vocabulary (`integration_runs_status_check`). */
export const WHATSAPP_RUN_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
] as const;
export type WhatsAppRunStatus = (typeof WHATSAPP_RUN_STATUSES)[number];

/** The run status words the history renders. */
export const WHATSAPP_RUN_STATUS_LABELS: Record<WhatsAppRunStatus, string> = {
  queued: "Queued",
  running: "Scanning",
  succeeded: "Done",
  failed: "Failed",
};

/**
 * The schema's review-mode vocabulary
 * (`integration_runs_review_mode_check`): manual keeps every detected event
 * as a pending suggestion; automatic has the worker add the
 * run's detections to the calendar as the scan settles. Each run records the
 * mode it used; the connection row carries the owner's saved default.
 */
export const WHATSAPP_REVIEW_MODES = ["manual", "automatic"] as const;
export type WhatsAppReviewMode = (typeof WHATSAPP_REVIEW_MODES)[number];

/** The review-mode words the mode choice and the history render. */
export const WHATSAPP_REVIEW_MODE_LABELS: Record<WhatsAppReviewMode, string> = {
  manual: "Review each event",
  automatic: "Add automatically",
};

/**
 * The schema's date-order vocabulary
 * (`integration_connections_date_order_check`): how ambiguous numeric dates
 * in message TEXT read. The export envelope is parsed with its own inferred
 * order, never this setting. Each upload records the choice as the
 * connection's saved default for the next one.
 */
export const WHATSAPP_DATE_ORDERS = ["DMY", "MDY"] as const;
export type WhatsAppDateOrder = (typeof WHATSAPP_DATE_ORDERS)[number];

/** The date-order words the choice renders. */
export const WHATSAPP_DATE_ORDER_LABELS: Record<WhatsAppDateOrder, string> = {
  DMY: "Day first (31/12)",
  MDY: "Month first (12/31)",
};

/** The schema's candidate-status vocabulary (`integration_candidates_status_check`). */
export const WHATSAPP_CANDIDATE_STATUSES = [
  "pending",
  "confirmed",
  "rejected",
] as const;
export type WhatsAppCandidateStatus =
  (typeof WHATSAPP_CANDIDATE_STATUSES)[number];

/** The candidate status words the review list renders. */
export const WHATSAPP_CANDIDATE_STATUS_LABELS: Record<
  WhatsAppCandidateStatus,
  string
> = {
  pending: "Needs review",
  confirmed: "Added",
  rejected: "Dismissed",
};

/** The schema's connection-status vocabulary (`integration_connections_status_check`). */
export const WHATSAPP_CONNECTION_STATUSES = [
  "pending",
  "connected",
  "disconnected",
  "error",
] as const;
export type WhatsAppConnectionStatus =
  (typeof WHATSAPP_CONNECTION_STATUSES)[number];

/** The connection status words the card renders. */
export const WHATSAPP_CONNECTION_STATUS_LABELS: Record<
  WhatsAppConnectionStatus,
  string
> = {
  pending: "Connecting",
  connected: "Connected",
  disconnected: "Not connected",
  error: "Connection failed",
};

/**
 * What the history renders for one scan: machine values a later poll/abort
 * needs plus display-ready strings mapped by the data layer.
 */
export type WhatsAppRunItem = {
  id: string;
  mode: "export" | "live";
  /** The review mode this run recorded (legacy rows default to manual). */
  reviewMode: WhatsAppReviewMode;
  /** Display-ready review-mode word, e.g. "Review each event". */
  reviewModeLabel: string;
  statusValue: "queued" | "running" | "succeeded" | "failed";
  statusLabel: string;
  messageCount: number;
  candidateCount: number;
  /**
   * The stored writer text (never a raw Supabase/Storage error). Consumers
   * show the truncation sentence instead whenever `capped` is true.
   */
  error?: string;
  /** True when the message cap truncated this run (derived from `error`). */
  capped: boolean;
  /** Display-ready scan date, e.g. "Sat, Sep 12". */
  dateLabel: string;
  /** Live runs name the scanned chat. */
  chatName?: string;
};

/**
 * What the review list renders for one suggestion: display-ready strings
 * plus the machine values the confirm/reject actions send back.
 */
export type WhatsAppCandidateItem = {
  id: string;
  title: string;
  statusValue: "pending" | "confirmed" | "rejected";
  statusLabel: string;
  allDay: boolean;
  /** ISO instant, for the calendar hand-off. */
  startAt: string;
  /** Display-ready date, e.g. "Wed, Sep 2". */
  dateLabel: string;
  /** Display-ready time; timed candidates only (all-day has no clock). */
  timeLabel?: string;
  messageSender: string;
  messageText: string;
  /** The event reached Google Calendar (`pushed_at` set). */
  pushed: boolean;
  /**
   * Optimistic only: the confirm action enqueued a push for this candidate
   * and the refreshed render has not landed yet. Row mapping never sets it —
   * "On Google Calendar" is only ever derived from real `pushed_at`.
   */
  pushing?: boolean;
  /** The last Google push failed (`push_error` set). */
  pushFailed: boolean;
};

/**
 * What the card and the status poll render for the WhatsApp connection:
 * machine values (`id` for the QR RPC, `statusValue` for the pending gate)
 * plus the owner-visible profile reference and sanitized last error.
 */
export type WhatsAppConnectionItem = {
  id: string;
  statusValue: WhatsAppConnectionStatus;
  statusLabel: string;
  /** The saved default for the next export upload (legacy rows: manual). */
  reviewMode: WhatsAppReviewMode;
  /** Display-ready default word, e.g. "Add automatically". */
  reviewModeLabel: string;
  /** The saved default date order for message-text dates (legacy rows: DMY). */
  dateOrder: WhatsAppDateOrder;
  /** The saved relative-date detection default (legacy rows: off). */
  detectRelativeDates: boolean;
  /** The self-host browser profile key (`<user_id>`), when linked. */
  profileRef?: string;
  /** The sanitized writer text; raw Supabase/Storage errors never reach it. */
  lastError?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** What the reserve Server Action accepts, after validation. */
export type WhatsAppExportDraft = {
  name: string;
  sizeBytes: number;
  /** This upload's review choice; an absent payload defaults to manual. */
  reviewMode: WhatsAppReviewMode;
  /** This upload's ambiguous-date order; an absent payload defaults to DMY. */
  dateOrder: WhatsAppDateOrder;
  /** This upload's relative-date detection; an absent payload defaults off. */
  detectRelativeDates: boolean;
};

/**
 * Validates an untrusted export selection. Null rejects: the action answers
 * with the sanitized file copy and nothing is written. A `.txt` name is
 * required (case-insensitive) and the declared size must be a positive
 * integer within the 25 MiB cap; the real object size is checked again at
 * finalize time. The name is display-only — the object path is generated
 * server-side — so it is trimmed, never path-sanitized here. The optional
 * `reviewMode` must be one of the schema's words: absent means the documented
 * `manual` default, anything else rejects the whole selection. The optional
 * `dateOrder` and `detectRelativeDates` follow the same rule: absent means the
 * documented defaults (`DMY`, off) and a vocabulary miss or non-boolean
 * rejects.
 */
export function parseWhatsAppExport(
  input: unknown,
): WhatsAppExportDraft | null {
  if (!isRecord(input)) return null;

  if (typeof input.name !== "string") return null;
  const name = input.name.trim();
  if (name.length === 0 || !name.toLowerCase().endsWith(".txt")) return null;

  const sizeBytes = input.sizeBytes;
  if (
    typeof sizeBytes !== "number" ||
    !Number.isInteger(sizeBytes) ||
    sizeBytes <= 0 ||
    sizeBytes > WHATSAPP_EXPORT_MAX_BYTES
  ) {
    return null;
  }

  const reviewMode =
    input.reviewMode === undefined ? "manual" : input.reviewMode;
  if (
    typeof reviewMode !== "string" ||
    !(WHATSAPP_REVIEW_MODES as readonly string[]).includes(reviewMode)
  ) {
    return null;
  }

  const dateOrder = input.dateOrder === undefined ? "DMY" : input.dateOrder;
  if (
    typeof dateOrder !== "string" ||
    !(WHATSAPP_DATE_ORDERS as readonly string[]).includes(dateOrder)
  ) {
    return null;
  }

  const detectRelativeDates =
    input.detectRelativeDates === undefined ? false : input.detectRelativeDates;
  if (typeof detectRelativeDates !== "boolean") return null;

  return {
    name,
    sizeBytes,
    reviewMode: reviewMode as WhatsAppReviewMode,
    dateOrder: dateOrder as WhatsAppDateOrder,
    detectRelativeDates,
  };
}

/**
 * The subset of a run row the history contract maps (the service's select).
 */
export type WhatsAppRunFields = Pick<
  WhatsAppRunRow,
  | "id"
  | "mode"
  | "review_mode"
  | "status"
  | "storage_path"
  | "chat_name"
  | "message_count"
  | "candidate_count"
  | "error"
  | "started_at"
  | "completed_at"
  | "created_at"
>;

/**
 * Row → history contract. Status, mode and review mode are validated against
 * the closed vocabularies and fall back to the documented defaults for a
 * legacy row; optional fields are omitted rather than defaulted. `capped` is
 * derived from the stored error text so the UI can replace it with the
 * truncation sentence.
 */
export function integrationRunRowToItem(
  row: WhatsAppRunFields,
  timeZone: string,
): WhatsAppRunItem {
  const mode: WhatsAppRunMode = (
    WHATSAPP_RUN_MODES as readonly string[]
  ).includes(row.mode)
    ? (row.mode as WhatsAppRunMode)
    : "export";

  const statusValue = (
    WHATSAPP_RUN_STATUSES as readonly string[]
  ).includes(row.status)
    ? (row.status as WhatsAppRunStatus)
    : "queued";

  const reviewMode = (
    WHATSAPP_REVIEW_MODES as readonly string[]
  ).includes(row.review_mode)
    ? (row.review_mode as WhatsAppReviewMode)
    : "manual";

  const item: WhatsAppRunItem = {
    id: row.id,
    mode,
    reviewMode,
    reviewModeLabel: WHATSAPP_REVIEW_MODE_LABELS[reviewMode],
    statusValue,
    statusLabel: WHATSAPP_RUN_STATUS_LABELS[statusValue],
    messageCount: row.message_count,
    candidateCount: row.candidate_count,
    capped: row.error !== null && row.error.toLowerCase().includes("capped"),
    dateLabel: formatTaskDueDate(row.created_at, timeZone),
  };

  if (row.error !== null) item.error = row.error;
  if (row.chat_name !== null) item.chatName = row.chat_name;

  return item;
}

/**
 * The subset of a candidate row the review contract maps (the service's
 * select).
 */
export type WhatsAppCandidateFields = Pick<
  WhatsAppCandidateRow,
  | "id"
  | "title"
  | "status"
  | "start_at"
  | "end_at"
  | "all_day"
  | "message_sender"
  | "message_text"
  | "pushed_at"
  | "push_error"
  | "created_at"
>;

/**
 * Row → review contract. Dates and times are formatted in the profile's zone
 * like the calendar's; an all-day candidate carries no time label. Push state
 * is derived to booleans — the raw `push_error` never reaches the client.
 */
export function integrationCandidateRowToItem(
  row: WhatsAppCandidateFields,
  timeZone: string,
): WhatsAppCandidateItem {
  const statusValue = (
    WHATSAPP_CANDIDATE_STATUSES as readonly string[]
  ).includes(row.status)
    ? (row.status as WhatsAppCandidateStatus)
    : "pending";

  const item: WhatsAppCandidateItem = {
    id: row.id,
    title: row.title,
    statusValue,
    statusLabel: WHATSAPP_CANDIDATE_STATUS_LABELS[statusValue],
    allDay: row.all_day,
    startAt: row.start_at,
    dateLabel: formatTaskDueDate(row.start_at, timeZone),
    messageSender: row.message_sender,
    messageText: row.message_text,
    pushed: row.pushed_at !== null,
    pushFailed: row.push_error !== null,
  };

  if (!row.all_day) {
    item.timeLabel = formatEventTime(row.start_at, timeZone);
  }

  return item;
}

/** The subset of the connection row the status contract maps. */
export type WhatsAppConnectionFields = Pick<
  WhatsAppConnectionRow,
  | "id"
  | "status"
  | "review_mode"
  | "date_order"
  | "detect_relative_dates"
  | "profile_ref"
  | "last_error"
>;

/**
 * Row → connection contract. `statusValue` is validated against the closed
 * vocabulary and falls back to `pending` for a legacy row; `reviewMode` falls
 * back to `manual` and the detection settings fall back to the documented
 * `DMY`/off defaults for a vocabulary miss or a missing legacy value; optional
 * fields are omitted rather than defaulted, so the UI can distinguish "never
 * set" from an empty string.
 */
export function connectionRowToItem(
  row: WhatsAppConnectionFields,
): WhatsAppConnectionItem {
  const statusValue = (
    WHATSAPP_CONNECTION_STATUSES as readonly string[]
  ).includes(row.status)
    ? (row.status as WhatsAppConnectionStatus)
    : "pending";

  const reviewMode = (
    WHATSAPP_REVIEW_MODES as readonly string[]
  ).includes(row.review_mode)
    ? (row.review_mode as WhatsAppReviewMode)
    : "manual";

  const dateOrder = (WHATSAPP_DATE_ORDERS as readonly string[]).includes(
    row.date_order,
  )
    ? (row.date_order as WhatsAppDateOrder)
    : "DMY";

  const detectRelativeDates =
    typeof row.detect_relative_dates === "boolean"
      ? row.detect_relative_dates
      : false;

  const item: WhatsAppConnectionItem = {
    id: row.id,
    statusValue,
    statusLabel: WHATSAPP_CONNECTION_STATUS_LABELS[statusValue],
    reviewMode,
    reviewModeLabel: WHATSAPP_REVIEW_MODE_LABELS[reviewMode],
    dateOrder,
    detectRelativeDates,
  };

  if (row.profile_ref !== null) item.profileRef = row.profile_ref;
  if (row.last_error !== null) item.lastError = row.last_error;

  return item;
}

/** Whether a run is still occupying the single active slot. */
export function isWhatsAppRunActive(item: WhatsAppRunItem): boolean {
  return item.statusValue === "queued" || item.statusValue === "running";
}

/** The active-slot guard's count over a freshly mapped run list. */
export function activeRunCount(items: WhatsAppRunItem[]): number {
  return items.filter(isWhatsAppRunActive).length;
}
