/**
 * The tasks domain's shared vocabulary, validation and display mapping
 * (Tasks 21.2–21.8), imported by the Server Actions and the tests.
 *
 * Pure by design — no server imports — so the exact functions that guard the
 * write boundary can be exercised directly. The schema is the other half of
 * every rule here: the CHECK constraints in `backend/supabase/migrations/`
 * reject the same junk at the database, and this module rejects it before a
 * query is ever made.
 *
 * Vocabulary decisions (recorded in DATABASE.md §State vocabularies):
 * - status is the schema's `todo | in_progress | done`; the 16.5 card's
 *   hyphenated `in-progress` is a *display* value, mapped here so no component
 *   has to translate the model.
 * - priority is `low | medium | high` (Task 21.7's migration); NULL means no
 *   priority, and the UI's "none" option clears to NULL. No fourth level.
 */
import type { Database } from "@/lib/supabase/database.types";
import { formatTaskDueDate, instantToDateOnly, isRealDateOnly } from "./taskDates";

/** The task columns the display contract reads. */
export type TaskRow = Pick<
  Database["public"]["Tables"]["tasks"]["Row"],
  "id" | "title" | "status" | "due_date" | "priority"
>;

/** The database status vocabulary (schema CHECK). */
export const TASK_STATUSES = ["todo", "in_progress", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** The status words the Kanban columns and the 16.5 card use. */
export type TaskUiStatus = "todo" | "in-progress" | "done";
const STATUS_UI: Record<TaskStatus, TaskUiStatus> = {
  todo: "todo",
  in_progress: "in-progress",
  done: "done",
};

/** The database priority vocabulary (21.7 migration CHECK). */
export const TASK_PRIORITIES = ["low", "medium", "high"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** The display word the card prints (16.5: text, not a badge). */
export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

/**
 * The priority control's options, one source for the form's select and for
 * anything else that lists the vocabulary; "none" is the clear action (NULL
 * in the database).
 */
export const TASK_PRIORITY_OPTIONS: {
  value: "none" | TaskPriority;
  label: string;
}[] = [
  { value: "none", label: "No priority" },
  ...(Object.entries(TASK_PRIORITY_LABELS) as [TaskPriority, string][]).map(
    ([value, label]) => ({ value, label }),
  ),
];

/** The column words a status reads as (16.4's three columns). */
export const TASK_STATUS_LABELS: Record<TaskUiStatus, string> = {
  todo: "To do",
  "in-progress": "In progress",
  done: "Done",
};

/** Schema status → the UI's hyphenated word. */
export function toTaskUiStatus(status: TaskStatus): TaskUiStatus {
  return STATUS_UI[status];
}

/** The UI's word → the schema value an action accepts. */
export function toTaskStatus(status: TaskUiStatus): TaskStatus {
  return status === "in-progress" ? "in_progress" : status;
}

/** Bounds. Title matches QuickAddTask's own cap; the others are junk guards. */
export const TASK_TITLE_MAX_LENGTH = 80;
export const TASK_DESCRIPTION_MAX_LENGTH = 2000;
export const TASK_EFFORT_MAX_MINUTES = 10080; // one week; beyond this it is not an estimate

/**
 * What the 16.5 card renders: the board's `TaskItem` shape. `subject` stays
 * optional and unsupplied — there is no subject column on `tasks` (16.6's
 * rule), so the service never invents one.
 */
export type TaskItem = {
  id: string;
  title: string;
  status: TaskUiStatus;
  /** Display-ready due date, e.g. "Wed, Sep 2". Service-formatted. */
  dueDate?: string;
  /**
   * The same due date as the edit form's native date-input value
   * ("YYYY-MM-DD", in the profile's zone). Not rendered by the card; the
   * service maps it so the form never has to parse the display string.
   */
  dueDateValue?: string;
  /** Display-ready priority word ("Low" | "Medium" | "High"). */
  priority?: string;
  /** The machine priority value ("low" | "medium" | "high") for the form. */
  priorityValue?: TaskPriority;
  /** Display-ready subject/course. Always absent until a subject link exists. */
  subject?: string;
};

export type TaskDraft = {
  title: string;
  description: string | null;
  dueDate: string | null;
  effortMinutes: number | null;
  priority: TaskPriority | null;
  /**
   * 27.5 (R2) — the workspace document this task came from, when the
   * assistant named one. Optional: the form path never sends it, so the parser
   * omits the key (rather than inventing `null`) when it is absent and every
   * existing draft keeps its exact shape. Only `createTask` writes it; an
   * update never rewrites provenance.
   */
  sourceDocumentId?: string | null;
};

/** Update patch: an absent field is left unchanged; null (or "") clears it. */
export type TaskPatch = {
  title?: string;
  description?: string | null;
  dueDate?: string | null;
  effortMinutes?: number | null;
  priority?: TaskPriority | null;
};

type Read<T> = { ok: true; value: T } | { ok: false };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > TASK_TITLE_MAX_LENGTH) {
    return null;
  }
  return trimmed;
}

