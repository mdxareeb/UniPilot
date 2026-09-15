/**
 * The WhatsApp integration service (Task 46.14 / P4.2) — the only module that
 * reads a student's integration rows and owns the service-side writes the
 * client-role policies cannot do.
 *
 * The repo pattern of `lib/data/documents.ts`: server-only, typed against the
 * generated `Database` view. Reads and the run guard use the request-scoped
 * cookie client, so the authenticated session identifies the caller and the
 * owner-only RLS policies on `integration_*` are the enforcement layer; every
 * query is additionally scoped by `user_id`. The service client is used where
 * the tables have no client write policy (spec D5): the retention and
 * stale-run sweeps, run reservation/finalize/abort, candidate confirm/reject
 * (the events provenance trigger only lets the service role write WhatsApp
 * source), and the live-run reservation.
 *
 * P7.1 adds the Google Calendar half: `isGoogleConfigured` (the OAuth env
 * pair), `storeGoogleCredentials`/`clearGoogleCredentials` (the service-only
 * encrypted-token RPCs) and `backfillGooglePushes` (the bounded, ids-only
 * `whatsapp.push` enqueue the callback runs after a connect). The OAuth
 * cookie/callback constants live here too, so the start action and the route
 * cannot drift apart. P7.2 runs that same backfill on every overview read
 * whose stored google row is `connected` (the row is the authority, not the
 * env — a self-host without the OAuth pair still heals its push queue, and
 * the keyed-on-row read is what the committed no-env stack can exercise).
 *
 * Errors are generic: raw Supabase/Storage text never leaves this module; the
 * Server Actions map a throw to the domain's sanitized copy.
 */
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { enqueueJob } from "./jobs";
import { readProfileTimeZone } from "./profileTime";
import {
  connectionRowToItem,
  GOOGLE_PUSH_RETRY_WINDOW_MS,
  integrationCandidateRowToItem,
  integrationRunRowToItem,
  parseWhatsAppExport,
  WHATSAPP_ACTIVE_RUN_LIMIT,
  WHATSAPP_ACTIVE_WINDOW_MS,
  WHATSAPP_EXPORT_BUCKET,
  WHATSAPP_EXPORT_MAX_BYTES,
  WHATSAPP_LIVE_CHAT_MAX_LENGTH,
  WHATSAPP_RUNS_PER_DAY,
  type WhatsAppCandidateItem,
  type WhatsAppConnectionItem,
  type WhatsAppExportDraft,
  type WhatsAppRunItem,
} from "./integrationValues";

const RUN_COLUMNS =
  "id, mode, review_mode, status, storage_path, chat_name, message_count, candidate_count, error, started_at, completed_at, created_at";
const CANDIDATE_COLUMNS =
  "id, title, status, start_at, end_at, all_day, message_sender, message_text, pushed_at, push_error, created_at";
const CONNECTION_COLUMNS =
  "id, status, review_mode, date_order, detect_relative_dates, profile_ref, last_error";

/**
 * 46.14 — the raw archive's 30-day best-effort purge (spec §6.10). The table
 * has owner SELECT but no client DELETE policy, so the service role is
 * required; a failure is the caller's to swallow.
 */
export async function purgeExpiredWhatsAppMessages(
  userId: string,
): Promise<void> {
  const service = createServiceClient();
  const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
  await service
    .from("integration_messages")
    .delete()
    .eq("user_id", userId)
    .lt("created_at", cutoff);
}

/**
 * P2.5 ruling — one stale sweep for both settlement gaps: an export
 * reservation whose direct upload never finalized (`queued`) and a run whose
 * worker died outside a `ServiceError` (`running`). Both older than the
 * one-hour active window are marked failed with sanitized copy; a failure is
 * the caller's to swallow.
 */
export async function failStaleRuns(userId: string): Promise<void> {
  const service = createServiceClient();
  const cutoff = new Date(
    Date.now() - WHATSAPP_ACTIVE_WINDOW_MS,
  ).toISOString();
  await Promise.all([
    service
      .from("integration_runs")
      .update({ status: "failed", error: "The upload never finished." })
      .eq("user_id", userId)
      .eq("status", "queued")
      .lt("created_at", cutoff),
    service
      .from("integration_runs")
      .update({ status: "failed", error: "The scan stopped unexpectedly." })
      .eq("user_id", userId)
      .eq("status", "running")
      .lt("created_at", cutoff),
  ]);
}

