"use server";

/**
 * The WhatsApp integration Server Actions (Task 46.14 / P4.3), the repo
 * pattern of `lib/data/documentActions.ts`: the gate runs first and outside
 * the try block, untrusted payloads are parsed and validated on the server,
 * the service does the work, and only sanitized copy ever travels back to the
 * client.
 *
 * P4.3 added the export-run pipeline — reserve, finalize (which enqueues the
 * `whatsapp.sync` worker with an ids-only payload), and abort. P4.4 adds the
 * candidate review pair and the status poll: confirm enqueues an ids-only
 * `whatsapp.push` job only when Google Calendar is connected, and the poll
 * fetches the QR through the service-only RPC for nothing but a pending
 * connection resolved by the gated user's own owner-scoped overview. P6.1 adds
 * the live trio — link, scan, disconnect — each refusing unless this server is
 * the self-host worker (`isLiveEnabled()`), and each enqueueing ids only.
 * P7.1 adds the Google Calendar pair — start (a random state in an httpOnly
 * cookie plus the consent URL the client navigates to) and disconnect (the
 * service-only token RPC plus a `disconnected` row).
 */
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getTrustedSiteOrigin } from "@/lib/auth/origin";
import { requireOnboardedUser } from "@/lib/onboarding/gate";
import { createServiceClient } from "@/lib/supabase/service";
import { enqueueJob } from "./jobs";
import {
  WHATSAPP_ACTIVE_RUN_ERROR,
  WHATSAPP_CANDIDATE_NOT_FOUND_ERROR,
  WHATSAPP_GOOGLE_ERROR,
  WHATSAPP_GOOGLE_NOT_CONFIGURED_ERROR,
  WHATSAPP_INVALID_FILE_ERROR,
  WHATSAPP_LIVE_CHAT_ERROR,
  WHATSAPP_LIVE_DISABLED_ERROR,
  WHATSAPP_RATE_LIMIT_ERROR,
  WHATSAPP_RUN_NOT_FOUND_ERROR,
  WHATSAPP_GENERIC_ERROR,
} from "./integrationErrors";
import { parseWhatsAppExport, WHATSAPP_LIVE_CHAT_MAX_LENGTH } from "./integrationValues";
import {
  abortExportRun,
  clearGoogleCredentials,
  confirmCandidate,
  finalizeExportRun,
  getConnectionPoll,
  getGoogleStatus,
  getWhatsAppOverview,
  isGoogleConfigured,
  isLiveEnabled,
  rejectCandidate,
  reserveExportRun,
  startLiveScan,
  GOOGLE_CALENDAR_SCOPE,
  GOOGLE_OAUTH_CALLBACK_PATH,
  GOOGLE_OAUTH_STATE_COOKIE,
} from "./integrations";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const GOOGLE_OAUTH_AUTHORIZE_ENDPOINT =
  "https://accounts.google.com/o/oauth2/v2/auth";

/** The state cookie's lifetime: the whole OAuth round trip, ten minutes. */
const GOOGLE_OAUTH_STATE_MAX_AGE = 600;

function parseId(value: unknown): string | null {
  return typeof value === "string" && UUID_PATTERN.test(value.trim())
    ? value.trim()
    : null;
}

export async function createExportRunAction(payload: unknown) {
  const user = await requireOnboardedUser("/integrations");
  const draft = parseWhatsAppExport(payload);
  if (draft === null) return { error: WHATSAPP_INVALID_FILE_ERROR, upload: null };
  try {
    /* The parsed draft carries the chosen review mode (46.21) and detection
       settings (46.26) through to the service, which records them on the
       connection as the defaults for the next upload. */
    const reserved = await reserveExportRun(user.id, draft);
    if (reserved.status === "active") {
      return { error: WHATSAPP_ACTIVE_RUN_ERROR, upload: null };
    }
    if (reserved.status === "rate") {
      return { error: WHATSAPP_RATE_LIMIT_ERROR, upload: null };
    }
    return {
      error: null,
      upload: { runId: reserved.runId, path: reserved.uploadPath },
    };
  } catch {
    return { error: WHATSAPP_GENERIC_ERROR, upload: null };
  }
}

