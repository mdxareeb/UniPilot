/**
 * The Google Calendar snapshot's mobile mirror (see
 * `frontend/lib/data/googleCalendar.ts` on the server). Pure parsing and the
 * state-to-controls table, so the shape contract is testable without a device.
 */
import { relativeTime } from "@/features/workspace/registries";
import type { StatusTone } from "@/components/ui/StatusPill";

export type GcalCalendar = {
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
  calendars: GcalCalendar[];
};

export const GCAL_COPY = {
  NOT_CONFIGURED:
    "This build isn't connected to the UniPilot server, so Google Calendar can't load.",
  UNCONFIGURED_SERVER:
    "Google Calendar isn't configured on this server. Ask the operator to set the OAuth pair.",
  CONNECT_ERROR: "Couldn't reach Google Calendar. Check your connection and try again.",
  SYNC_THROTTLED: "A sync just ran. Wait a few seconds and try again.",
  SYNC_NOT_CONNECTED: "Connect Google Calendar first.",
  SYNC_ACCEPTED: "Sync started. New events appear in a moment.",
  DISCONNECT_NOTE:
    "Imported events stay in UniPilot; events already exported to your Google Calendar are left as they are.",
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

const STATUSES = ["connected", "not_connected", "not_configured", "error"] as const;

function parseCalendar(value: unknown): GcalCalendar | null {
  if (!isRecord(value)) return null;
  const id = str(value.id);
  const googleCalendarId = str(value.googleCalendarId);
  if (id === null || googleCalendarId === null) return null;
  return {
    id,
    googleCalendarId,
    summary: str(value.summary) ?? "",
    timezone: str(value.timezone),
    isActive: value.isActive === true,
  };
}

/** The GET body, or null when the server said something unusable. */
export function parseGcalSnapshot(json: unknown): GcalSnapshot | null {
  if (!isRecord(json)) return null;
  const status = json.status;
  if (typeof status !== "string" || !(STATUSES as readonly string[]).includes(status)) {
    return null;
  }
  const calendars = Array.isArray(json.calendars)
    ? json.calendars.map(parseCalendar).filter((c): c is GcalCalendar => c !== null)
    : [];
  return {
    configured: json.configured === true,
    status: status as GcalSnapshot["status"],
    lastError: str(json.lastError),
    autoExport: json.autoExport === true,
    lastSyncedAt: str(json.lastSyncedAt),
    calendars,
  };
}

export type GcalView = {
  badge: string;
  tone: StatusTone;
  title: string;
  body: string;
  showConnect: boolean;
  showDisconnect: boolean;
  showCalendars: boolean;
  showPreferences: boolean;
};

const VIEWS: Record<GcalSnapshot["status"], GcalView> = {
  connected: {
    badge: "Connected",
    tone: "solid",
    title: "Google Calendar is linked",
    body: "Import the calendars you want; deadlines you export stay in sync.",
    showConnect: false,
    showDisconnect: true,
    showCalendars: true,
    showPreferences: true,
  },
  not_connected: {
    badge: "Not linked",
    tone: "outline",
    title: "Link Google Calendar",
    body: "UniPilot reads the calendars you choose and can export your deadlines to a dedicated UniPilot calendar. It never sends messages or reads email.",
    showConnect: true,
    showDisconnect: false,
    showCalendars: false,
    showPreferences: false,
  },
  not_configured: {
    badge: "Not available",
    tone: "planned",
    title: "Google Calendar isn't configured",
    body: "This server has no Google OAuth pair set. Nothing is stored until it does.",
    showConnect: false,
    showDisconnect: false,
    showCalendars: false,
    showPreferences: false,
  },
  error: {
    badge: "Needs reconnect",
    tone: "danger",
    title: "Google needs you to reconnect",
    body: "The stored authorization expired or was revoked. Link again to continue.",
    showConnect: true,
    showDisconnect: true,
    showCalendars: false,
    showPreferences: false,
  },
};

export function gcalView(snapshot: GcalSnapshot): GcalView {
  return { ...VIEWS[snapshot.status] };
}

/** "Just now" / "12m ago" / "Not synced yet" — the workspace's shared rule. */
export function gcalSyncedLabel(
  snapshot: GcalSnapshot,
  now: number = Date.now(),
  timeZone: string = "UTC",
): string {
  return relativeTime(snapshot.lastSyncedAt, now, timeZone);
}

/** Calendars render active first, then A→Z (the group list's rule). */
export function sortCalendars(calendars: GcalCalendar[]): GcalCalendar[] {
  return [...calendars].sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    const byName = (a.summary || a.googleCalendarId).localeCompare(
      b.summary || b.googleCalendarId,
      undefined,
      { sensitivity: "base" },
    );
    return byName !== 0 ? byName : a.googleCalendarId.localeCompare(b.googleCalendarId);
  });
}