/**
 * D13's guard inputs, counted through the request client (owner RLS):
 * `active` is the queued|running slot count, `last24h` the rolling-day total.
 */
export async function getRunGuard(
  userId: string,
): Promise<{ active: number; last24h: number }> {
  const supabase = await createClient();
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const [active, recent] = await Promise.all([
    supabase
      .from("integration_runs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .in("status", ["queued", "running"]),
    supabase
      .from("integration_runs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", dayAgo),
  ]);
  if (active.error || recent.error) {
    throw new Error("Failed to read WhatsApp usage.");
  }
  return { active: active.count ?? 0, last24h: recent.count ?? 0 };
}

/**
 * The connection half of the status poll (P4.4/P6): the caller's WhatsApp
 * connection mapped to the serializable display contract, or null when none
 * has been linked.
 */
export async function getConnectionPoll(
  userId: string,
): Promise<WhatsAppConnectionItem | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("integration_connections")
    .select(CONNECTION_COLUMNS)
    .eq("user_id", userId)
    .eq("provider", "whatsapp")
    .maybeSingle();

  if (error) throw new Error("Failed to load the WhatsApp connection.");
  return data ? connectionRowToItem(data) : null;
}

/**
 * The candidate half of the status poll (P4.4): the caller's suggestions
 * newest first, mapped in the profile's zone to the serializable review
 * contract.
 */
export async function getCandidatePoll(
  userId: string,
): Promise<WhatsAppCandidateItem[]> {
  const supabase = await createClient();

  const [timeZone, result] = await Promise.all([
    readProfileTimeZone(supabase, userId),
    supabase
      .from("integration_candidates")
      .select(CANDIDATE_COLUMNS)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: true }),
  ]);

  if (result.error) throw new Error("Failed to load WhatsApp suggestions.");
  return (result.data ?? []).map((row) =>
    integrationCandidateRowToItem(row, timeZone),
  );
}

/** What the integrations page and the status poll render (P5.1/P4.4). */
export type WhatsAppOverview = {
  connection: WhatsAppConnectionItem | null;
  runs: WhatsAppRunItem[];
  candidates: WhatsAppCandidateItem[];
  liveEnabled: boolean;
};

/**
 * 46.14 — the `/integrations` read. The two best-effort hygiene sweeps run
 * first (expired raw messages, stale runs) and never block the page: a failed
 * cleanup must not hide the data the user came for. P7.2 then heals the push
 * queue: when the stored google row is `connected`, a bounded backfill
 * enqueues `whatsapp.push` for confirmed, event-backed, never-pushed
 * candidates that no active job covers — the same best-effort contract, and
 * keyed on the row alone (no OAuth env required). The rest reads through the
 * request client, owner-scoped, and maps with `integrationValues`.
 */
export async function getWhatsAppOverview(
  userId: string,
): Promise<WhatsAppOverview> {
  try {
    await Promise.all([
      purgeExpiredWhatsAppMessages(userId),
      failStaleRuns(userId),
    ]);
    if (await isGoogleConnectionConnected(userId)) {
      await backfillGooglePushes(userId, GOOGLE_PUSH_BACKFILL_LIMIT);
    }
  } catch {
    // Best-effort hygiene/backfill; never blocks the page.
  }

  const supabase = await createClient();
  const [timeZone, connection, runs, candidates] = await Promise.all([
    readProfileTimeZone(supabase, userId),
    getConnectionPoll(userId),
    supabase
      .from("integration_runs")
      .select(RUN_COLUMNS)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: true }),
    getCandidatePoll(userId),
  ]);

  if (runs.error) throw new Error("Failed to load WhatsApp scans.");

  return {
    connection,
    runs: (runs.data ?? []).map((row) =>
      integrationRunRowToItem(row, timeZone),
    ),
    candidates,
    liveEnabled: isLiveEnabled(),
  };
}

