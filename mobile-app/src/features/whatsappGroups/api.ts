import {
  GROUP_SYNC_STATES,
  type GroupCandidateItem,
  type GroupSyncSnapshot,
  type GroupSyncState,
  type MonitoredGroupItem,
} from "./types";

/**
 * The Bearer client for the web app's WhatsApp group-sync routes
 * (`frontend/app/api/integrations/whatsapp-groups/**`, plan §B.1 channel iii).
 * The Supabase session's access token is the credential; it travels only in the
 * `Authorization` header and is never logged or stored here.
 *
 * Everything the server needs to say to a person arrives as plain copy in the
 * `error` field, so this layer shows that copy and falls back to its own only
 * when the server said nothing useful. Nothing in an error ever includes the
 * phone number.
 */
export type ApiErrorKind =
  | "unconfigured"
  | "unauthorized"
  | "onboarding"
  | "invalid_phone"
  | "already_linked"
  | "throttled"
  | "not_found"
  | "too_large"
  | "server"
  | "network";

export class WhatsAppApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly field: string | null;

  constructor(kind: ApiErrorKind, message: string, field: string | null = null) {
    super(message);
    this.name = "WhatsAppApiError";
    this.kind = kind;
    this.field = field;
  }
}

export const API_COPY = {
  UNCONFIGURED:
    "This build isn't connected to the UniPilot server, so WhatsApp groups can't load.",
  UNAUTHORIZED: "Sign in again to continue.",
  ONBOARDING: "Finish setting up your account first.",
  NETWORK: "Couldn't reach UniPilot. Check your connection and try again.",
  SERVER: "Something went wrong on our side. Try again in a moment.",
  NOT_FOUND: "That item is no longer available.",
  TOO_LARGE: "That request is too large.",
  THROTTLED: "A link request is already in progress. Wait a few seconds.",
  ALREADY_LINKED: "WhatsApp is already linked. Disconnect first.",
  BAD_PHONE: "That phone number can't be used.",
  BAD_RESPONSE: "UniPilot sent something unexpected. Try again.",
} as const;

export type ApiDeps = {
  /** `EXPO_PUBLIC_API_BASE_URL`, e.g. `https://app.unipilot.com` (no trailing slash needed). */
  baseUrl: string;
  /** The current Supabase access token, or null when signed out. */
  getToken: () => Promise<string | null>;
  fetch?: typeof fetch;
};

export type DisconnectResult = { notice: string | null };

export type WhatsAppApi = {
  getSnapshot: () => Promise<GroupSyncSnapshot>;
  link: (digits: string) => Promise<void>;
  disconnect: () => Promise<DisconnectResult>;
  decide: (id: string, decision: "confirm" | "reject") => Promise<void>;
};

const ROOT = "/api/integrations/whatsapp-groups";