function readDescription(value: unknown): Read<string | null> {
  if (value === null || value === undefined || value === "") {
    return { ok: true, value: null };
  }
  if (typeof value !== "string") return { ok: false };
  const trimmed = value.trim();
  if (trimmed === "") return { ok: true, value: null };
  if (trimmed.length > TASK_DESCRIPTION_MAX_LENGTH) return { ok: false };
  return { ok: true, value: trimmed };
}

/** A real "YYYY-MM-DD"; null/"" clear (patch) or omit (draft). */
function readDueDate(value: unknown): Read<string | null> {
  if (value === null || value === undefined || value === "") {
    return { ok: true, value: null };
  }
  if (typeof value !== "string") return { ok: false };

  const candidate = value.trim();
  if (!isRealDateOnly(candidate)) return { ok: false };

  return { ok: true, value: candidate };
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 27.5 (R2) — the optional provenance document id. Absent/""/null mean "no
 * link" and are returned as null so the caller can omit the key from a draft;
 * anything that is not a uuid is rejected before a write.
 */
function readSourceDocumentId(value: unknown): Read<string | null> {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: null };
  }
  if (typeof value === "string" && UUID_PATTERN.test(value.trim())) {
    return { ok: true, value: value.trim() };
  }
  return { ok: false };
}

/** Priority on a create draft: absent/""/"none" mean no priority. */
function readPriority(value: unknown): Read<TaskPriority | null> {
  if (
    value === undefined ||
    value === null ||
    value === "" ||
    value === "none"
  ) {
    return { ok: true, value: null };
  }
  const parsed = parseTaskPriority(value);
  if (parsed === undefined) return { ok: false };
  return { ok: true, value: parsed };
}

function readEffort(value: unknown): Read<number | null> {
  if (value === null || value === undefined || value === "") {
    return { ok: true, value: null };
  }
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value.trim())
        ? Number(value.trim())
        : Number.NaN;

  if (
    !Number.isInteger(numeric) ||
    numeric <= 0 ||
    numeric > TASK_EFFORT_MAX_MINUTES
  ) {
    return { ok: false };
  }
  return { ok: true, value: numeric };
}

/**
 * Validates and normalizes a create payload (21.3). `null` means reject: the
 * action answers with sanitized copy and nothing reaches the database.
 */
