/**
 * The shape of `GET /api/integrations/whatsapp-groups` (see
 * `frontend/lib/data/groupSyncValues.ts` → `GroupSyncSnapshot`). The mobile app
 * never receives the QR (`qr` is always null for a Bearer caller).
 */
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

export type MonitoredGroupItem = {
  id: string;
  name: string;
  active: boolean;
  activatedAt: string | null;
  lastSyncedAt: string | null;
};

export type GroupCandidateItem = {
  id: string;
  title: string;
  kind: "task" | "event";
  typeLabel: string;
  whenLabel: string | null;
  allDay: boolean;
  sender: string;
  messageText: string;
  confidencePercent: number | null;
  subjectName: string | null;
  proposedSubjectName: string | null;
  groupName: string | null;
};

export type GroupSyncSnapshot = {
  state: GroupSyncState;
  lastError: string | null;
  pairing: { code: string; expiresAt: string } | null;
  groups: MonitoredGroupItem[];
  review: GroupCandidateItem[];
};

export const EMPTY_SNAPSHOT: GroupSyncSnapshot = {
  state: "disconnected",
  lastError: null,
  pairing: null,
  groups: [],
  review: [],
};