export async function finalizeExportRunAction(runId: unknown) {
  const user = await requireOnboardedUser("/integrations");
  const id = parseId(runId);
  if (id === null) return { error: WHATSAPP_RUN_NOT_FOUND_ERROR };
  try {
    const result = await finalizeExportRun(user.id, id);
    if (result.status === "not-found") {
      return { error: WHATSAPP_RUN_NOT_FOUND_ERROR };
    }
    if (result.status === "rejected") {
      return { error: WHATSAPP_INVALID_FILE_ERROR };
    }
    await enqueueJob("whatsapp.sync", { runId: id }, { userId: user.id });
    revalidatePath("/integrations");
    return { error: null };
  } catch {
    return { error: WHATSAPP_GENERIC_ERROR };
  }
}

export async function abortExportRunAction(runId: unknown) {
  const user = await requireOnboardedUser("/integrations");
  const id = parseId(runId);
  if (id === null) return { error: WHATSAPP_RUN_NOT_FOUND_ERROR };
  try {
    await abortExportRun(user.id, id);
    return { error: null };
  } catch {
    return { error: WHATSAPP_GENERIC_ERROR };
  }
}

/**
 * P4.4 — confirm a suggestion. The service settles the event and the
 * candidate; when the owner's Google Calendar is connected the follow-up push
 * is enqueued as an ids-only job (the worker reads the candidate itself), so
 * `pushed` mirrors the enqueue, not the eventual push.
 */
export async function confirmCandidateAction(candidateId: unknown) {
  const user = await requireOnboardedUser("/integrations");
  const id = parseId(candidateId);
  if (id === null) {
    return {
      error: WHATSAPP_CANDIDATE_NOT_FOUND_ERROR,
      eventId: null,
      pushed: false,
    };
  }
  try {
    const result = await confirmCandidate(user.id, id);
    if (result.status === "not-found") {
      return {
        error: WHATSAPP_CANDIDATE_NOT_FOUND_ERROR,
        eventId: null,
        pushed: false,
      };
    }
    const google = await getGoogleStatus(user.id);
    let pushed = false;
    if (google.connected) {
      await enqueueJob("whatsapp.push", { candidateId: id }, { userId: user.id });
      pushed = true;
    }
    revalidatePath("/integrations");
    revalidatePath("/calendar");
    return { error: null, eventId: result.eventId, pushed };
  } catch {
    return { error: WHATSAPP_GENERIC_ERROR, eventId: null, pushed: false };
  }
}

/** P4.4 — reject a suggestion; terminal, so an already-settled one is not-found. */
export async function rejectCandidateAction(candidateId: unknown) {
  const user = await requireOnboardedUser("/integrations");
  const id = parseId(candidateId);
  if (id === null) return { error: WHATSAPP_CANDIDATE_NOT_FOUND_ERROR };
  try {
    const ok = await rejectCandidate(user.id, id);
    if (!ok) return { error: WHATSAPP_CANDIDATE_NOT_FOUND_ERROR };
    revalidatePath("/integrations");
    return { error: null };
  } catch {
    return { error: WHATSAPP_GENERIC_ERROR };
  }
}

/**
 * P4.4 — the status poll. The gate runs first; only a pending connection
 * resolved from the caller's own owner-scoped overview is handed to the
 * service-only QR RPC, so the QR can never cross owners. Any RPC failure or
 * non-string result degrades to `qr: null`, never to leaked error text.
 */
export async function getWhatsAppStatusAction() {
  const user = await requireOnboardedUser("/integrations");
  try {
    const overview = await getWhatsAppOverview(user.id);
    let qr: string | null = null;
    if (overview.connection?.statusValue === "pending" && overview.connection.id) {
      const service = createServiceClient();
      const result = await service.rpc("get_whatsapp_qr", {
        p_connection_id: overview.connection.id,
        p_key: process.env.UNIPILOT_INTEGRATIONS_KEY ?? "",
      });
      if (!result.error && typeof result.data === "string") qr = result.data;
    }
    return { error: null, ...overview, qr };
  } catch {
    return {
      error: WHATSAPP_GENERIC_ERROR,
      runs: [],
      candidates: [],
      connection: null,
      qr: null,
    };
  }
}

