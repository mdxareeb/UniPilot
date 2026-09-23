/**
 * Task 27.1 — the typed action vocabulary shared by the assistant's structured
 * output (26.9's fenced envelope) and the 27.x executor.
 *
 * The envelope defines *shape*: a fenced `unipilot-action` JSON block with a
 * `type` and a `payload` object, and a confirmation gate that is always on.
 * This module adds *meaning*:
 *
 * - the closed type union `task.create | reminder.create | event.create |
 *   presentation.create` — anything else is rejected, not guessed at;
 * - one validator per payload whose bounds are the very parsers the data
 *   services use (`parseTaskDraft`, `parseEventDraft`,
 *   `parsePresentationRequest`), so a payload accepted here is accepted by the
 *   service it will be handed to and vice versa — there is no second set of
 *   limits to drift;
 * - `summarizeAssistantAction` — the honest one-line copy a confirmation
 *   card/log renders, derived from the same normalized payload the executor
 *   runs;
 * - `normalizeAssistantActionForExecution` — the exact draft each service
 *   accepts (`TaskDraft`, `EventDraftLocal`, `PresentationDraft`), so the
 *   executor hands the service the very values the card summarized.
 *
 * Vocabulary decisions (recorded here per 0.15):
 * - `reminder.create` is its own action type even though it executes as a
 *   task: the user asked for a reminder, the confirmation copy must say so,
 *   and R1 fixes the execution shape — a task whose `due_date` is the remind
 *   day, resolved to 00:00 in the profile's zone by `createTask`'s
 *   `zonedDateOnlyToInstant` path. It is deliberately **day-granular**: that
 *   is what the tasks entity supports, so `remindAt` is a real "YYYY-MM-DD"
 *   and every time-bearing/instant value is rejected (a time-granular
 *   reminder would need a future reminders entity, not a guess here).
 * - `presentation.create` carries only the deck-shaping fields the assistant
 *   can honestly choose (`title`, `prompt`, `slideCount`, `template`,
 *   `sourceDocumentIds`); the executor's format/defaults stay its own concern
 *   and are filled by `normalizeAssistantActionForExecution`.
 * - Dates are real values, never guessed: `task.create.dueDate` and
 *   `reminder.create.remindAt` are real "YYYY-MM-DD" days;
 *   `event.create.startAt`/`endAt` are the form's wall-clock values in the
 *   profile's zone (`EventDraftLocal`, resolved to instants by the events
 *   service). A bare wall-clock is rejected because it would need a zone the
 *   assistant does not have, and an impossible date (e.g. "2026-02-30") is
 *   rejected rather than rolled forward — `Date.parse` alone accepts the
 *   latter, so every date goes through `isRealDateOnly`.
 *
 * Nothing here imports a client, touches the database or executes a tool, and
 * `requiresConfirmation` stays forced to `true` (27.6): an action that skips
 * the user's confirmation cannot be constructed through this module.
 */
import { isRealDateOnly } from "@/lib/data/taskDates";
import {
  parseEventDraft,
  type EventDraftLocal,
} from "@/lib/data/eventValues";
import {
  parsePresentationRequest,
  PRESENTATION_PROMPT_MAX_LENGTH,
  type PresentationDraft,
} from "@/lib/data/presentationValues";
import {
  parseTaskDraft,
  TASK_PRIORITY_LABELS,
  type TaskDraft,
  type TaskPriority,
} from "@/lib/data/taskValues";

// ---------------------------------------------------------------------------
// 1. The structured envelope (26.9) — shape only
// ---------------------------------------------------------------------------

/** The closed vocabulary's lexical rule; 27.1's union is the semantic one. */
const ACTION_TYPE_PATTERN = /^[a-z][a-z0-9_.]{2,63}$/;

