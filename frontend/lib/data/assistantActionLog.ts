/**
 * Task 27.x — the assistant action log and the confirmation-gated executor
 * (27.2–27.5, 27.8, 27.9, 27.13).
 *
 * The flow this module owns, end to end:
 *
 *   register (from the turn pipeline or a Server Action)
 *     → one `assistant_actions` row per parsed fenced action, `proposed`,
 *       keyed by a deterministic hash so identical content can never be
 *       registered twice (27.9);
 *   list (owner-scoped)
 *     → the display contract the 27.x confirmation UI renders;
 *   confirm (a real user decision, never a silent write, 27.6)
 *     → the row settles `succeeded` with the created row's kind/id/label or
 *       `failed` with sanitized copy; a settled row returns its stored result
 *       and is never re-executed (27.13);
 *   reject
 *     → `proposed` → `rejected`, idempotent, and nothing is ever written to
 *       tasks/events by a reject.
 *
 * Authority model (the messages/metrics posture):
 * - the `assistant_actions` migration revoked every client write, so all log
 *   writes go through the service client — after this module has verified the
 *   conversation/message belongs to the caller (the service role bypasses RLS,
 *   and `user_id` is denormalized, so that check is this module's job);
 * - the log's owner-scoped reads and the tasks/events/documents writes the
 *   executor performs run through the **caller's session client**, so RLS
 *   remains the authority for everything except the log rows themselves.
 *   `AssistantActionServiceOptions.client` exists for the one call site that
 *   is not a Next request — the live QA spec, which passes the same kind of
 *   signed-in session client every other request path gets from cookies.
 *
 * No client ever calls the executor: a row can only be created by the server
 * (registration) and can only execute through a confirm/reject decision.
 */
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { collectStructuredActions } from "@/lib/ai/toolContracts";
import {
  ASSISTANT_ACTION_STATUSES,
  normalizeAssistantActionForExecution,
  parseAssistantAction,
  summarizeAssistantAction,
  type AssistantAction,
  type AssistantActionStatus,
  type AssistantActionType,
} from "@/lib/ai/actionSchema";
import type { Database, Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getDocument } from "./documents";
import { createEvent } from "./events";
import { readProfileTimeZone } from "./profileTime";
import { formatTaskDueDate } from "./taskDates";
import { createTask } from "./tasks";

// ---------------------------------------------------------------------------
// Copy — the only strings that ever travel back to a caller
// ---------------------------------------------------------------------------

export const ASSISTANT_ACTION_COPY = {
  NOT_FOUND: "That action no longer exists.",
  INVALID: "That action couldn't be read, so nothing was created.",
  REJECTED: "This action was rejected, so nothing was created.",
  ALREADY_COMPLETED: "This action has already been completed.",
  UNAVAILABLE: "This action couldn't be completed right now.",
  DOCUMENT_NOT_FOUND:
    "That document isn't in your workspace, so nothing was created.",
  PRESENTATION_NOT_AVAILABLE:
    "Creating presentations from the assistant isn't available yet, so nothing was created.",
  FAILED: "That action couldn't be completed. Nothing was created.",
} as const;

// ---------------------------------------------------------------------------
// The display contract
// ---------------------------------------------------------------------------

/** What a succeeded action created — the settled facts stored in `result`. */
export const ASSISTANT_ACTION_OUTCOME_KINDS = [
  "task",
  "event",
  "presentation",
] as const;
export type AssistantActionOutcomeKind =
  (typeof ASSISTANT_ACTION_OUTCOME_KINDS)[number];

export type AssistantActionOutcome = {
  kind: AssistantActionOutcomeKind;
  /** The created row's id. */
  id: string;
  /** The created row's title — the honest name for the confirmation surface. */
  label: string;
};

type AssistantActionItemBase = {
  id: string;
  status: AssistantActionStatus;
  /** The settled outcome, or null while proposed/confirmed/failed. */
  result: AssistantActionOutcome | null;
  /** Sanitized failure copy, or null. */
  error: string | null;
  messageId: string | null;
  /** The honest one-line copy (`summarizeAssistantAction`) derived from `payload`. */
  summary: string;
  /** Profile-zone display strings, like every other service contract. */
  createdLabel: string;
  settledLabel: string | null;
};