/**
 * P6.1 — link live WhatsApp. The gate runs first, then the flag: every server
 * that is not the self-host worker refuses with the honest self-host copy. An
 * owner whose row is already `pending`/`connected` is a no-op, so a
 * double-click can never enqueue a second `whatsapp.connect`; otherwise the
 * owner's single `(user_id, provider)` row is upserted `pending` with the
 * profile key and the stale QR cleared, and the ids-only connect job is
 * enqueued. The worker drives the QR through the encrypted RPCs; nothing about
 * the payload crosses this action.
 */
export async function startLiveConnectAction() {
  const user = await requireOnboardedUser("/integrations");
  if (!isLiveEnabled()) return { error: WHATSAPP_LIVE_DISABLED_ERROR };
  try {
    const service = createServiceClient();
    const existing = await service
      .from("integration_connections")
      .select("id, status")
      .eq("user_id", user.id)
      .eq("provider", "whatsapp")
      .maybeSingle();
    if (existing.error) throw new Error("Failed to link WhatsApp.");

    if (
      existing.data &&
      (existing.data.status === "pending" || existing.data.status === "connected")
    ) {
      revalidatePath("/integrations");
      return { error: null };
    }

    const upserted = await service
      .from("integration_connections")
      .upsert(
        {
          user_id: user.id,
          provider: "whatsapp",
          mode: "live",
          status: "pending",
          profile_ref: user.id,
          last_error: null,
          qr_data_enc: null,
          qr_expires_at: null,
        },
        { onConflict: "user_id,provider" },
      )
      .select("id")
      .single();
    if (upserted.error || !upserted.data) {
      throw new Error("Failed to link WhatsApp.");
    }

    await enqueueJob(
      "whatsapp.connect",
      { connectionId: upserted.data.id },
      { userId: user.id },
    );
    revalidatePath("/integrations");
    return { error: null };
  } catch {
    return { error: WHATSAPP_GENERIC_ERROR };
  }
}

/**
 * P6.1 — scan one chat live. The gate runs first, then the flag, then the
 * chat-name boundary (trimmed, 1..100 chars; the service re-checks at the
 * write). The owner must have a `connected` WhatsApp row — the panel only
 * offers the form then, so a miss here is a stale-state race answered with the
 * generic sanitized line. The run is reserved through the shared D13 guard and
 * the ids-only `whatsapp.sync` job is enqueued; the worker picks the chat from
 * the caller's own browser profile.
 */
export async function startLiveScanAction(chatName: unknown) {
  const user = await requireOnboardedUser("/integrations");
  if (!isLiveEnabled()) return { error: WHATSAPP_LIVE_DISABLED_ERROR };

  const name = typeof chatName === "string" ? chatName.trim() : "";
  if (name.length === 0 || name.length > WHATSAPP_LIVE_CHAT_MAX_LENGTH) {
    return { error: WHATSAPP_LIVE_CHAT_ERROR };
  }

  try {
    const connection = await getConnectionPoll(user.id);
    if (connection?.statusValue !== "connected") {
      return { error: WHATSAPP_GENERIC_ERROR };
    }

    const result = await startLiveScan(user.id, name);
    if (result.status === "active") {
      return { error: WHATSAPP_ACTIVE_RUN_ERROR };
    }
    if (result.status === "rate") {
      return { error: WHATSAPP_RATE_LIMIT_ERROR };
    }
    if (result.status === "invalid") {
      return { error: WHATSAPP_LIVE_CHAT_ERROR };
    }

    await enqueueJob("whatsapp.sync", { runId: result.runId }, { userId: user.id });
    revalidatePath("/integrations");
    return { error: null };
  } catch {
    return { error: WHATSAPP_GENERIC_ERROR };
  }
}

/**
 * P6.1 — disconnect live WhatsApp. The gate runs first, then the flag. The
 * service client clears the encrypted QR, marks the owner's row
 * `disconnected` and deletes the owner's raw `integration_messages` (the
 * archive has no client DELETE policy, so the service role is required); the
 * ids-only `whatsapp.disconnect` job then purges the on-disk browser profile.
 * A missing row is still a successful disconnect — there is nothing left to
 * read — and the message delete is the exact owner-scoped query the retention
 * proof exercises.
 */
