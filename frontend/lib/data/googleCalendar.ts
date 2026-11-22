/**
 * Google Calendar sync (channel iii for the mobile app, service-side for the
 * worker). Everything the Bearer routes need:
 *
 *  - `mintGoogleOAuthState` / `consumeGoogleOAuthState`: the cookie-free OAuth
 *    state. A random 32-byte token goes to Google; only its SHA-256 is stored
 *    (service-only `google_oauth_states`, single use, 10-minute TTL).
 *  - `getGoogleCalendarSnapshot`: the screen's whole read - configured flag,
 *    connection status, calendars, the export opt-in and freshness.
 *  - `setGoogleCalendarActive`: the owner's import toggle, scoped by id+user.
 *  - `requestGcalSync`: the ≥5-minute throttle, then the idempotent
 *    `enqueue_gcal_sync` RPC.
 *  - `disconnectGoogleCalendar`: best-effort revoke at Google, then the
 *    service-only credential RPC, the calendars/cursors wipe and a
 *    `disconnected` row. Imported events and exported Google events stay.
 *
 * No OAuth code or token is ever logged or echoed; failures use fixed copy.
 */
import { type SupabaseClient } from "@supabase/supabase-js";
import { getTrustedSiteOrigin } from "@/lib/auth/origin";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import type { Database } from "@/lib/supabase/database.types";
import {
  GOOGLE_CALENDAR_SCOPE,
  GOOGLE_OAUTH_CALLBACK_PATH,
  clearGoogleCredentials,
  isGoogleConfigured,
} from "./integrations";

const GOOGLE_OAUTH_AUTHORIZE_ENDPOINT =
  "https://accounts.google.com/o/oauth2/v2/auth";

/** The state row's lifetime: the whole OAuth round trip. */
export const GOOGLE_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
/** The Sync Now guard: at least this long between enqueued runs. */
export const GCAL_SYNC_MIN_INTERVAL_MS = 5 * 60 * 1000;

export const GCAL_ERRORS = {
  NOT_CONFIGURED: "Google Calendar isn't configured on this server.",
  NOT_CONNECTED: "Connect Google Calendar first.",
  THROTTLED: "A sync just ran. Wait a few seconds and try again.",
  GENERIC: "Google Calendar couldn't be reached. Please try again.",
} as const;

export const GCAL_DISCONNECT_NOTE =
  "Imported events and deadlines stay in UniPilot; events already exported to your Google Calendar are left as they are.";

export type GcalCalendarItem = {
  id: string;
  googleCalendarId: string;
  summary: string;
  timezone: string | null;
  isActive: boolean;
};

export type GcalSnapshot = {
  configured: boolean;
  status: "connected" | "not_connected" | "not_configured" | "error";
  lastError: string | null;
  autoExport: boolean;
  lastSyncedAt: string | null;
  calendars: GcalCalendarItem[];
};

async function sha256Hex(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Mint the mobile link's OAuth state. Returns the raw token (it travels to
 * Google and back, never to storage) plus the consent URL built with the
 * offline/consent pair the refresh token needs. The web's cookie flow is
 * untouched.
 */