/** Whether this server may offer live self-host WhatsApp access (P6). */
export function isLiveEnabled(): boolean {
  return process.env.UNIPILOT_WHATSAPP_LIVE === "1";
}

/** The Google Calendar state the card renders (P5.1/P7.2). */
export type GoogleConnectionStatus = {
  /** Both OAuth env vars are present on this server. */
  configured: boolean;
  /** The caller's google row is `connected` and the server is configured. */
  connected: boolean;
  status: "connected" | "not_connected" | "not_configured" | "error";
};

/** The state cookie `connectGoogleCalendarAction` sets (P7.1). */
export const GOOGLE_OAUTH_STATE_COOKIE = "google_oauth_state";

/** The callback path both OAuth halves build the redirect URI from (P7.1). */
export const GOOGLE_OAUTH_CALLBACK_PATH = "/api/integrations/google/callback";

/** The Calendar scope requested at authorize time and stored with the token. */
export const GOOGLE_CALENDAR_SCOPE =
  "https://www.googleapis.com/auth/calendar.events";

/** Whether this server has the OAuth client pair (P7.1's gate). */
export function isGoogleConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID &&
      process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  );
}

/**
 * 46.17 — the Google half of the integrations read: the OAuth client's
 * presence plus the caller's owner-scoped connection row. A half-configured
 * server is honestly `not_configured`; a stored `error` survives as `error`;
 * `connected` also requires the env pair so a stale row cannot claim a live
 * OAuth client.
 */
export async function getGoogleStatus(
  userId: string,
): Promise<GoogleConnectionStatus> {
  const configured = isGoogleConfigured();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("integration_connections")
    .select("status")
    .eq("user_id", userId)
    .eq("provider", "google")
    .maybeSingle();

  if (error) throw new Error("Failed to load Google Calendar status.");
  if (!configured) {
    return { configured: false, connected: false, status: "not_configured" };
  }

  const connected = data?.status === "connected";
  return {
    configured: true,
    connected,
    status: connected
      ? "connected"
      : data?.status === "error"
        ? "error"
        : "not_connected",
  };
}

/**
 * P7.2 — the overview backfill's gate: the caller's stored google row is
 * `connected`. Deliberately independent of `isGoogleConfigured`: the row is
 * the user's real grant, and the push worker decides for itself whether the
 * host can act on it. A failed read answers `false`, so the backfill is
 * skipped rather than blocking the page.
 */
async function isGoogleConnectionConnected(userId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("integration_connections")
    .select("status")
    .eq("user_id", userId)
    .eq("provider", "google")
    .maybeSingle();
  if (error) return false;
  return data?.status === "connected";
}

/**
 * P7.1 — persist the refresh token through the service-only RPC (the
 * credential table has no client policy and the token is encrypted with
 * `UNIPILOT_INTEGRATIONS_KEY`). Only the refresh token ever reaches this
 * function: the access token is discarded by the callback. A failed write
 * throws the module's generic error.
 */
export async function storeGoogleCredentials(
  userId: string,
  refreshToken: string,
  scope: string,
): Promise<void> {
  const service = createServiceClient();
  const { error } = await service.rpc("upsert_google_credentials", {
    p_user_id: userId,
    p_refresh_token: refreshToken,
    p_scope: scope,
    p_calendar_id: "primary",
    p_key: process.env.UNIPILOT_INTEGRATIONS_KEY ?? "",
  });
  if (error) throw new Error("Failed to store Google Calendar credentials.");
}

/**
 * P7.1 — delete the caller's stored refresh token through the service-only
 * RPC. A missing row is nothing to clear, so a successful RPC is the answer.
 */
export async function clearGoogleCredentials(userId: string): Promise<void> {
  const service = createServiceClient();
  const { error } = await service.rpc("delete_google_credentials", {
    p_user_id: userId,
  });
  if (error) throw new Error("Failed to disconnect Google Calendar.");
}

/** The per-connect backfill bound: at most this many pushes are enqueued. */
export const GOOGLE_PUSH_BACKFILL_LIMIT = 100;

