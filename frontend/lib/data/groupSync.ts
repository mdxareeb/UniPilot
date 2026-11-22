/**
 * WhatsApp group live sync (Stage 1): the server-side data layer.
 *
 * The web app never talks to WhatsApp. It writes `whatsapp_sessions.desired_state`
 * and the separate `whatsapp-bridge` process (a long-running, read-only Baileys
 * listener) reconciles toward it; the UI reads the resulting status back. The
 * database is the whole interface because Realtime is disabled locally.
 *
 * Reads use the request client (owner RLS). The two writes that RLS does not
 * allow a browser session (`whatsapp_sessions`, the QR secret) use the service
 * role and re-scope every statement by `user_id`. The one client-permitted
 * write, `monitored_groups.is_active`, goes through the owner's own session.
 *
 * Errors are generic: raw Supabase text never leaves this module.
 */
import QRCode from "qrcode";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { createServiceClient } from "@/lib/supabase/service";
import {
  BRIDGE_HEARTBEAT_STALE_MS,
  deriveGroupSyncState,
  EMPTY_GROUP_SYNC,
  groupCandidateRowToItem,
  groupRowToItem,
  sanitizePhone,
  sortGroups,
  type GroupSyncSnapshot,
} from "./groupSyncValues";
import { readProfileTimeZone } from "./profileTime";

/** Server-only flag (no `NEXT_PUBLIC_`): the page passes the result as a prop. */
export function isGroupSyncEnabled(): boolean {
  return process.env.UNIPILOT_WHATSAPP_BRIDGE === "1";
}

const SESSION_COLUMNS =
  "status, desired_state, last_error, bridge_heartbeat_at, requested_at";
const GROUP_COLUMNS = "id, group_name, is_active, activated_at, last_synced_at";
const CANDIDATE_COLUMNS =
  "id, title, kind, task_type, event_type, start_at, all_day, message_sender, message_text, confidence, proposed_subject_name, group_name, subject:subjects(name)";

/** The QR as an `<img>`-ready data URL (the old live panel renders the same way). */
async function readQrImage(userId: string): Promise<string | null> {
  const key = process.env.UNIPILOT_INTEGRATIONS_KEY;
  if (!key) return null;
  const service = createServiceClient();
  const { data, error } = await service.rpc("get_whatsapp_session_qr", {
    p_user_id: userId,
    p_key: key,
  });
  if (error || typeof data !== "string" || data.length === 0) return null;
  // Black on white regardless of theme: a QR must keep its contrast to scan.
  return QRCode.toDataURL(data, {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 240,
    color: { dark: "#000000", light: "#ffffff" },
  });
}

/**
 * The live pairing code and when it stops working, or null once it has expired.
 * Like the QR it is a login credential: read through the service-role RPC, shown
 * only to its owner, and never cached.
 */
async function readPairing(
  userId: string,
): Promise<{ code: string; expiresAt: string } | null> {
  const key = process.env.UNIPILOT_INTEGRATIONS_KEY;
  if (!key) return null;
  const service = createServiceClient();
  const { data, error } = await service.rpc("get_whatsapp_pairing_status", {
    p_user_id: userId,
    p_key: key,
  });
  if (error || !Array.isArray(data) || data.length === 0) return null;
  const row = data[0];
  if (typeof row?.code !== "string" || typeof row?.expires_at !== "string") return null;
  return { code: row.code, expiresAt: row.expires_at };
}