export async function mintGoogleOAuthState(
  userId: string,
): Promise<{ state: string; authorizationUrl: string } | null> {
  if (!isGoogleConfigured()) return null;

  const state = crypto.randomUUID() + crypto.randomUUID();
  const service = createServiceClient();
  // Best-effort hygiene: an abandoned connect leaves its expired row behind.
  try {
    await service
      .from("google_oauth_states")
      .delete()
      .lt("expires_at", new Date().toISOString());
  } catch {
    /* the new state is still usable */
  }
  const { error } = await service.from("google_oauth_states").insert({
    state_hash: await sha256Hex(state),
    user_id: userId,
    provider: "google",
    return_scheme: "unipilot",
    expires_at: new Date(Date.now() + GOOGLE_OAUTH_STATE_TTL_MS).toISOString(),
  });
  if (error) throw new Error("Failed to start the Google link.");

  const origin = await getTrustedSiteOrigin();
  const url = new URL(GOOGLE_OAUTH_AUTHORIZE_ENDPOINT);
  url.searchParams.set("client_id", process.env.GOOGLE_OAUTH_CLIENT_ID ?? "");
  url.searchParams.set("redirect_uri", `${origin}${GOOGLE_OAUTH_CALLBACK_PATH}`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_CALENDAR_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return { state, authorizationUrl: url.toString() };
}

/**
 * Single-use consume: the callback hashes the incoming `state` and this
 * atomically claims an unconsumed, unexpired row. A replayed code has no
 * row left to match. Returns the row's user id, or null.
 */
export async function consumeGoogleOAuthState(
  state: string,
): Promise<string | null> {
  const service = createServiceClient();
  const { data, error } = await service
    .from("google_oauth_states")
    .update({ consumed_at: new Date().toISOString() })
    .eq("state_hash", await sha256Hex(state))
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("user_id")
    .maybeSingle();
  if (error || !data) return null;
  return data.user_id;
}

/** The screen's whole read, through the caller's own client (RLS applies). */
export async function getGoogleCalendarSnapshot(
  userId: string,
  options: { client?: SupabaseClient<Database> } = {},
): Promise<GcalSnapshot> {
  const supabase = options.client ?? (await createClient());
  const configured = isGoogleConfigured();

  const [connection, calendars] = await Promise.all([
    supabase
      .from("integration_connections")
      .select("status, last_error, auto_export_to_gcal, last_synced_at")
      .eq("user_id", userId)
      .eq("provider", "google")
      .maybeSingle(),
    supabase
      .from("google_calendars")
      .select("id, google_calendar_id, summary, timezone, is_active")
      .eq("user_id", userId)
      .order("is_active", { ascending: false })
      .order("summary", { ascending: true }),
  ]);
  if (connection.error) throw new Error("Failed to load Google Calendar status.");
  if (calendars.error) throw new Error("Failed to load your Google calendars.");

  const status = !configured
    ? "not_configured"
    : connection.data?.status === "connected"
      ? "connected"
      : connection.data?.status === "error"
        ? "error"
        : "not_connected";

  return {
    configured,
    status,
    lastError: status === "error" ? connection.data?.last_error ?? null : null,
    autoExport: connection.data?.auto_export_to_gcal === true,
    lastSyncedAt: connection.data?.last_synced_at ?? null,
    calendars: (calendars.data ?? []).map((row) => ({
      id: row.id,
      googleCalendarId: row.google_calendar_id,
      summary: row.summary,
      timezone: row.timezone,
      isActive: row.is_active,
    })),
  };
}

/** The owner's import toggle, scoped by id+user (the column grant pattern). */
export async function setGoogleCalendarActive(
  userId: string,
  calendarId: string,
  active: boolean,
): Promise<boolean> {
  const service = createServiceClient();
  const { data, error } = await service
    .from("google_calendars")
    .update({ is_active: active, activated_at: active ? new Date().toISOString() : null })
    .eq("id", calendarId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();
  if (error) throw new Error("Failed to update that calendar.");
  return data !== null;
}

/** The export opt-in. Never exports rows that came FROM Google. */
export async function setGcalAutoExport(
  userId: string,
  enabled: boolean,
): Promise<void> {
  const service = createServiceClient();
  const { error } = await service
    .from("integration_connections")
    .update({ auto_export_to_gcal: enabled })
    .eq("user_id", userId)
    .eq("provider", "google");
  if (error) throw new Error("Failed to save that preference.");
}

export type GcalSyncRequest =
  | { status: "accepted" }
  | { status: "throttled" }
  | { status: "not_connected" };

/** The Sync Now guard: ≥5 minutes between runs, then the idempotent RPC. */
export async function requestGcalSync(userId: string): Promise<GcalSyncRequest> {
  const service = createServiceClient();
  const { data, error } = await service
    .from("integration_connections")
    .select("status, last_synced_at")
    .eq("user_id", userId)
    .eq("provider", "google")
    .maybeSingle();
  if (error || data?.status !== "connected") return { status: "not_connected" };

  const last = data.last_synced_at ? Date.parse(data.last_synced_at) : NaN;
  if (!Number.isNaN(last) && Date.now() - last < GCAL_SYNC_MIN_INTERVAL_MS) {
    return { status: "throttled" };
  }

  const enqueued = await service.rpc("enqueue_gcal_sync", { p_user_id: userId });
  if (enqueued.error) throw new Error("Failed to start the sync.");
  return enqueued.data === true
    ? { status: "accepted" }
    : { status: "throttled" };
}

/**
 * Disconnect: revoke the stored refresh token at Google (best-effort - a
 * network failure must not strand the encrypted row), forget the encrypted
 * credentials, wipe the calendars/cursors, and settle the row. Imported
 * events keep their rows; exported Google events are left in place.
 */
export async function disconnectGoogleCalendar(
  userId: string,
): Promise<{ notice: string }> {
  const service = createServiceClient();
  const key = process.env.UNIPILOT_INTEGRATIONS_KEY ?? "";
  const { data: creds, error: credsError } = await service.rpc(
    "get_google_credentials",
    { p_user_id: userId, p_key: key },
  );
  if (!credsError && creds && creds.length > 0) {
    try {
      await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: creds[0].refresh_token }),
      });
    } catch {
      /* the row is cleared below regardless */
    }
  }

  await clearGoogleCredentials(userId);
  await service.from("google_calendars").delete().eq("user_id", userId);
  const { error } = await service
    .from("integration_connections")
    .upsert(
      {
        user_id: userId,
        provider: "google",
        mode: null,
        status: "disconnected",
        last_error: null,
        auto_export_to_gcal: false,
        export_calendar_id: null,
        last_synced_at: null,
      },
      { onConflict: "user_id,provider" },
    );
  if (error) throw new Error("Failed to disconnect Google Calendar.");
  return { notice: GCAL_DISCONNECT_NOTE };
}