/**
 * The log's display contract: the parsed, normalized payload is carried
 * alongside the settled state so the confirmation UI never re-parses raw
 * jsonb and the executor's values and the card's cannot drift.
 */
export type AssistantActionItem = {
  [K in AssistantActionType]: AssistantActionItemBase & {
    type: K;
    payload: Extract<AssistantAction, { type: K }>["payload"];
  };
}[AssistantActionType];

export type AssistantActionMutationResult = {
  error: string | null;
  /** The settled/current row's contract; null only when no owned row exists. */
  action: AssistantActionItem | null;
};

export type RegisterAssistantProposalsInput = {
  conversationId: string;
  /** The assistant message that proposed the actions; null for live content. */
  messageId?: string | null;
  content: string;
};

export type RegisterAssistantProposalsResult =
  | { status: "ok"; items: AssistantActionItem[] }
  | { status: "not-found" };

/**
 * The caller-scoped client to run with. Omitted by the turn pipeline and the
 * Server Actions, which are Next request contexts and get the cookie client;
 * the live QA spec passes its signed-in session client instead.
 */
export type AssistantActionServiceOptions = {
  client?: SupabaseClient<Database>;
};

export type AssistantActionExecutionContext = {
  conversationId: string;
  messageId?: string | null;
  idempotencyKey: string;
  client?: SupabaseClient<Database>;
};

export type AssistantActionExecutionResult =
  | { ok: true; result: AssistantActionOutcome }
  | { ok: false; error: string };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ASSISTANT_ACTION_COLUMNS =
  "id, conversation_id, message_id, type, payload, status, result, error, idempotency_key, proposed_at, settled_at";

type AssistantActionLogRow = Pick<
  Database["public"]["Tables"]["assistant_actions"]["Row"],
  | "id"
  | "conversation_id"
  | "message_id"
  | "type"
  | "payload"
  | "status"
  | "result"
  | "error"
  | "idempotency_key"
  | "proposed_at"
  | "settled_at"
>;

// ---------------------------------------------------------------------------
// 27.9 — the deterministic idempotency key
// ---------------------------------------------------------------------------

/**
 * One canonical JSON string for any JSON value: object keys sorted, absent
 * `undefined` values dropped. The key hashes this form, so two payloads that
 * differ only in key order are the same proposal.
 */
function stableJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`);
  return `{${entries.join(",")}}`;
}

export type AssistantActionKeyInput = {
  userId: string;
  conversationId: string;
  /** null means "live" content, not tied to a persisted message. */
  messageId?: string | null;
  /** The action's position among the parsed actions of its content. */
  index: number;
  type: AssistantActionType;
  /** The normalized payload (`parseAssistantAction` output). */
  payload: unknown;
};

/**
 * 27.9/27.13 — the deterministic key: a SHA-256 over the owner, the
 * conversation, the proposing message (or "live"), the action's index, its
 * type and the stable JSON of its normalized payload. The unique
 * `(user_id, idempotency_key)` constraint turns re-registering identical
 * content into a no-op instead of a duplicate.
 */
export function assistantActionIdempotencyKey(
  input: AssistantActionKeyInput,
): string {
  const fingerprint = stableJson({
    v: 1,
    user: input.userId,
    conversation: input.conversationId,
    source: input.messageId ?? "live",
    index: input.index,
    type: input.type,
    payload: input.payload,
  });
  return createHash("sha256").update(fingerprint).digest("hex");
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

function parseAssistantActionStatus(
  value: unknown,
): AssistantActionStatus | null {
  return typeof value === "string" &&
    (ASSISTANT_ACTION_STATUSES as readonly string[]).includes(value)
    ? (value as AssistantActionStatus)
    : null;
}

function parseAssistantActionOutcome(
  value: unknown,
): AssistantActionOutcome | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (!(ASSISTANT_ACTION_OUTCOME_KINDS as readonly unknown[]).includes(record.kind)) {
    return null;
  }
  if (typeof record.id !== "string" || record.id === "") return null;
  if (typeof record.label !== "string" || record.label === "") return null;
  return {
    kind: record.kind as AssistantActionOutcomeKind,
    id: record.id,
    label: record.label,
  };
}

/**
 * Row → display contract. A row whose stored payload or status cannot be read
 * is dropped rather than guessed at; the log's only writer is this module (the
 * vocabulary is also a database CHECK), so that branch is unreachable through
 * the app — it exists so a hand-edited row can never be executed by accident.
 */
function rowToItem(
  row: AssistantActionLogRow,
  timeZone: string,
): AssistantActionItem | null {
  const action = parseAssistantAction({ type: row.type, payload: row.payload });
  if (action === null) return null;
  const status = parseAssistantActionStatus(row.status);
  if (status === null) return null;

  const base: AssistantActionItemBase = {
    id: row.id,
    status,
    result: parseAssistantActionOutcome(row.result),
    error: row.error,
    messageId: row.message_id,
    summary: summarizeAssistantAction(action),
    createdLabel: formatTaskDueDate(row.proposed_at, timeZone),
    settledLabel:
      row.settled_at === null
        ? null
        : formatTaskDueDate(row.settled_at, timeZone),
  };

  switch (action.type) {
    case "task.create":
      return { ...base, type: action.type, payload: action.payload };
    case "reminder.create":
      return { ...base, type: action.type, payload: action.payload };
    case "event.create":
      return { ...base, type: action.type, payload: action.payload };
    case "presentation.create":
      return { ...base, type: action.type, payload: action.payload };
  }
}

/** One owned log row by id (RLS plus the explicit owner filter). */
async function loadOwnedAction(
  supabase: SupabaseClient<Database>,
  userId: string,
  actionId: string,
): Promise<AssistantActionLogRow | null> {
  const { data, error } = await supabase
    .from("assistant_actions")
    .select(ASSISTANT_ACTION_COLUMNS)
    .eq("id", actionId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error("Failed to load assistant action.");
  return data;
}

/** The settlement authority: the unique row a key identifies. */
async function loadActionByKey(
  supabase: SupabaseClient<Database>,
  userId: string,
  idempotencyKey: string,
): Promise<AssistantActionLogRow | null> {
  const { data, error } = await supabase
    .from("assistant_actions")
    .select(ASSISTANT_ACTION_COLUMNS)
    .eq("user_id", userId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (error) throw new Error("Failed to load assistant action.");
  return data;
}

// ---------------------------------------------------------------------------
// Registration (27.8/27.9)
// ---------------------------------------------------------------------------

/**
 * Parse the fenced actions in one assistant message and register them as
 * `proposed` log rows, idempotently.
 *
 * Ownership is verified before any write: the service role bypasses RLS and
 * `user_id` is denormalized, so a foreign conversation or a message that does
 * not belong to the conversation would otherwise let a caller plant a row in
 * someone else's log. A foreign/missing id answers `not-found` and writes
 * nothing.
 *
 * Returns the proposals for exactly this content, in content order, whether
 * they were inserted now or already existed (27.9). A message with no valid
 * action fences is the common case and touches the database not at all.
 */
export async function registerAssistantProposals(
  userId: string,
  input: RegisterAssistantProposalsInput,
): Promise<RegisterAssistantProposalsResult> {
  const conversationId =
    typeof input.conversationId === "string" ? input.conversationId.trim() : "";
  if (!UUID_PATTERN.test(conversationId)) return { status: "not-found" };

  const rawMessageId =
    typeof input.messageId === "string" ? input.messageId.trim() : "";
  const messageId = rawMessageId === "" ? null : rawMessageId;
  if (messageId !== null && !UUID_PATTERN.test(messageId)) {
    return { status: "not-found" };
  }

  const content = typeof input.content === "string" ? input.content : "";
  const proposals: { action: AssistantAction; key: string }[] = [];
  collectStructuredActions(content).forEach((structured, index) => {
    const action = parseAssistantAction(structured);
    if (action === null) return;
    proposals.push({
      action,
      key: assistantActionIdempotencyKey({
        userId,
        conversationId,
        messageId,
        index,
        type: action.type,
        payload: action.payload,
      }),
    });
  });
  if (proposals.length === 0) return { status: "ok", items: [] };

  const service = createServiceClient();

  const owner = await service
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (owner.error || !owner.data) return { status: "not-found" };

  if (messageId !== null) {
    const message = await service
      .from("messages")
      .select("id, conversation_id")
      .eq("id", messageId)
      .maybeSingle();
    if (
      message.error ||
      !message.data ||
      message.data.conversation_id !== conversationId
    ) {
      return { status: "not-found" };
    }
  }

  const { error: insertError } = await service
    .from("assistant_actions")
    .upsert(
      proposals.map(({ action, key }) => ({
        user_id: userId,
        conversation_id: conversationId,
        message_id: messageId,
        type: action.type,
        payload: action.payload as Json,
        status: "proposed",
        idempotency_key: key,
      })),
      { onConflict: "user_id,idempotency_key", ignoreDuplicates: true },
    );
  if (insertError) throw new Error("Failed to register assistant actions.");

  // Read back this content's proposals — an already-registered key returns the
  // original row (same id, same proposed_at), so re-registration is stable.
  const { data, error } = await service
    .from("assistant_actions")
    .select(ASSISTANT_ACTION_COLUMNS)
    .eq("user_id", userId)
    .in(
      "idempotency_key",
      proposals.map((proposal) => proposal.key),
    );
  if (error) throw new Error("Failed to load assistant actions.");

  const timeZone = await readProfileTimeZone(service, userId);
  const rowsByKey = new Map(
    (data ?? []).map((row) => [row.idempotency_key, row]),
  );

  const items: AssistantActionItem[] = [];
  for (const proposal of proposals) {
    const row = rowsByKey.get(proposal.key);
    if (row === undefined) continue;
    const item = rowToItem(row, timeZone);
    if (item !== null) items.push(item);
  }
  return { status: "ok", items };
}

// ---------------------------------------------------------------------------
// Owner-scoped reads
// ---------------------------------------------------------------------------

/**
 * The caller's action log for one conversation, oldest first. Runs through the
 * caller's session client by default, so the owner-SELECT RLS policy is the
 * authority.
 */
export async function listAssistantActions(
  userId: string,
  conversationId: string,
  options: AssistantActionServiceOptions = {},
): Promise<AssistantActionItem[]> {
  if (!UUID_PATTERN.test(conversationId)) return [];

  const supabase = options.client ?? (await createClient());
  const [timeZone, result] = await Promise.all([
    readProfileTimeZone(supabase, userId),
    supabase
      .from("assistant_actions")
      .select(ASSISTANT_ACTION_COLUMNS)
      .eq("user_id", userId)
      .eq("conversation_id", conversationId)
      .order("proposed_at", { ascending: true })
      .order("id", { ascending: true }),
  ]);

  if (result.error) throw new Error("Failed to load assistant actions.");
  return (result.data ?? [])
    .map((row) => rowToItem(row, timeZone))
    .filter((item): item is AssistantActionItem => item !== null);
}

// ---------------------------------------------------------------------------
// Confirmation (27.6/27.13)
// ---------------------------------------------------------------------------

/**
 * 27.13 — confirming a settled proposal returns its stored state and never
 * re-executes: `succeeded` answers the stored result, `failed` the stored
 * sanitized copy, and a `rejected` row stays rejected (it is never run).
 * `proposed`/`confirmed` rows go through the executor, whose own log-row
 * guard is what makes the settle-once promise hold under a retry.
 */
export async function confirmAssistantAction(
  userId: string,
  actionId: string,
  options: AssistantActionServiceOptions = {},
): Promise<AssistantActionMutationResult> {
  if (!UUID_PATTERN.test(actionId)) {
    return { error: ASSISTANT_ACTION_COPY.NOT_FOUND, action: null };
  }

  const supabase = options.client ?? (await createClient());
  const row = await loadOwnedAction(supabase, userId, actionId);
  if (row === null) {
    return { error: ASSISTANT_ACTION_COPY.NOT_FOUND, action: null };
  }

  const timeZone = await readProfileTimeZone(supabase, userId);
  const item = rowToItem(row, timeZone);
  if (item === null) {
    return { error: ASSISTANT_ACTION_COPY.INVALID, action: null };
  }

  switch (item.status) {
    case "succeeded":
      // 27.13: the stored result is the answer; nothing runs again.
      return { error: null, action: item };
    case "failed":
      return { error: item.error ?? ASSISTANT_ACTION_COPY.FAILED, action: item };
    case "rejected":
      return { error: ASSISTANT_ACTION_COPY.REJECTED, action: item };
    default: {
      // proposed | confirmed — the executor's guarded claim decides whether
      // this call is the one that executes.
      const action = parseAssistantAction({
        type: row.type,
        payload: row.payload,
      });
      if (action === null) {
        return { error: ASSISTANT_ACTION_COPY.INVALID, action: item };
      }

      const outcome = await executeAssistantAction(userId, action, {
        conversationId: row.conversation_id,
        messageId: row.message_id,
        idempotencyKey: row.idempotency_key,
        client: options.client,
      });

      const settled = await loadOwnedAction(supabase, userId, actionId);
      const settledItem =
        settled === null ? item : rowToItem(settled, timeZone) ?? item;
      return {
        error: outcome.ok ? null : outcome.error,
        action: settledItem,
      };
    }
  }
}

/**
 * `proposed` → `rejected`, idempotently, and nothing is ever persisted to
 * tasks/events by a reject (the executor is not called). Re-rejecting a
 * rejected row answers the same item with no error; a row that already
 * succeeded/failed cannot be rejected after the fact.
 */
export async function rejectAssistantAction(
  userId: string,
  actionId: string,
  options: AssistantActionServiceOptions = {},
): Promise<AssistantActionMutationResult> {
  if (!UUID_PATTERN.test(actionId)) {
    return { error: ASSISTANT_ACTION_COPY.NOT_FOUND, action: null };
  }

  const supabase = options.client ?? (await createClient());
  const row = await loadOwnedAction(supabase, userId, actionId);
  if (row === null) {
    return { error: ASSISTANT_ACTION_COPY.NOT_FOUND, action: null };
  }

  const timeZone = await readProfileTimeZone(supabase, userId);
  let item = rowToItem(row, timeZone);
  if (item === null) {
    return { error: ASSISTANT_ACTION_COPY.INVALID, action: null };
  }

  if (item.status === "proposed") {
    const service = createServiceClient();
    const { data, error } = await service
      .from("assistant_actions")
      .update({ status: "rejected", settled_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("user_id", userId)
      .eq("status", "proposed")
      .select(ASSISTANT_ACTION_COLUMNS);

    if (error) throw new Error("Failed to reject assistant action.");
    // A zero-row update means another call settled it first; read the truth
    // rather than claiming this call's transition.
    const settled =
      (data ?? []).length > 0
        ? data![0]
        : await loadOwnedAction(supabase, userId, actionId);
    item = settled === null ? item : rowToItem(settled, timeZone) ?? item;
  }

  if (item.status === "rejected") return { error: null, action: item };
  return { error: ASSISTANT_ACTION_COPY.ALREADY_COMPLETED, action: item };
}

// ---------------------------------------------------------------------------
// The executor (27.2–27.5)
// ---------------------------------------------------------------------------

/**
 * 27.2–27.5 — run one already-validated action against the owner-scoped
 * services and settle its log row.
 *
 * Settle-once (27.13) is driven by the log row: the caller hands the key that
 * identifies the confirmed proposal, the executor claims it (`proposed` →
 * `confirmed`, a guarded update only one caller can win) and settles it. A
 * retry sees the terminal row and returns the stored result/error without
 * executing again — so a task/event can never be created twice by a repeat
 * call, even with the same key. A key with no owned row refuses: the executor
 * is only reachable through a confirmed proposal, never a silent write.
 *
 * The action passed in must be the stored proposal's exact payload (compared
 * canonically); anything else answers `not-found` rather than executing a
 * different action under someone else's key.
 */
export async function executeAssistantAction(
  userId: string,
  action: AssistantAction,
  context: AssistantActionExecutionContext,
): Promise<AssistantActionExecutionResult> {
  const conversationId =
    typeof context?.conversationId === "string" ? context.conversationId.trim() : "";
  const idempotencyKey =
    typeof context?.idempotencyKey === "string" ? context.idempotencyKey.trim() : "";
  if (conversationId === "" || idempotencyKey === "") {
    return { ok: false, error: ASSISTANT_ACTION_COPY.NOT_FOUND };
  }

  const service = createServiceClient();
  const row = await loadActionByKey(service, userId, idempotencyKey);
  // The key must identify this conversation's proposal. The proposing message
  // is compared only when both sides name one: deleting a message detaches it
  // (SET NULL) while the key — and therefore the proposal's identity — stays
  // valid.
  if (row === null || row.conversation_id !== conversationId) {
    return { ok: false, error: ASSISTANT_ACTION_COPY.NOT_FOUND };
  }
  // Two non-null message ids that disagree are different proposals under one
  // key; refuse rather than execute the wrong one.
  const contextMessageId =
    typeof context.messageId === "string" && context.messageId.trim() !== ""
      ? context.messageId.trim()
      : null;
  if (
    contextMessageId !== null &&
    row.message_id !== null &&
    contextMessageId !== row.message_id
  ) {
    return { ok: false, error: ASSISTANT_ACTION_COPY.NOT_FOUND };
  }

  switch (row.status) {
    case "succeeded": {
      const stored = parseAssistantActionOutcome(row.result);
      return stored === null
        ? { ok: false, error: ASSISTANT_ACTION_COPY.FAILED }
        : { ok: true, result: stored };
    }
    case "failed":
      return { ok: false, error: row.error ?? ASSISTANT_ACTION_COPY.FAILED };
    case "rejected":
      return { ok: false, error: ASSISTANT_ACTION_COPY.REJECTED };
    case "confirmed":
      // Claimed by an earlier confirmation that never settled. A retry must
      // not execute twice (27.13); it is reported honestly instead.
      return { ok: false, error: ASSISTANT_ACTION_COPY.UNAVAILABLE };
    case "proposed":
      break;
    default:
      return { ok: false, error: ASSISTANT_ACTION_COPY.UNAVAILABLE };
  }

  // The stored payload is the action of record: it is what the confirmation
  // card rendered. A caller handing a different action under this key is
  // refused before anything executes.
  const stored = parseAssistantAction({ type: row.type, payload: row.payload });
  if (
    stored === null ||
    stored.type !== action.type ||
    stableJson(stored.payload) !== stableJson(action.payload)
  ) {
    return { ok: false, error: ASSISTANT_ACTION_COPY.NOT_FOUND };
  }

  // Claim: only one caller can move proposed → confirmed. The winner executes.
  const claimed = await service
    .from("assistant_actions")
    .update({ status: "confirmed" })
    .eq("id", row.id)
    .eq("user_id", userId)
    .eq("status", "proposed")
    .select("id");
  if (claimed.error) {
    return { ok: false, error: ASSISTANT_ACTION_COPY.UNAVAILABLE };
  }
  if ((claimed.data ?? []).length === 0) {
    const after = await loadActionByKey(service, userId, idempotencyKey);
    if (after?.status === "succeeded") {
      const settledResult = parseAssistantActionOutcome(after.result);
      return settledResult === null
        ? { ok: false, error: ASSISTANT_ACTION_COPY.FAILED }
        : { ok: true, result: settledResult };
    }
    if (after?.status === "failed") {
      return { ok: false, error: after.error ?? ASSISTANT_ACTION_COPY.FAILED };
    }
    return { ok: false, error: ASSISTANT_ACTION_COPY.UNAVAILABLE };
  }

  let outcome: AssistantActionExecutionResult;
  try {
    outcome = await runAssistantAction(userId, action, context.client);
  } catch {
    outcome = { ok: false, error: ASSISTANT_ACTION_COPY.FAILED };
  }

  // Settle the claimed row. A failed settle write must not turn a created
  // task/event into a reported failure — the write happened, so the outcome is
  // returned as-is; the row stays `confirmed` (never `proposed`), so a retry
  // still cannot execute a second time.
  const settledAt = new Date().toISOString();
  const { data: settled, error: settleError } = await service
    .from("assistant_actions")
    .update(
      outcome.ok
        ? {
            status: "succeeded",
            result: outcome.result as Json,
            error: null,
            settled_at: settledAt,
          }
        : {
            status: "failed",
            result: null,
            error: outcome.error,
            settled_at: settledAt,
          },
    )
    .eq("id", row.id)
    .eq("user_id", userId)
    .eq("status", "confirmed")
    .select("id");
  if (settleError || (settled ?? []).length === 0) {
    console.error("assistant action settle write failed");
  }

  return outcome;
}

/**
 * The action → service mapping (27.2–27.5). Every branch runs against the
 * caller-scoped client, so RLS authorizes the write exactly as it would on the
 * manual path:
 * - `task.create` → `createTask`, with the action's `description` as the
 *   related-notes text and `documentId` (owner-verified) as `sourceDocumentId`
 *   (R2);
 * - `reminder.create` → `createTask` with the date-only `dueDate` (R1); the
 *   tasks service resolves it to 00:00 in the profile's zone;
 * - `event.create` → `createEvent`, with the same owner-verified document link;
 * - `presentation.create` → an honest "not available yet" failure (T27-D wires
 *   the real path); nothing is enqueued and no row is created.
 */
async function runAssistantAction(
  userId: string,
  action: AssistantAction,
  client: SupabaseClient<Database> | undefined,
): Promise<AssistantActionExecutionResult> {
  const execution = normalizeAssistantActionForExecution(action);

  switch (execution.type) {
    case "presentation.create":
      return { ok: false, error: ASSISTANT_ACTION_COPY.PRESENTATION_NOT_AVAILABLE };

    case "task.create": {
      const documentId = await verifiedDocumentId(
        userId,
        execution.documentId,
        client,
      );
      if (documentId === false) {
        return { ok: false, error: ASSISTANT_ACTION_COPY.DOCUMENT_NOT_FOUND };
      }
      const task = await createTask(
        userId,
        { ...execution.draft, sourceDocumentId: documentId },
        { client },
      );
      return {
        ok: true,
        result: { kind: "task", id: task.id, label: task.title },
      };
    }

    case "reminder.create": {
      // R1: day-granular, no document link — the tasks service resolves the
      // date-only to 00:00 in the profile's zone.
      const task = await createTask(userId, execution.draft, { client });
      return {
        ok: true,
        result: { kind: "task", id: task.id, label: task.title },
      };
    }

    case "event.create": {
      const documentId = await verifiedDocumentId(
        userId,
        execution.documentId,
        client,
      );
      if (documentId === false) {
        return { ok: false, error: ASSISTANT_ACTION_COPY.DOCUMENT_NOT_FOUND };
      }
      const event = await createEvent(
        userId,
        { ...execution.draft, sourceDocumentId: documentId },
        { client },
      );
      return {
        ok: true,
        result: { kind: "event", id: event.id, label: event.title },
      };
    }
  }
}

/**
 * `null` when the action named no document; the verified id when it is the
 * caller's own; `false` when it is foreign or missing — the executor then
 * fails honestly without writing anything.
 */
async function verifiedDocumentId(
  userId: string,
  documentId: string | null,
  client: SupabaseClient<Database> | undefined,
): Promise<string | null | false> {
  if (documentId === null) return null;
  const document = await getDocument(userId, documentId, { client });
  return document === null ? false : document.id;
}
