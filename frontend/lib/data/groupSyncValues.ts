/**
 * WhatsApp group live sync (Stage 1): the pure value layer.
 *
 * No server imports, so the client component and the Playwright specs (which
 * import it by relative path) share one definition of the panel's states. The
 * database stores facts (`status`, `desired_state`, a heartbeat, `last_error`);
 * this module turns them into the ONE honest state the UI shows. Nothing here
 * invents progress: a link is "connected" only while a bridge is also
 * demonstrably running.
 */
import type { Database } from "../supabase/database.types";
import { formatEventTime, formatTaskDueDate } from "./taskDates";

type SessionRow = Database["public"]["Tables"]["whatsapp_sessions"]["Row"];
type GroupRow = Database["public"]["Tables"]["monitored_groups"]["Row"];

/** The bridge bumps `bridge_heartbeat_at` every ~10 s; this is the staleness bound. */
export const BRIDGE_HEARTBEAT_STALE_MS = 30_000;

/** After a connect request, how long to wait for the bridge's first heartbeat. */
export const BRIDGE_START_GRACE_MS = 20_000;

export const GROUP_SYNC_STATES = [
  "not_enabled",
  "disconnected",
  "starting",
  "bridge_offline",
  "qr_ready",
  "code_ready",
  "connected",
  "disconnecting",
  "error",
] as const;
export type GroupSyncState = (typeof GROUP_SYNC_STATES)[number];

export const GROUP_SYNC_STATE_LABELS: Record<GroupSyncState, string> = {
  not_enabled: "Not enabled",
  disconnected: "Not linked",
  starting: "Starting",
  bridge_offline: "Bridge not running",
  qr_ready: "Scan to link",
  code_ready: "Enter the code",
  connected: "Linked",
  disconnecting: "Disconnecting",
  error: "Link failed",
};

export type SessionFacts = Pick<
  SessionRow,
  | "status"
  | "desired_state"
  | "last_error"
  | "bridge_heartbeat_at"
  | "requested_at"
>;

function ageMs(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  return Number.isNaN(at) ? null : now - at;
}

/**
 * Facts -> the single state the panel renders. `null` facts mean the user has
 * never linked anything.
 */
export function deriveGroupSyncState(
  facts: SessionFacts | null,
  now: number,
): Exclude<GroupSyncState, "not_enabled"> {
  if (!facts) return "disconnected";

  const heartbeatAge = ageMs(facts.bridge_heartbeat_at, now);
  const bridgeAlive =
    heartbeatAge !== null && heartbeatAge <= BRIDGE_HEARTBEAT_STALE_MS;

  if (facts.desired_state === "connected") {
    if (!bridgeAlive) {
      // A fresh request gets a grace period for the bridge to pick it up. A
      // heartbeat from BEFORE the request is stale evidence from an earlier
      // link, not a sign the bridge is down, so it does not end the grace.
      const requestedAge = ageMs(facts.requested_at, now);
      const requestedAt = facts.requested_at ? Date.parse(facts.requested_at) : NaN;
      const heartbeatAt = facts.bridge_heartbeat_at
        ? Date.parse(facts.bridge_heartbeat_at)
        : NaN;
      const heartbeatPredatesRequest =
        Number.isNaN(heartbeatAt) ||
        (!Number.isNaN(requestedAt) && heartbeatAt < requestedAt);
      const inGrace =
        heartbeatPredatesRequest &&
        requestedAge !== null &&
        requestedAge <= BRIDGE_START_GRACE_MS;
      return inGrace ? "starting" : "bridge_offline";
    }
    if (facts.status === "qr_ready") return "qr_ready";
    if (facts.status === "code_ready") return "code_ready";
    if (facts.status === "connected") return "connected";
    return "starting";
  }

  // The user asked to disconnect.
  if (facts.status !== "disconnected") return "disconnecting";
  return facts.last_error ? "error" : "disconnected";
}

export type MonitoredGroupItem = {
  id: string;
  name: string;
  active: boolean;
  /** ISO instant the group was last switched on, for "capturing since". */
  activatedAt: string | null;
  lastSyncedAt: string | null;
};

export function groupRowToItem(
  row: Pick<
    GroupRow,
    "id" | "group_name" | "is_active" | "activated_at" | "last_synced_at"
  >,
): MonitoredGroupItem {
  return {
    id: row.id,
    name: row.group_name.trim() || "Unnamed group",
    active: row.is_active,
    activatedAt: row.activated_at,
    lastSyncedAt: row.last_synced_at,
  };
}

/**
 * A suggestion from a switched-on group that the pipeline was not sure enough
 * to add by itself (or that names a brand-new course). Pending ones are shown
 * for review; the student adds or dismisses each.
 */
export type GroupCandidateItem = {
  id: string;
  title: string;
  kind: "task" | "event";
  /** "Assignment" | "Quiz" | "Exam" | "Class or lab" | "Event". */
  typeLabel: string;
  /** Profile-zone date (and time), or null for an undated task. */
  whenLabel: string | null;
  allDay: boolean;
  sender: string;
  messageText: string;
  /** Whole percent, 0-100, when the pipeline scored it. */
  confidencePercent: number | null;
  /** The matched course, or null (unsorted). */
  subjectName: string | null;
  /** A NEW course the model proposed; created only if the student adds this. */
  proposedSubjectName: string | null;
  groupName: string | null;
};