export async function getGroupSyncSnapshot(
  userId: string,
  options: { client?: SupabaseClient<Database> } = {},
): Promise<GroupSyncSnapshot> {
  if (!isGroupSyncEnabled()) return EMPTY_GROUP_SYNC;

  const supabase = options.client ?? (await createClient());
  const [session, groups, candidates, timeZone] = await Promise.all([
    supabase
      .from("whatsapp_sessions")
      .select(SESSION_COLUMNS)
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("monitored_groups")
      .select(GROUP_COLUMNS)
      .eq("user_id", userId),
    supabase
      .from("integration_candidates")
      .select(CANDIDATE_COLUMNS)
      .eq("user_id", userId)
      .eq("origin", "live_group")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .order("id", { ascending: true }),
    readProfileTimeZone(supabase, userId),
  ]);
  if (session.error) throw new Error("Failed to load the WhatsApp link.");
  if (groups.error) throw new Error("Failed to load the WhatsApp groups.");
  if (candidates.error) throw new Error("Failed to load the suggestions.");

  const state = deriveGroupSyncState(session.data, Date.now());
  const qr = state === "qr_ready" ? await readQrImage(userId) : null;
  const pairing = state === "code_ready" ? await readPairing(userId) : null;

  return {
    state,
    lastError: state === "error" ? (session.data?.last_error ?? null) : null,
    qr,
    pairing,
    groups: sortGroups((groups.data ?? []).map(groupRowToItem)),
    review: (candidates.data ?? []).map((row) =>
      groupCandidateRowToItem(row, timeZone),
    ),
  };
}

export type ConfirmGroupCandidateResult =
  | { status: "ok" }
  | { status: "not-found" };

/**
 * Add a pending live-group suggestion to the workspace.
 *
 * A task suggestion becomes a `tasks` row, an event suggestion an `events` row,
 * both with `whatsapp_group` provenance and the candidate's fingerprint as the
 * `source_ref`, so a later re-detection of the same message is a no-op. When the
 * suggestion proposed a NEW course, the course is created here (and only here,
 * on the student's say-so), reusing an existing subject of the same name.
 */