/**
 * P7.1/P7.2 — the (re)connect and connected-overview backfill: enqueue
 * `whatsapp.push` for the caller's confirmed, event-backed candidates that
 * have never been pushed, oldest first and bounded by `limit`. Two cover sets
 * suppress a duplicate: a candidate with an active (queued/running) push job,
 * and one whose latest terminal failure (`failed`/`dead_letter`) is younger
 * than `GOOGLE_PUSH_RETRY_WINDOW_MS` — so a lost enqueue heals on the next
 * read, but a dead job is retried at most once per window instead of on every
 * read (the overview read runs on the 3 s status poll too). The payload is
 * ids-only, exactly like the confirm action's.
 */
export async function backfillGooglePushes(
  userId: string,
  limit = GOOGLE_PUSH_BACKFILL_LIMIT,
): Promise<number> {
  const service = createServiceClient();
  const candidates = await service
    .from("integration_candidates")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "confirmed")
    .not("event_id", "is", null)
    .is("pushed_at", null)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(limit);

  if (candidates.error) throw new Error("Failed to backfill Google pushes.");
  const ids = (candidates.data ?? []).map((row) => row.id);
  if (ids.length === 0) return 0;

  const failureCutoff = new Date(
    Date.now() - GOOGLE_PUSH_RETRY_WINDOW_MS,
  ).toISOString();
  const [active, recentFailures] = await Promise.all([
    service
      .from("jobs")
      .select("payload")
      .eq("user_id", userId)
      .eq("kind", "whatsapp.push")
      .in("status", ["queued", "running"])
      .in("payload->>candidateId", ids),
    service
      .from("jobs")
      .select("payload")
      .eq("user_id", userId)
      .eq("kind", "whatsapp.push")
      .in("status", ["failed", "dead_letter"])
      .gte("created_at", failureCutoff)
      .in("payload->>candidateId", ids),
  ]);

  if (active.error || recentFailures.error) {
    throw new Error("Failed to backfill Google pushes.");
  }
  const covered = new Set<string>();
  for (const job of [...(active.data ?? []), ...(recentFailures.data ?? [])]) {
    const id =
      typeof job.payload === "object" && job.payload !== null
        ? (job.payload as { candidateId?: unknown }).candidateId
        : null;
    if (typeof id === "string") covered.add(id);
  }

  let enqueued = 0;
  for (const id of ids) {
    if (covered.has(id)) continue;
    await enqueueJob("whatsapp.push", { candidateId: id }, { userId });
    enqueued += 1;
  }
  return enqueued;
}

/** What a reservation attempt can honestly answer (spec D13). */
export type ReserveExportRunResult =
  | { status: "ok"; runId: string; uploadPath: string }
  | { status: "active" }
  | { status: "rate" };

/**
 * D13/§13 — reserve an export run: the guard first, then one `queued` row and
 * one server-generated storage path, created together. The run records the
 * upload's review mode (46.21) and its detection settings (46.26); all three
 * are persisted as the caller's WhatsApp connection defaults: an existing
 * `(user_id, provider='whatsapp')` row is patched on `review_mode`,
 * `date_order` and `detect_relative_dates` ONLY — its transport `mode`/status
 * are never touched, so a live-linked row survives — while a missing row is
 * created `disconnected` so a never-linked owner still has defaults. The
 * defaults are written before the run row on purpose: a failed default write
 * leaves nothing reserved, whereas the reverse order could leak a queued run
 * that blocks the single active slot until the stale sweep. The browser
 * uploads directly to the reserved path; `finalizeExportRun` verifies the
 * object and `abortExportRun` discards both halves when the upload fails.
 */