export async function disconnectWhatsAppAction() {
  const user = await requireOnboardedUser("/integrations");
  if (!isLiveEnabled()) return { error: WHATSAPP_LIVE_DISABLED_ERROR };
  try {
    const service = createServiceClient();
    const connection = await service
      .from("integration_connections")
      .select("id")
      .eq("user_id", user.id)
      .eq("provider", "whatsapp")
      .maybeSingle();
    if (connection.error) throw new Error("Failed to disconnect WhatsApp.");

    if (connection.data) {
      const cleared = await service.rpc("clear_whatsapp_qr", {
        p_connection_id: connection.data.id,
      });
      if (cleared.error) throw new Error("Failed to disconnect WhatsApp.");

      const updated = await service
        .from("integration_connections")
        .update({ status: "disconnected", last_error: null })
        .eq("id", connection.data.id)
        .eq("user_id", user.id);
      if (updated.error) throw new Error("Failed to disconnect WhatsApp.");
    }

    const deleted = await service
      .from("integration_messages")
      .delete()
      .eq("user_id", user.id);
    if (deleted.error) throw new Error("Failed to disconnect WhatsApp.");

    await enqueueJob(
      "whatsapp.disconnect",
      { userId: user.id },
      { userId: user.id },
    );
    revalidatePath("/integrations");
    return { error: null };
  } catch {
    return { error: WHATSAPP_GENERIC_ERROR };
  }
}

/**
 * P7.1 — start the Google Calendar OAuth flow. The gate runs first, then the
 * server's configuration: a server without the OAuth pair returns the honest
 * not-configured copy and no URL. Otherwise a random `state` is kept in an
 * httpOnly, lax, ten-minute cookie bound to the caller's id (so the callback
 * can also refuse a response that belongs to another session), and the
 * returned URL carries the offline/consent pair the refresh token needs. The
 * client performs the navigation (`window.location.assign(url)`); no token
 * ever crosses this action.
 */
export async function connectGoogleCalendarAction() {
  const user = await requireOnboardedUser("/integrations");
  if (!isGoogleConfigured()) {
    return { error: WHATSAPP_GOOGLE_NOT_CONFIGURED_ERROR, url: null };
  }
  try {
    const origin = await getTrustedSiteOrigin();
    const state = crypto.randomUUID();
    const cookieStore = await cookies();
    cookieStore.set(GOOGLE_OAUTH_STATE_COOKIE, `${state}:${user.id}`, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: GOOGLE_OAUTH_STATE_MAX_AGE,
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });

    const url = new URL(GOOGLE_OAUTH_AUTHORIZE_ENDPOINT);
    url.searchParams.set("client_id", process.env.GOOGLE_OAUTH_CLIENT_ID ?? "");
    url.searchParams.set(
      "redirect_uri",
      `${origin}${GOOGLE_OAUTH_CALLBACK_PATH}`,
    );
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", GOOGLE_CALENDAR_SCOPE);
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("state", state);
    return { error: null, url: url.toString() };
  } catch {
    return { error: WHATSAPP_GOOGLE_ERROR, url: null };
  }
}

/**
 * P7.1 — disconnect Google Calendar. The gate runs first; the service-only
 * RPC deletes the stored refresh token and the owner's single google row is
 * upserted `disconnected` with any stale error cleared, so a `connected`
 * status cannot outlive the credentials. A missing row is still a successful
 * disconnect — there is nothing left to read.
 */
export async function disconnectGoogleCalendarAction() {
  const user = await requireOnboardedUser("/integrations");
  try {
    await clearGoogleCredentials(user.id);
    const service = createServiceClient();
    const { error } = await service.from("integration_connections").upsert(
      {
        user_id: user.id,
        provider: "google",
        mode: null,
        status: "disconnected",
        last_error: null,
      },
      { onConflict: "user_id,provider" },
    );
    if (error) throw new Error("Failed to disconnect Google Calendar.");
    revalidatePath("/integrations");
    return { error: null };
  } catch {
    return { error: WHATSAPP_GOOGLE_ERROR };
  }
}