export async function confirmGroupCandidate(
  userId: string,
  candidateId: string,
): Promise<ConfirmGroupCandidateResult> {
  const service = createServiceClient();
  const found = await service
    .from("integration_candidates")
    .select(
      "id, fingerprint, kind, title, start_at, end_at, all_day, task_type, event_type, confidence, subject_id, proposed_subject_name, source_message_id, group_name, message_text, status",
    )
    .eq("id", candidateId)
    .eq("user_id", userId)
    .eq("origin", "live_group")
    .maybeSingle();
  if (found.error) throw new Error("Failed to review the suggestion.");
  const candidate = found.data;
  if (!candidate || candidate.status !== "pending") return { status: "not-found" };
  if (candidate.kind === "event" && candidate.start_at === null) {
    return { status: "not-found" };
  }

  let subjectId = candidate.subject_id;
  if (!subjectId && candidate.proposed_subject_name) {
    subjectId = await ensureSubject(userId, candidate.proposed_subject_name);
  }

  const description = `From WhatsApp${
    candidate.group_name ? ` (${candidate.group_name})` : ""
  }: ${candidate.message_text}`.slice(0, 500);

  let eventId: string | null = null;
  if (candidate.kind === "task") {
    const { error } = await service.from("tasks").upsert(
      {
        user_id: userId,
        title: candidate.title,
        description,
        status: "todo",
        due_date: candidate.start_at,
        subject_id: subjectId,
        source: "whatsapp_group",
        source_ref: candidate.fingerprint,
        source_message_id: candidate.source_message_id,
        confidence_score: candidate.confidence,
        task_type: candidate.task_type,
      },
      { onConflict: "user_id,source,source_ref", ignoreDuplicates: true },
    );
    if (error) throw new Error("Failed to add the task.");
  } else {
    const upsert = await service
      .from("events")
      .upsert(
        {
          user_id: userId,
          title: candidate.title,
          description,
          start_at: candidate.start_at as string,
          end_at: candidate.end_at,
          all_day: candidate.all_day,
          type: candidate.event_type,
          subject_id: subjectId,
          source: "whatsapp_group",
          source_ref: candidate.fingerprint,
          source_message_id: candidate.source_message_id,
          confidence_score: candidate.confidence,
        },
        { onConflict: "user_id,source,source_ref", ignoreDuplicates: true },
      )
      .select("id")
      .maybeSingle();
    if (upsert.error) throw new Error("Failed to add the event.");
    eventId = upsert.data?.id ?? null;
    if (!eventId) {
      const existing = await service
        .from("events")
        .select("id")
        .eq("user_id", userId)
        .eq("source", "whatsapp_group")
        .eq("source_ref", candidate.fingerprint)
        .single();
      if (existing.error || !existing.data) throw new Error("Failed to add the event.");
      eventId = existing.data.id;
    }
  }

  const settled = await service
    .from("integration_candidates")
    .update({ status: "confirmed", event_id: eventId, subject_id: subjectId })
    .eq("id", candidateId)
    .eq("user_id", userId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (!settled.data) return { status: "not-found" };
  return { status: "ok" };
}

/** The student's subject with this name, created on first use. */
async function ensureSubject(userId: string, name: string): Promise<string> {
  const service = createServiceClient();
  const clean = name.trim().slice(0, 100);
  const existing = await service
    .from("subjects")
    .select("id")
    .eq("user_id", userId)
    .eq("name", clean)
    .maybeSingle();
  if (existing.error) throw new Error("Failed to find the course.");
  if (existing.data) return existing.data.id;

  const created = await service
    .from("subjects")
    .upsert({ user_id: userId, name: clean }, { onConflict: "user_id,name", ignoreDuplicates: true })
    .select("id")
    .maybeSingle();
  if (created.error) throw new Error("Failed to create the course.");
  if (created.data) return created.data.id;

  // A concurrent confirm created it first.
  const again = await service
    .from("subjects")
    .select("id")
    .eq("user_id", userId)
    .eq("name", clean)
    .single();
  if (again.error || !again.data) throw new Error("Failed to create the course.");
  return again.data.id;
}

/** Thrown for a number that cannot be used; the message is safe to show. */
export class InvalidPhoneError extends Error {
  readonly reason: "empty" | "characters" | "country_code" | "length";
  constructor(reason: InvalidPhoneError["reason"]) {
    super("That phone number cannot be used.");
    this.name = "InvalidPhoneError";
    this.reason = reason;
  }
}

/** A link was requested moments ago and has not finished; do not hammer WhatsApp. */
export class GroupLinkThrottledError extends Error {
  constructor() {
    super("A link request is already in progress.");
    this.name = "GroupLinkThrottledError";
  }
}

/** The account is already linked; disconnect first. */
export class GroupAlreadyLinkedError extends Error {
  constructor() {
    super("WhatsApp is already linked.");
    this.name = "GroupAlreadyLinkedError";
  }
}

/** Minimum gap between two link requests while one is unfinished (ms). */
export const GROUP_LINK_MIN_INTERVAL_MS = 15_000;

export type GroupLinkRequest =
  | { method: "qr" }
  | { method: "pairing_code"; phone: unknown };

/**
 * Ask the bridge to link this user's WhatsApp.
 *
 * `qr` (web): the bridge publishes a QR to scan with another device.
 * `pairing_code` (mobile): a QR shown on the phone cannot be scanned by the same
 * phone, so the user's number is sanitised to digits-only E.164, stored
 * ENCRYPTED next to the session secrets, and the bridge asks WhatsApp for an
 * 8-character code the user types under Linked devices. The number is deleted
 * as soon as the link succeeds or the attempt ends.
 */
export async function requestGroupLink(
  userId: string,
  request: GroupLinkRequest = { method: "qr" },
): Promise<void> {
  const service = createServiceClient();

  if (request.method === "pairing_code") {
    const phone = sanitizePhone(request.phone);
    if (!phone.ok) throw new InvalidPhoneError(phone.reason);

    // Each pairing request is a handshake with WhatsApp: refuse a second one
    // while the first is still in flight, and refuse one for a linked account.
    const current = await service
      .from("whatsapp_sessions")
      .select("status, desired_state, requested_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (current.error) throw new Error("Failed to request the WhatsApp link.");
    if (current.data?.status === "connected" && current.data.desired_state === "connected") {
      throw new GroupAlreadyLinkedError();
    }
    const requestedAt = current.data?.requested_at
      ? Date.parse(current.data.requested_at)
      : NaN;
    if (
      current.data?.desired_state === "connected" &&
      !Number.isNaN(requestedAt) &&
      Date.now() - requestedAt < GROUP_LINK_MIN_INTERVAL_MS
    ) {
      throw new GroupLinkThrottledError();
    }
    const key = process.env.UNIPILOT_INTEGRATIONS_KEY;
    if (!key) throw new Error("Failed to request the WhatsApp link.");

    // Drop any earlier code, then store the number: only the newest attempt lives.
    await service.rpc("clear_whatsapp_pairing", { p_user_id: userId });
    const stored = await service.rpc("set_whatsapp_pairing_phone", {
      p_user_id: userId,
      p_phone: phone.digits,
      p_key: key,
    });
    if (stored.error) throw new Error("Failed to request the WhatsApp link.");
  }

  const { error } = await service.from("whatsapp_sessions").upsert(
    {
      user_id: userId,
      desired_state: "connected",
      link_method: request.method,
      requested_at: new Date().toISOString(),
      last_error: null,
    },
    { onConflict: "user_id" },
  );
  if (error) throw new Error("Failed to request the WhatsApp link.");
}

export type DisconnectOutcome = "requested" | "forgotten";

/**
 * Disconnect. With a live bridge it logs the device out and forgets every
 * secret. With no bridge running nobody can log the device out, so the secrets
 * are forgotten here and the caller tells the user to unlink it on the phone.
 * Either way the 30-day raw archive is deleted now (extracted tasks, events
 * and files keep their rows: `source_message_id` is ON DELETE SET NULL).
 */
export async function requestGroupDisconnect(
  userId: string,
): Promise<DisconnectOutcome> {
  const service = createServiceClient();
  const session = await service
    .from("whatsapp_sessions")
    .select("bridge_heartbeat_at, status")
    .eq("user_id", userId)
    .maybeSingle();
  if (session.error) throw new Error("Failed to disconnect WhatsApp.");

  const heartbeat = session.data?.bridge_heartbeat_at
    ? Date.parse(session.data.bridge_heartbeat_at)
    : NaN;
  const bridgeAlive =
    !Number.isNaN(heartbeat) && Date.now() - heartbeat <= BRIDGE_HEARTBEAT_STALE_MS;

  await service.from("raw_messages").delete().eq("user_id", userId);

  if (bridgeAlive) {
    const { error } = await service
      .from("whatsapp_sessions")
      .update({
        desired_state: "disconnected",
        requested_at: new Date().toISOString(),
      })
      .eq("user_id", userId);
    if (error) throw new Error("Failed to disconnect WhatsApp.");
    return "requested";
  }

  const cleared = await service.rpc("clear_whatsapp_session", {
    p_user_id: userId,
  });
  if (cleared.error) throw new Error("Failed to disconnect WhatsApp.");
  if (session.data) {
    const { error } = await service
      .from("whatsapp_sessions")
      .update({
        desired_state: "disconnected",
        status: "disconnected",
        connected_at: null,
        last_error: null,
        requested_at: new Date().toISOString(),
      })
      .eq("user_id", userId);
    if (error) throw new Error("Failed to disconnect WhatsApp.");
  }
  return "forgotten";
}

/**
 * Switch a group on or off. Uses the owner's own session: RLS plus the
 * `is_active`-only column grant are the enforcement, not this code.
 */
export async function setGroupActive(
  userId: string,
  groupId: string,
  active: boolean,
): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("monitored_groups")
    .update({ is_active: active })
    .eq("id", groupId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();
  if (error) throw new Error("Failed to update the group.");
  return Boolean(data);
}