export async function reserveExportRun(
  userId: string,
  draft: WhatsAppExportDraft,
): Promise<ReserveExportRunResult> {
  // Defence in depth at the write boundary: the action parses first, but a
  // direct service call must not reserve a run for an invalid selection.
  const parsed = parseWhatsAppExport(draft);
  if (parsed === null) {
    throw new Error("Failed to start the scan.");
  }

  const guard = await getRunGuard(userId);
  if (guard.active >= WHATSAPP_ACTIVE_RUN_LIMIT) return { status: "active" };
  if (guard.last24h >= WHATSAPP_RUNS_PER_DAY) return { status: "rate" };

  const service = createServiceClient();

  const connection = await service
    .from("integration_connections")
    .select("id")
    .eq("user_id", userId)
    .eq("provider", "whatsapp")
    .maybeSingle();
  if (connection.error) throw new Error("Failed to start the scan.");

  if (connection.data) {
    const patched = await service
      .from("integration_connections")
      .update({
        review_mode: parsed.reviewMode,
        date_order: parsed.dateOrder,
        detect_relative_dates: parsed.detectRelativeDates,
      })
      .eq("id", connection.data.id)
      .eq("user_id", userId);
    if (patched.error) throw new Error("Failed to start the scan.");
  } else {
    const inserted = await service.from("integration_connections").insert({
      user_id: userId,
      provider: "whatsapp",
      mode: "export",
      status: "disconnected",
      review_mode: parsed.reviewMode,
      date_order: parsed.dateOrder,
      detect_relative_dates: parsed.detectRelativeDates,
    });
    if (inserted.error) throw new Error("Failed to start the scan.");
  }

  const id = crypto.randomUUID();
  const uploadPath = `${userId}/${id}/export.txt`;
  const { error } = await service.from("integration_runs").insert({
    id,
    user_id: userId,
    mode: "export",
    review_mode: parsed.reviewMode,
    status: "queued",
    storage_path: uploadPath,
  });
  if (error) throw new Error("Failed to start the scan.");
  return { status: "ok", runId: id, uploadPath };
}

/** Finalize's three honest outcomes; "rejected" cleaned up after itself. */
export type FinalizeExportRunResult =
  | { status: "ok" }
  | { status: "not-found" }
  | { status: "rejected" };

/**
 * §13 — verify a reservation's real object: it must exist, be non-empty and
 * within the 25 MiB cap. A missing, empty or oversized object and its row are
 * discarded before the caller hears about it, so a rejected upload can never
 * be enqueued for scanning.
 */
export async function finalizeExportRun(
  userId: string,
  runId: string,
): Promise<FinalizeExportRunResult> {
  const service = createServiceClient();
  const run = await service
    .from("integration_runs")
    .select("id, storage_path")
    .eq("id", runId)
    .eq("user_id", userId)
    .maybeSingle();

  if (run.error || !run.data?.storage_path) return { status: "not-found" };

  const path = run.data.storage_path;
  const info = await service.storage.from(WHATSAPP_EXPORT_BUCKET).info(path);
  const size = info.data?.size ?? 0;
  if (info.error || size <= 0 || size > WHATSAPP_EXPORT_MAX_BYTES) {
    await service.storage.from(WHATSAPP_EXPORT_BUCKET).remove([path]);
    await service
      .from("integration_runs")
      .delete()
      .eq("id", runId)
      .eq("user_id", userId);
    return { status: "rejected" };
  }

  return { status: "ok" };
}

/**
 * The client's cleanup after a failed direct upload: the object first (best
 * effort — a failed upload may never have written it), then the reserved row.
 */
export async function abortExportRun(
  userId: string,
  runId: string,
): Promise<void> {
  const service = createServiceClient();
  const run = await service
    .from("integration_runs")
    .select("id, storage_path")
    .eq("id", runId)
    .eq("user_id", userId)
    .maybeSingle();

  if (run.error) throw new Error("Failed to cancel the scan.");
  if (!run.data) return;

  if (run.data.storage_path !== null) {
    await service.storage
      .from(WHATSAPP_EXPORT_BUCKET)
      .remove([run.data.storage_path]);
  }

  const { error } = await service
    .from("integration_runs")
    .delete()
    .eq("id", runId)
    .eq("user_id", userId);
  if (error) throw new Error("Failed to cancel the scan.");
}

/** What a live-scan reservation can honestly answer (spec D13). */
export type StartLiveScanResult =
  | { status: "ok"; runId: string }
  | { status: "active" }
  | { status: "rate" }
  | { status: "invalid" };

/**
 * P6 — reserve a live run: a trimmed, non-empty chat name up to 100 chars,
 * the same D13 guard, and the caller's connected WhatsApp row attached when
 * one exists (the column is nullable, so an unattached scan is fine).
 */