type CandidateRow = Database["public"]["Tables"]["integration_candidates"]["Row"];

const TASK_TYPE_LABELS: Record<string, string> = {
  assignment: "Assignment",
  quiz: "Quiz",
};
const EVENT_TYPE_LABELS: Record<string, string> = {
  exam: "Exam",
  class: "Class or lab",
  deadline: "Deadline",
};

export function groupCandidateRowToItem(
  row: Pick<
    CandidateRow,
    | "id"
    | "title"
    | "kind"
    | "task_type"
    | "event_type"
    | "start_at"
    | "all_day"
    | "message_sender"
    | "message_text"
    | "confidence"
    | "proposed_subject_name"
    | "group_name"
  > & { subject?: { name: string } | null },
  timeZone: string,
): GroupCandidateItem {
  const kind = row.kind === "task" ? "task" : "event";
  const typeLabel =
    kind === "task"
      ? (TASK_TYPE_LABELS[row.task_type ?? ""] ?? "Task")
      : (EVENT_TYPE_LABELS[row.event_type ?? ""] ?? "Event");

  let whenLabel: string | null = null;
  if (row.start_at) {
    whenLabel = formatTaskDueDate(row.start_at, timeZone);
    if (!row.all_day && kind === "event") {
      whenLabel += ` · ${formatEventTime(row.start_at, timeZone)}`;
    }
  }

  return {
    id: row.id,
    title: row.title,
    kind,
    typeLabel,
    whenLabel,
    allDay: row.all_day,
    sender: row.message_sender,
    messageText: row.message_text,
    confidencePercent:
      row.confidence === null ? null : Math.round(row.confidence * 100),
    subjectName: row.subject?.name ?? null,
    proposedSubjectName: row.proposed_subject_name,
    groupName: row.group_name,
  };
}

/** Everything the panel renders; serialisable across the server boundary. */
export type GroupSyncSnapshot = {
  state: GroupSyncState;
  /** Sanitized copy from `whatsapp_sessions.last_error`, only in `error`. */
  lastError: string | null;
  /** A QR image data URL, present only while `state === "qr_ready"`. */
  qr: string | null;
  /**
   * The 8-character pairing code (mobile link), present only while
   * `state === "code_ready"`, with the ISO instant it stops working.
   */
  pairing: { code: string; expiresAt: string } | null;
  groups: MonitoredGroupItem[];
  /** Pending suggestions awaiting the student's decision. */
  review: GroupCandidateItem[];
};

export const EMPTY_GROUP_SYNC: GroupSyncSnapshot = {
  state: "not_enabled",
  lastError: null,
  qr: null,
  pairing: null,
  groups: [],
  review: [],
};

/** Alphabetical, active groups first, so what is being captured is on top. */
export function sortGroups(groups: MonitoredGroupItem[]): MonitoredGroupItem[] {
  return [...groups].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

// ---- phone numbers for the pairing-code link ---------------------------------

/**
 * Turn what a person types into the digits-only E.164 form WhatsApp's pairing
 * code needs (`919876543210`: no `+`, spaces or dashes), or say why not.
 *
 * Conservative on purpose: natural separators (space, dash, dot, brackets) are
 * dropped and a leading `+` or `00` is accepted, but letters are rejected rather
 * than stripped and a leading `0` (a national format) is rejected rather than
 * guessed. 8-15 digits. The same rules run again in the database
 * (`set_whatsapp_pairing_phone`) and in the bridge; the mobile app carries a
 * copy for instant feedback.
 */
export type PhoneRejection = "empty" | "characters" | "country_code" | "length";

export type PhoneResult =
  | { ok: true; digits: string }
  | { ok: false; reason: PhoneRejection };

export function sanitizePhone(input: unknown): PhoneResult {
  if (typeof input !== "string") return { ok: false, reason: "empty" };
  let value = input.trim();
  if (value === "") return { ok: false, reason: "empty" };

  value = value.replace(/[\s\-.()]/g, "");
  if (value.startsWith("+")) value = value.slice(1);
  else if (value.startsWith("00")) value = value.slice(2);

  if (!/^\d+$/.test(value)) return { ok: false, reason: "characters" };
  if (value.startsWith("0")) return { ok: false, reason: "country_code" };
  if (value.length < 8 || value.length > 15) return { ok: false, reason: "length" };
  return { ok: true, digits: value };
}

/** Plain-language reasons, safe to show a user (they never echo the input). */
export const PHONE_REJECTION_COPY: Record<PhoneRejection, string> = {
  empty: "Enter the phone number linked to your WhatsApp.",
  characters: "Use digits only, with the country code (for example 919876543210).",
  country_code: "Start with the country code, not a leading 0 (for example 91 for India).",
  length: "That number is the wrong length. Include the country code and the full number.",
};