export function createWhatsAppApi(deps: ApiDeps): WhatsAppApi {
  const base = deps.baseUrl.trim().replace(/\/+$/, "");
  const doFetch = deps.fetch ?? fetch;

  async function call(
    path: string,
    init: { method: "GET" | "POST"; body?: unknown },
  ): Promise<{ status: number; json: unknown }> {
    if (base === "") {
      throw new WhatsAppApiError("unconfigured", API_COPY.UNCONFIGURED);
    }
    const token = await deps.getToken();
    if (token === null || token === "") {
      throw new WhatsAppApiError("unauthorized", API_COPY.UNAUTHORIZED);
    }
    let response: Response;
    try {
      response = await doFetch(`${base}${ROOT}${path}`, {
        method: init.method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(init.body === undefined ? null : { "Content-Type": "application/json" }),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
    } catch {
      throw new WhatsAppApiError("network", API_COPY.NETWORK);
    }
    let json: unknown = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    if (!response.ok) throw mapFailure(response.status, json);
    return { status: response.status, json };
  }

  return {
    async getSnapshot() {
      const { json } = await call("", { method: "GET" });
      const snapshot = parseSnapshot(json);
      if (snapshot === null) {
        throw new WhatsAppApiError("server", API_COPY.BAD_RESPONSE);
      }
      return snapshot;
    },
    async link(digits) {
      await call("/link", { method: "POST", body: { phone: digits } });
    },
    async disconnect() {
      const { json } = await call("/disconnect", { method: "POST" });
      const notice = isRecord(json) && typeof json.notice === "string" ? json.notice : null;
      return { notice };
    },
    async decide(id, decision) {
      await call(`/candidates/${encodeURIComponent(id)}/${decision}`, {
        method: "POST",
      });
    },
  };
}

function serverMessage(json: unknown): string | null {
  if (!isRecord(json) || typeof json.error !== "string") return null;
  const text = json.error.trim();
  return text === "" ? null : text;
}

/** Status + body → one typed error carrying copy that is safe to show. */
export function mapFailure(status: number, json: unknown): WhatsAppApiError {
  const message = serverMessage(json);
  const field = isRecord(json) && typeof json.field === "string" ? json.field : null;
  switch (status) {
    case 400:
      return new WhatsAppApiError(
        field === "phone" ? "invalid_phone" : "server",
        message ?? API_COPY.BAD_PHONE,
        field,
      );
    case 401:
      return new WhatsAppApiError("unauthorized", API_COPY.UNAUTHORIZED);
    case 403:
      return new WhatsAppApiError("onboarding", message ?? API_COPY.ONBOARDING);
    case 404:
      return new WhatsAppApiError("not_found", message ?? API_COPY.NOT_FOUND);
    case 409:
      return new WhatsAppApiError("already_linked", message ?? API_COPY.ALREADY_LINKED);
    case 413:
      return new WhatsAppApiError("too_large", message ?? API_COPY.TOO_LARGE);
    case 429:
      return new WhatsAppApiError("throttled", message ?? API_COPY.THROTTLED);
    default:
      return new WhatsAppApiError("server", API_COPY.SERVER);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseGroup(value: unknown): MonitoredGroupItem | null {
  if (!isRecord(value)) return null;
  const id = str(value.id);
  const name = str(value.name);
  if (id === null || name === null || typeof value.active !== "boolean") return null;
  return {
    id,
    name,
    active: value.active,
    activatedAt: str(value.activatedAt),
    lastSyncedAt: str(value.lastSyncedAt),
  };
}

function parseCandidate(value: unknown): GroupCandidateItem | null {
  if (!isRecord(value)) return null;
  const id = str(value.id);
  const title = str(value.title);
  if (id === null || title === null) return null;
  return {
    id,
    title,
    kind: value.kind === "task" ? "task" : "event",
    typeLabel: str(value.typeLabel) ?? "Item",
    whenLabel: str(value.whenLabel),
    allDay: value.allDay === true,
    sender: str(value.sender) ?? "",
    messageText: str(value.messageText) ?? "",
    confidencePercent:
      typeof value.confidencePercent === "number" ? value.confidencePercent : null,
    subjectName: str(value.subjectName),
    proposedSubjectName: str(value.proposedSubjectName),
    groupName: str(value.groupName),
  };
}

/** Validate the GET body; anything malformed is rejected, never half-rendered. */
export function parseSnapshot(json: unknown): GroupSyncSnapshot | null {
  if (!isRecord(json)) return null;
  const state = json.state;
  if (
    typeof state !== "string" ||
    !(GROUP_SYNC_STATES as readonly string[]).includes(state)
  ) {
    return null;
  }
  const pairing =
    isRecord(json.pairing) &&
    typeof json.pairing.code === "string" &&
    typeof json.pairing.expiresAt === "string"
      ? { code: json.pairing.code, expiresAt: json.pairing.expiresAt }
      : null;
  const groups = Array.isArray(json.groups)
    ? json.groups.map(parseGroup).filter((g): g is MonitoredGroupItem => g !== null)
    : [];
  const review = Array.isArray(json.review)
    ? json.review.map(parseCandidate).filter((c): c is GroupCandidateItem => c !== null)
    : [];
  // `enabled: false` means the server's flag is off: nothing else is shown.
  const resolved: GroupSyncState = json.enabled === false ? "not_enabled" : (state as GroupSyncState);
  return {
    state: resolved,
    lastError: str(json.lastError),
    pairing: resolved === "code_ready" ? pairing : null,
    groups,
    review,
  };
}