export type StructuredAction = {
  type: string;
  payload: Record<string, unknown>;
  /** Always true: the confirmation gate is not optional. */
  requiresConfirmation: true;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseStructuredAction(value: unknown): StructuredAction | null {
  if (!isRecord(value)) return null;
  const type = value.type;
  if (typeof type !== "string" || !ACTION_TYPE_PATTERN.test(type)) return null;
  if (!isRecord(value.payload)) return null;

  return {
    type,
    payload: value.payload,
    requiresConfirmation: true,
  };
}

// ---------------------------------------------------------------------------
// 2. The closed type union (27.1)
// ---------------------------------------------------------------------------

export const ASSISTANT_ACTION_TYPES = [
  "task.create",
  "reminder.create",
  "event.create",
  "presentation.create",
] as const;
export type AssistantActionType = (typeof ASSISTANT_ACTION_TYPES)[number];

/** True when `value` is one of the union's exact entries. */
export function isAssistantActionType(
  value: unknown,
): value is AssistantActionType {
  return (
    typeof value === "string" &&
    (ASSISTANT_ACTION_TYPES as readonly string[]).includes(value)
  );
}

/**
 * The audit table's status vocabulary (27.8's CHECK in
 * `20260923083919_assistant_actions.sql`): proposed → confirmed | rejected,
 * then confirmed → succeeded | failed.
 */
export const ASSISTANT_ACTION_STATUSES = [
  "proposed",
  "confirmed",
  "rejected",
  "succeeded",
  "failed",
] as const;
export type AssistantActionStatus = (typeof ASSISTANT_ACTION_STATUSES)[number];

// ---------------------------------------------------------------------------
// 3. Per-type payloads — normalized, so the summary and the executor read the
//    same values the service will.
// ---------------------------------------------------------------------------

export type TaskCreatePayload = {
  title: string;
  description: string | null;
  /** "YYYY-MM-DD", a real calendar date, or null. */
  dueDate: string | null;
  effortMinutes: number | null;
  priority: TaskPriority | null;
  /** The workspace document the task came from, when the assistant named one. */
  documentId: string | null;
};

/**
 * R1: a reminder executes as a task whose `due_date` is this day, resolved to
 * 00:00 in the profile's zone by the tasks service. Day-granular by ruling:
 * a time-bearing/instant `remindAt` is rejected, never silently truncated.
 */
export type ReminderCreatePayload = {
  title: string;
  /** "YYYY-MM-DD", a real calendar date. */
  remindAt: string;
};

export type EventCreatePayload = {
  title: string;
  /** Wall-clock "YYYY-MM-DDTHH:mm", or a bare date when `allDay`. */
  startAt: string;
  /** Same shape as `startAt`; never before it. */
  endAt: string | null;
  allDay: boolean;
  location: string | null;
  description: string | null;
  documentId: string | null;
};

export type PresentationCreatePayload = {
  title: string;
  /** The generation prompt; null means "use the title". */
  prompt: string | null;
  slideCount: number | null;
  /** Always a non-empty value; the service default is "general". */
  template: string;
  sourceDocumentIds: string[];
};

export type AssistantAction =
  | {
      type: "task.create";
      payload: TaskCreatePayload;
      requiresConfirmation: true;
    }
  | {
      type: "reminder.create";
      payload: ReminderCreatePayload;
      requiresConfirmation: true;
    }
  | {
      type: "event.create";
      payload: EventCreatePayload;
      requiresConfirmation: true;
    }
  | {
      type: "presentation.create";
      payload: PresentationCreatePayload;
      requiresConfirmation: true;
    };

// ---------------------------------------------------------------------------
// 4. Field readers
// ---------------------------------------------------------------------------

type Read<T> = { ok: true; value: T } | { ok: false };

/** Same shape as the data parsers' uuid guard; absent/"" mean "none". */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readUuid(value: unknown): Read<string | null> {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: null };
  }
  if (typeof value !== "string" || !UUID_PATTERN.test(value.trim())) {
    return { ok: false };
  }
  return { ok: true, value: value.trim() };
}

/**
 * A real "YYYY-MM-DD", or null (reject). `isRealDateOnly` is the calendar
 * check, so an impossible day ("2026-02-30") is rejected rather than rolled
 * forward by `Date.parse`'s lenient fallback — and a time-bearing or instant
 * value is not a day at all (R1's day-granular reminder ruling).
 */
function readDateOnly(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  return isRealDateOnly(candidate) ? candidate : null;
}

// ---------------------------------------------------------------------------
// 5. Payload validators — the service parsers do the bounding
// ---------------------------------------------------------------------------

function parseTaskCreatePayload(
  payload: Record<string, unknown>,
): TaskCreatePayload | null {
  const draft = parseTaskDraft({
    title: payload.title,
    description: payload.description,
    dueDate: payload.dueDate,
    effortMinutes: payload.effortMinutes,
    priority: payload.priority,
  });
  if (draft === null) return null;

  const documentId = readUuid(payload.documentId);
  if (!documentId.ok) return null;

  return { ...draft, documentId: documentId.value };
}

function parseReminderCreatePayload(
  payload: Record<string, unknown>,
): ReminderCreatePayload | null {
  // The title bound is the task title's (R1): the reminder becomes a task.
  const task = parseTaskDraft({ title: payload.title });
  if (task === null) return null;

  // R1's day granularity: only a real calendar day. A date-time or instant is
  // rejected outright — truncating it to a day would move the reminder.
  const remindAt = readDateOnly(payload.remindAt);
  if (remindAt === null) return null;

  return { title: task.title, remindAt };
}