export function parseTaskDraft(input: unknown): TaskDraft | null {
  if (!isRecord(input)) return null;

  const title = readTitle(input.title);
  if (title === null) return null;

  const description = readDescription(input.description);
  const dueDate = readDueDate(input.dueDate);
  const effort = readEffort(input.effortMinutes);
  const priority = readPriority(input.priority);
  const sourceDocumentId = readSourceDocumentId(input.sourceDocumentId);
  if (
    !description.ok ||
    !dueDate.ok ||
    !effort.ok ||
    !priority.ok ||
    !sourceDocumentId.ok
  ) {
    return null;
  }

  const draft: TaskDraft = {
    title,
    description: description.value,
    dueDate: dueDate.value,
    effortMinutes: effort.value,
    priority: priority.value,
  };
  // R2: the key exists only when a document was actually named, so a draft
  // without provenance compares equal to the shape it had before 27.5.
  if (sourceDocumentId.value !== null) {
    draft.sourceDocumentId = sourceDocumentId.value;
  }
  return draft;
}

/**
 * Validates and normalizes an update payload (21.4). `null` means reject —
 * including an empty patch, which would be a write that changes nothing.
 * Fields that are absent in the record stay absent here so the service leaves
 * the stored value untouched; `null` (or "") explicitly clears one.
 */
export function parseTaskPatch(input: unknown): TaskPatch | null {
  if (!isRecord(input)) return null;

  const patch: TaskPatch = {};
  let hasField = false;

  if ("title" in input) {
    const title = readTitle(input.title);
    if (title === null) return null;
    patch.title = title;
    hasField = true;
  }
  if ("description" in input) {
    const description = readDescription(input.description);
    if (!description.ok) return null;
    patch.description = description.value;
    hasField = true;
  }
  if ("dueDate" in input) {
    const dueDate = readDueDate(input.dueDate);
    if (!dueDate.ok) return null;
    patch.dueDate = dueDate.value;
    hasField = true;
  }
  if ("effortMinutes" in input) {
    const effort = readEffort(input.effortMinutes);
    if (!effort.ok) return null;
    patch.effortMinutes = effort.value;
    hasField = true;
  }
  if ("priority" in input) {
    const priority = readPriority(input.priority);
    if (!priority.ok) return null;
    patch.priority = priority.value;
    hasField = true;
  }

  return hasField ? patch : null;
}

/** 21.6 — a status the schema knows, or null (reject). */
export function parseTaskStatus(value: unknown): TaskStatus | null {
  return typeof value === "string" &&
    (TASK_STATUSES as readonly string[]).includes(value)
    ? (value as TaskStatus)
    : null;
}

/**
 * 21.7 — a priority the schema knows; `null` means "clear to no priority"
 * (the UI's "none"); `undefined` means reject.
 */
export function parseTaskPriority(
  value: unknown,
): TaskPriority | null | undefined {
  if (value === "none") return null;
  return typeof value === "string" &&
    (TASK_PRIORITIES as readonly string[]).includes(value)
    ? (value as TaskPriority)
    : undefined;
}

/** A UUID the service may query by; anything else is rejected before a read. */
export function parseTaskId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  return UUID_PATTERN.test(id) ? id : null;
}

/**
 * Row → card contract (21.2 + 21.8). Status is translated to the UI's
 * hyphenated word, the due date is formatted in the profile's zone, and the
 * priority becomes its display word. Optional fields are omitted, never
 * defaulted — the card's rule is "render only when supplied".
 */
export function taskRowToItem(row: TaskRow, timeZone: string): TaskItem {
  const status: TaskStatus = (TASK_STATUSES as readonly string[]).includes(
    row.status,
  )
    ? (row.status as TaskStatus)
    : "todo"; // unreachable through the schema CHECK; the safe default is not a guess

  const item: TaskItem = {
    id: row.id,
    title: row.title,
    status: STATUS_UI[status],
  };

  if (row.due_date !== null) {
    item.dueDate = formatTaskDueDate(row.due_date, timeZone);
    item.dueDateValue = instantToDateOnly(row.due_date, timeZone);
  }
  if (
    row.priority !== null &&
    (TASK_PRIORITIES as readonly string[]).includes(row.priority)
  ) {
    item.priorityValue = row.priority as TaskPriority;
    item.priority = TASK_PRIORITY_LABELS[item.priorityValue];
  }

  return item;
}
