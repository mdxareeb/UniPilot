import type { GroupSyncState } from "@/features/whatsappGroups/types";
import type { StatusTone } from "@/components/ui/StatusPill";

/** Registry icons are keys; the screen maps them to components. */
export type RegistryIcon =
  | "materials"
  | "focus"
  | "whatsapp"
  | "desk"
  | "google"
  | "microsoft"
  | "moodle";

export type ToolDefinition = {
  id: string;
  name: string;
  description: string;
  icon: RegistryIcon;
  /** Present only for live tools. */
  route?: "/materials";
  status: "live" | "planned";
  /** Which live count the card should show, if any. */
  badge?: "materials";
};

/**
 * One line per tool. Adding a live tool is a route + an entry here; the More
 * grid reads this array, so the layout never changes.
 */
export const TOOLS_REGISTRY: readonly ToolDefinition[] = [
  {
    id: "materials",
    name: "Course Materials",
    description: "Files, summaries and topics from your groups.",
    icon: "materials",
    route: "/materials",
    status: "live",
    badge: "materials",
  },
  {
    id: "focus",
    name: "Focus Workspace",
    description: "Pomodoro and the ESP32 desk companion.",
    icon: "focus",
    status: "planned",
  },
] as const;

export type IntegrationCategory = "messaging" | "hardware" | "calendar" | "lms";

export type WhatsAppStatus = {
  configured: boolean;
  state: GroupSyncState | "unknown";
  pending: number;
  lastSyncedAt: string | null;
  /** When the status was read; used for a stable relative label. */
  checkedAt?: number;
};

export type IntegrationStatusContext = {
  whatsapp: WhatsAppStatus | null;
};

export type IntegrationStatus = {
  label: string;
  tone: StatusTone;
};

export type IntegrationDefinition = {
  id: string;
  name: string;
  category: IntegrationCategory;
  description: string;
  icon: RegistryIcon;
  statusResolver: (context: IntegrationStatusContext) => IntegrationStatus;
  route?: "/whatsapp-groups";
  /** Relative timestamp shown on the row, when the integration can provide one. */
  lastSyncedAt?: (context: IntegrationStatusContext) => string | null;
};

const PLANNED: IntegrationStatus = { label: "Planned", tone: "planned" };

function whatsappStatus(context: IntegrationStatusContext): IntegrationStatus {
  const whatsapp = context.whatsapp;
  if (!whatsapp || !whatsapp.configured) {
    return { label: "Not connected", tone: "outline" };
  }
  if (whatsapp.pending > 0) {
    return { label: `${whatsapp.pending} Pending`, tone: "warning" };
  }
  switch (whatsapp.state) {
    case "connected":
      return { label: "Connected", tone: "solid" };
    case "code_ready":
    case "starting":
    case "qr_ready":
      return { label: "Linking", tone: "warning" };
    case "bridge_offline":
      return { label: "Service off", tone: "outline" };
    case "error":
      return { label: "Needs attention", tone: "danger" };
    default:
      return { label: "Disconnected", tone: "outline" };
  }
}

/**
 * One line per integration. The More hub renders whatever is here; a new
 * provider needs a resolver (or `PLANNED`) and, when live, a route.
 */
export const INTEGRATIONS_REGISTRY: readonly IntegrationDefinition[] = [
  {
    id: "whatsapp",
    name: "WhatsApp Groups",
    category: "messaging",
    description: "Deadlines, exams and files from your college groups.",
    icon: "whatsapp",
    statusResolver: whatsappStatus,
    route: "/whatsapp-groups",
    lastSyncedAt: (context) => context.whatsapp?.lastSyncedAt ?? null,
  },
  {
    id: "desk-companion",
    name: "Desk Companion",
    category: "hardware",
    description: "ESP32 focus timer and ambient desk display.",
    icon: "desk",
    statusResolver: () => PLANNED,
  },
  {
    id: "google-calendar",
    name: "Google Calendar",
    category: "calendar",
    description: "Two-way calendar import and event push.",
    icon: "google",
    statusResolver: () => PLANNED,
  },
  {
    id: "microsoft",
    name: "Outlook · Teams",
    category: "calendar",
    description: "Microsoft calendar and Teams meeting import.",
    icon: "microsoft",
    statusResolver: () => PLANNED,
  },
  {
    id: "moodle",
    name: "Moodle · NPTEL",
    category: "lms",
    description: "Course updates and assignment feeds.",
    icon: "moodle",
    statusResolver: () => PLANNED,
  },
] as const;

/** "Just now", "12m ago", "3h ago", "Yesterday", or a short date. */
export function relativeTime(
  iso: string | null,
  now: number = Date.now(),
  timeZone: string = "UTC",
): string {
  if (iso === null) return "Not synced yet";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "Not synced yet";
  const diff = Math.max(0, now - then);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
  }).format(new Date(then));
}