function parseEventCreatePayload(
  payload: Record<string, unknown>,
): EventCreatePayload | null {
  const draft = parseEventDraft({
    title: payload.title,
    startAt: payload.startAt,
    endAt: payload.endAt,
    allDay: payload.allDay,
    location: payload.location,
    description: payload.description,
  });
  if (draft === null) return null;

  const documentId = readUuid(payload.documentId);
  if (!documentId.ok) return null;

  return {
    title: draft.title,
    startAt: draft.startAt,
    endAt: draft.endAt,
    allDay: draft.allDay,
    location: draft.location,
    description: draft.description,
    documentId: documentId.value,
  };
}

function parsePresentationCreatePayload(
  payload: Record<string, unknown>,
): PresentationCreatePayload | null {
  const rawTitle = payload.title;
  if (typeof rawTitle !== "string") return null;
  const title = rawTitle.trim();
  if (title === "" || title.length > PRESENTATION_PROMPT_MAX_LENGTH) {
    return null;
  }

  let prompt: string | null = null;
  const rawPrompt = payload.prompt;
  if (rawPrompt !== undefined && rawPrompt !== null && rawPrompt !== "") {
    if (typeof rawPrompt !== "string") return null;
    const trimmed = rawPrompt.trim();
    if (trimmed !== "") prompt = trimmed;
  }

  // The real draft does the bounding (slide count, template, sources, prompt).
  const draft = parsePresentationRequest({
    prompt: prompt ?? title,
    template: payload.template,
    nSlides: payload.slideCount,
    format: "pptx",
    sourceDocumentIds: payload.sourceDocumentIds,
  });
  if (draft === null) return null;

  return {
    title,
    prompt,
    slideCount: draft.nSlides,
    template: draft.template,
    sourceDocumentIds: draft.sourceDocumentIds,
  };
}

/**
 * The full 27.1 parse: envelope + closed type + payload bounds. Null rejects
 * the whole action — there is no partially-valid action, and no way to turn
 * the confirmation gate off.
 */
export function parseAssistantAction(value: unknown): AssistantAction | null {
  const structured = parseStructuredAction(value);
  if (structured === null) return null;

  switch (structured.type) {
    case "task.create": {
      const payload = parseTaskCreatePayload(structured.payload);
      return payload === null
        ? null
        : { type: "task.create", payload, requiresConfirmation: true };
    }
    case "reminder.create": {
      const payload = parseReminderCreatePayload(structured.payload);
      return payload === null
        ? null
        : { type: "reminder.create", payload, requiresConfirmation: true };
    }
    case "event.create": {
      const payload = parseEventCreatePayload(structured.payload);
      return payload === null
        ? null
        : { type: "event.create", payload, requiresConfirmation: true };
    }
    case "presentation.create": {
      const payload = parsePresentationCreatePayload(structured.payload);
      return payload === null
        ? null
        : { type: "presentation.create", payload, requiresConfirmation: true };
    }
    default:
      // 27.1: the vocabulary is closed. Unknown types are rejected, never
      // passed through to a future executor.
      return null;
  }
}

// ---------------------------------------------------------------------------
// 6. Summary — the one honest line the confirmation UI and the log render
// ---------------------------------------------------------------------------

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "2026-09-25" → "Fri, Sep 25" (calendar date; no zone involved). */
function formatDateOnly(dateOnly: string): string {
  const [year, month, day] = dateOnly.split("-").map(Number);
  const weekday = WEEKDAY_LABELS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${weekday}, ${MONTH_LABELS[month - 1]} ${day}`;
}

function formatClock(hour: number, minute: number): string {
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${
    hour < 12 ? "AM" : "PM"
  }`;
}

/**
 * "YYYY-MM-DDTHH:mm" → "2:00 PM". The parts are read directly — running the
 * wall-clock through `Date` would guess a zone it does not have.
 */
function formatLocalClock(local: string): string {
  const [hour, minute] = local.slice(11).split(":").map(Number);
  return formatClock(hour, minute);
}

/** "YYYY-MM-DDTHH:mm" → "Fri, Sep 25, 2:00 PM". */
function formatLocalDateTime(local: string): string {
  return `${formatDateOnly(local.slice(0, 10))}, ${formatLocalClock(local)}`;
}

/**
 * The honest one-line copy for one parsed action, e.g.
 * "Create task: Buy milk — due Fri, Sep 25". It says "Create …", never
 * "Created …": the action is a proposal until the user confirms it (27.6).
 * Derived from the normalized payload, so the card and the executor cannot
 * disagree about what will be created.
 */