export async function startLiveScan(
  userId: string,
  chatName: string,
): Promise<StartLiveScanResult> {
  const name = chatName.trim();
  if (name.length === 0 || name.length > WHATSAPP_LIVE_CHAT_MAX_LENGTH) {
    return { status: "invalid" };
  }

  const guard = await getRunGuard(userId);
  if (guard.active >= WHATSAPP_ACTIVE_RUN_LIMIT) return { status: "active" };
  if (guard.last24h >= WHATSAPP_RUNS_PER_DAY) return { status: "rate" };

  const supabase = await createClient();
  const connection = await supabase
    .from("integration_connections")
    .select("id")
    .eq("user_id", userId)
    .eq("provider", "whatsapp")
    .eq("status", "connected")
    .maybeSingle();

  if (connection.error) throw new Error("Failed to start the scan.");

  const id = crypto.randomUUID();
  const service = createServiceClient();
  const { error } = await service.from("integration_runs").insert({
    id,
    user_id: userId,
    connection_id: connection.data?.id ?? null,
    mode: "live",
    status: "queued",
    chat_name: name,
  });
  if (error) throw new Error("Failed to start the scan.");
  return { status: "ok", runId: id };
}

/** Confirm's two honest outcomes; "ok" carries the settled event. */
export type ConfirmCandidateResult =
  | { status: "ok"; eventId: string; fingerprint: string }
  | { status: "not-found" };

/**
 * §13 — confirm a pending suggestion. The service role is required because
 * the provenance trigger (`lock_event_provenance`) forces `manual` for every
 * non-service caller. The event upsert is deduped on the fingerprint
 * (`on conflict do nothing`), falling back to the existing row when a re-scan
 * or double-click already created it; the candidate then settles with that
 * event id. A candidate that is no longer pending is not-found, so two
 * reviewers cannot both "add" it.
 */
export async function confirmCandidate(
  userId: string,
  candidateId: string,
): Promise<ConfirmCandidateResult> {
  const service = createServiceClient();
  const candidate = await service
    .from("integration_candidates")
    .select(
      "id, fingerprint, title, start_at, end_at, all_day, message_sender, message_text, status",
    )
    .eq("id", candidateId)
    .eq("user_id", userId)
    .maybeSingle();

  if (candidate.error) throw new Error("Failed to review the suggestion.");
  if (!candidate.data || candidate.data.status !== "pending") {
    return { status: "not-found" };
  }

  const upsert = await service
    .from("events")
    .upsert(
      {
        user_id: userId,
        title: candidate.data.title,
        description: `From WhatsApp (${candidate.data.message_sender}):\n\n${candidate.data.message_text}`,
        start_at: candidate.data.start_at,
        end_at: candidate.data.end_at,
        all_day: candidate.data.all_day,
        source: "whatsapp",
        source_ref: candidate.data.fingerprint,
      },
      { onConflict: "user_id,source,source_ref", ignoreDuplicates: true },
    )
    .select("id")
    .maybeSingle();

  let eventId = upsert.data?.id ?? null;
  if (!eventId) {
    const existing = await service
      .from("events")
      .select("id")
      .eq("user_id", userId)
      .eq("source", "whatsapp")
      .eq("source_ref", candidate.data.fingerprint)
      .single();
    if (existing.error || !existing.data) {
      throw new Error("Failed to add the event.");
    }
    eventId = existing.data.id;
  }

  const settled = await service
    .from("integration_candidates")
    .update({ status: "confirmed", event_id: eventId })
    .eq("id", candidateId)
    .eq("user_id", userId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (!settled.data) return { status: "not-found" };
  return {
    status: "ok",
    eventId,
    fingerprint: candidate.data.fingerprint,
  };
}

/**
 * §13 — reject a pending suggestion. Rejection is terminal (the fingerprint is
 * unique), so a candidate that is no longer pending settles false and the
 * action answers with the already-reviewed copy.
 */
export async function rejectCandidate(
  userId: string,
  candidateId: string,
): Promise<boolean> {
  const service = createServiceClient();
  const { data } = await service
    .from("integration_candidates")
    .update({ status: "rejected" })
    .eq("id", candidateId)
    .eq("user_id", userId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  return Boolean(data);
}