export function summarizeAssistantAction(action: AssistantAction): string {
  switch (action.type) {
    case "task.create": {
      const parts = [`Create task: ${action.payload.title}`];
      if (action.payload.dueDate !== null) {
        parts.push(`due ${formatDateOnly(action.payload.dueDate)}`);
      }
      if (action.payload.effortMinutes !== null) {
        parts.push(`${action.payload.effortMinutes} min`);
      }
      if (action.payload.priority !== null) {
        parts.push(`${TASK_PRIORITY_LABELS[action.payload.priority]} priority`);
      }
      if (action.payload.documentId !== null) parts.push("from a document");
      return parts.join(" — ");
    }
    case "reminder.create":
      return `Create reminder: ${action.payload.title} — due ${formatDateOnly(
        action.payload.remindAt,
      )}`;
    case "event.create": {
      const { startAt, endAt, allDay } = action.payload;
      let when: string;
      if (allDay) {
        when =
          endAt === null
            ? `${formatDateOnly(startAt)} (all day)`
            : `${formatDateOnly(startAt)} – ${formatDateOnly(endAt)} (all day)`;
      } else if (endAt === null) {
        when = formatLocalDateTime(startAt);
      } else if (endAt.slice(0, 10) === startAt.slice(0, 10)) {
        // Same day: the date is stated once ("2:00 PM – 3:30 PM").
        when = `${formatLocalDateTime(startAt)} – ${formatLocalClock(endAt)}`;
      } else {
        when = `${formatLocalDateTime(startAt)} – ${formatLocalDateTime(endAt)}`;
      }
      const parts = [`Create event: ${action.payload.title} — ${when}`];
      if (action.payload.location !== null) {
        parts.push(`at ${action.payload.location}`);
      }
      if (action.payload.documentId !== null) parts.push("from a document");
      return parts.join(" — ");
    }
    case "presentation.create": {
      const parts = [`Create presentation: ${action.payload.title}`];
      if (action.payload.slideCount !== null) {
        parts.push(`${action.payload.slideCount} slides`);
      }
      if (action.payload.template !== "general") {
        parts.push(`${action.payload.template} template`);
      }
      const count = action.payload.sourceDocumentIds.length;
      if (count > 0) {
        parts.push(`from ${count} document${count === 1 ? "" : "s"}`);
      }
      return parts.join(" — ");
    }
  }
}

// ---------------------------------------------------------------------------
// 7. Execution drafts — the exact values the services take
// ---------------------------------------------------------------------------

/**
 * One action's execution values, keyed by the same closed union. A reminder's
 * draft is a plain `TaskDraft`: R1's day-granular `due_date = remindAt` is
 * exactly what `createTask` does with a date-only (`zonedDateOnlyToInstant`),
 * so the executor takes the same path as `task.create` — no special write.
 */
export type AssistantActionExecution =
  | { type: "task.create"; draft: TaskDraft; documentId: string | null }
  | { type: "reminder.create"; draft: TaskDraft }
  | { type: "event.create"; draft: EventDraftLocal; documentId: string | null }
  | { type: "presentation.create"; draft: PresentationDraft };

/**
 * The exact draft each service accepts (`createTask`, `createEvent`,
 * `insertPresentation`). The executor must call this instead of reading
 * `action.payload` field by field: one mapping means the confirmation card's
 * summary and the write can never drift apart.
 */
export function normalizeAssistantActionForExecution(
  action: AssistantAction,
): AssistantActionExecution {
  switch (action.type) {
    case "task.create":
      return {
        type: "task.create",
        draft: {
          title: action.payload.title,
          description: action.payload.description,
          dueDate: action.payload.dueDate,
          effortMinutes: action.payload.effortMinutes,
          priority: action.payload.priority,
        },
        documentId: action.payload.documentId,
      };
    case "reminder.create":
      return {
        type: "reminder.create",
        draft: {
          title: action.payload.title,
          description: null,
          // R1 + day granularity: the tasks service resolves this real day to
          // 00:00 in the profile's zone; the reminder can never shift a day.
          dueDate: action.payload.remindAt,
          effortMinutes: null,
          priority: null,
        },
      };
    case "event.create":
      return {
        type: "event.create",
        draft: {
          title: action.payload.title,
          type: null,
          startAt: action.payload.startAt,
          endAt: action.payload.endAt,
          allDay: action.payload.allDay,
          location: action.payload.location,
          description: action.payload.description,
          subjectId: null,
        },
        documentId: action.payload.documentId,
      };
    case "presentation.create":
      return {
        type: "presentation.create",
        draft: {
          prompt: action.payload.prompt ?? action.payload.title,
          template: action.payload.template,
          nSlides: action.payload.slideCount,
          // The action vocabulary carries no format; the executor's default is
          // the tool's default. A caller that collected a format may replace
          // this field before insert.
          format: "pptx",
          language: null,
          instructions: null,
          tone: null,
          verbosity: null,
          includeTableOfContents: false,
          includeTitleSlide: true,
          sourceDocumentIds: [...action.payload.sourceDocumentIds],
        },
      };
  }
}
