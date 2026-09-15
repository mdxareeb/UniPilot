/**
 * The events domain's shared vocabulary, validation and display mapping
 * (Tasks 22.2–22.6), imported by the Server Actions and the tests.
 *
 * Pure by design — no server imports — so the exact functions that guard the
 * write boundary can be exercised directly. The schema is the other half of
 * every rule: the CHECK constraints and the same-user subject trigger in
 * `backend/supabase/migrations/` reject the same junk at the database, and
 * this module rejects it before a query is made.
 *
 * The form and the service speak *local wall-clock* values
 * ("YYYY-MM-DDTHH:mm", or a bare date for all-day events); `resolveEventDraft`
 * turns them into UTC instants in the profile's zone (R15). The database only
 * ever stores instants; every display string is derived in the same zone.
 *
 * Vocabulary decision (recorded in DATABASE.md): `class | exam | deadline`
 * (22.6's migration). NULL means "a plain event with no category" — there is
 * no `other` sentinel. All-day events are single- or multi-day spans whose
 * stored end is the exclusive start of the day after the last day.
 */
import type { Database } from "@/lib/supabase/database.types";
import {
  formatEventTime,
  formatTaskDueDate,
  instantToDateOnly,
  instantToZonedLocalDateTime,
  isRealDateOnly,
  isRealLocalDateTime,
  nextDateOnly,
  zonedDateOnlyToInstant,
  zonedLocalDateTimeToInstant,
} from "./taskDates";

export type EventRow = Pick<
  Database["public"]["Tables"]["events"]["Row"],
  | "id"
  | "title"
  | "type"
  | "description"
  | "location"
  | "start_at"
  | "end_at"
  | "all_day"
  | "subject_id"
> & {
  /** PostgREST embedding of the optional course, RLS-scoped like the rest. */
  subjects?: { name: string } | null;
  /** Provenance (`manual` | `whatsapp`); only WhatsApp renders a marker. */
  source?: string | null;
};

export const EVENT_TYPES = ["class", "exam", "deadline"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  class: "Class",
  exam: "Exam",
  deadline: "Deadline",
};

/** The type control's options; "none" clears the category to NULL. */
export const EVENT_TYPE_OPTIONS: {
  value: "none" | EventType;
  label: string;
}[] = [
  { value: "none", label: "No type" },
  ...(Object.entries(EVENT_TYPE_LABELS) as [EventType, string][]).map(
    ([value, label]) => ({ value, label }),
  ),
];

export const EVENT_TITLE_MAX_LENGTH = 120;
export const EVENT_LOCATION_MAX_LENGTH = 200;
export const EVENT_DESCRIPTION_MAX_LENGTH = 2000;

/** What the form collects, still in the profile's wall-clock values. */
export type EventDraftLocal = {
  title: string;
  type: EventType | null;
  /** "YYYY-MM-DDTHH:mm"; a bare "YYYY-MM-DD" when `allDay` is true. */
  startAt: string;
  endAt: string | null;
  allDay: boolean;
  location: string | null;
  description: string | null;
  subjectId: string | null;
};

/** The validated draft resolved to UTC instants — what the service writes. */
export type EventDraft = Omit<EventDraftLocal, "startAt" | "endAt"> & {
  startAt: string;
  endAt: string | null;
};

/**
 * What the calendar renders: machine values for positioning and the form
 * (`startAt`/`endAt` instants, profile-zone date/time values) plus
 * display-ready strings, mapped by the data layer like the task contract.
 */
export type EventItem = {
  id: string;
  title: string;
  typeValue?: EventType;
  /** Display word ("Class" | "Exam" | "Deadline"). */
  typeLabel?: string;
  /** ISO instant, for the grid's placement maths. */
  startAt: string;
  endAt?: string;
  allDay: boolean;
  /** Profile-zone calendar date of the start, e.g. the grid's column key. */
  startDate: string;
  /**
   * Profile-zone calendar date of the end. Exclusive for all-day events (the
   * stored end is the next day's start), inclusive otherwise; the calendar
   * helpers turn both into the dates the event covers.
   */
  endDateValue?: string;
  /** Profile-zone "HH:mm" values for the grid's vertical offset/height. */
  startTime?: string;
  endTime?: string;
  /** Timed events only: the block's natural height. A point event has none. */
  durationMinutes?: number;
  /** Display-ready date, e.g. "Wed, Sep 2". */
  dateLabel: string;
  /** Display-ready time or range, e.g. "9:00 AM – 10:30 AM". */
  timeLabel?: string;
  /** The course's name when the event references one of the user's subjects. */
  course?: string;
  subjectId?: string;
  location?: string;
  description?: string;
  /** Provenance marker; only WhatsApp-sourced events carry it (P5.3). */
  source?: "whatsapp";
};

type Read<T> = { ok: true; value: T } | { ok: false };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > EVENT_TITLE_MAX_LENGTH) {
    return null;
  }
  return trimmed;
}

/** Type: absent/""/"none" clear it; the closed vocabulary is the only other truth. */
function readType(value: unknown): Read<EventType | null> {
  if (value === undefined || value === null || value === "" || value === "none") {
    return { ok: true, value: null };
  }
  if (
    typeof value === "string" &&
    (EVENT_TYPES as readonly string[]).includes(value)
  ) {
    return { ok: true, value: value as EventType };
  }
  return { ok: false };
}

function readAllDay(value: unknown): Read<boolean> {
  if (value === undefined || value === null || value === false) {
    return { ok: true, value: false };
  }
  if (value === true) return { ok: true, value: true };
  return { ok: false };
}

/**
 * A wall-clock value in the shape its `allDay` mode allows: a real date for
 * an all-day event, a real date-time otherwise. `false` means reject.
 */
function readLocalDateTime(value: unknown, allDay: boolean): string | false {
  if (typeof value !== "string") return false;
  const candidate = value.trim();
  if (allDay) {
    return isRealDateOnly(candidate) ? candidate : false;
  }
  return isRealLocalDateTime(candidate) ? candidate : false;
}

function readText(value: unknown, maxLength: number): Read<string | null> {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: null };
  }
  if (typeof value !== "string") return { ok: false };
  const trimmed = value.trim();
  if (trimmed === "") return { ok: true, value: null };
  if (trimmed.length > maxLength) return { ok: false };
  return { ok: true, value: trimmed };
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readSubjectId(value: unknown): Read<string | null> {
  if (value === undefined || value === null || value === "" || value === "none") {
    return { ok: true, value: null };
  }
  if (typeof value === "string" && UUID_PATTERN.test(value.trim())) {
    return { ok: true, value: value.trim() };
  }
  return { ok: false };
}

/**
 * Validates an untrusted event payload (22.3/22.4) into the local draft.
 * `null` rejects: the action answers with sanitized copy and nothing is
 * written. `endAt` must not precede `startAt` in the same shape family, so the
 * schema's `end_at >= start_at` CHECK can never be the first to complain.
 */
export function parseEventDraft(input: unknown): EventDraftLocal | null {
  if (!isRecord(input)) return null;

  const title = readTitle(input.title);
  if (title === null) return null;

  const type = readType(input.type);
  const allDay = readAllDay(input.allDay);
  if (!type.ok || !allDay.ok) return null;

  const startAt = readLocalDateTime(input.startAt, allDay.value);
  if (startAt === false) return null;

  let endAt: string | null = null;
  if (input.endAt !== undefined && input.endAt !== null && input.endAt !== "") {
    const parsedEnd = readLocalDateTime(input.endAt, allDay.value);
    if (parsedEnd === false || parsedEnd < startAt) return null;
    endAt = parsedEnd;
  }

  const location = readText(input.location, EVENT_LOCATION_MAX_LENGTH);
  const description = readText(input.description, EVENT_DESCRIPTION_MAX_LENGTH);
  const subjectId = readSubjectId(input.subjectId);
  if (!location.ok || !description.ok || !subjectId.ok) return null;

  return {
    title,
    type: type.value,
    startAt,
    endAt,
    allDay: allDay.value,
    location: location.value,
    description: description.value,
    subjectId: subjectId.value,
  };
}

/**
 * Resolves the local draft to UTC instants in the profile's zone. All-day
 * events become a half-open whole-day span: the stored `end_at` is 00:00 of
 * the day after the last day, so "Sep 2" is `[Sep 2 00:00, Sep 3 00:00)` in
 * the student's zone and never drifts a day.
 */
export function resolveEventDraft(
  local: EventDraftLocal,
  timeZone: string,
): EventDraft {
  if (local.allDay) {
    const lastDay = local.endAt ?? local.startAt;
    return {
      title: local.title,
      type: local.type,
      allDay: true,
      location: local.location,
      description: local.description,
      subjectId: local.subjectId,
      startAt: zonedDateOnlyToInstant(local.startAt, timeZone),
      endAt: zonedDateOnlyToInstant(nextDateOnly(lastDay), timeZone),
    };
  }

  return {
    title: local.title,
    type: local.type,
    allDay: false,
    location: local.location,
    description: local.description,
    subjectId: local.subjectId,
    startAt: zonedLocalDateTimeToInstant(local.startAt, timeZone),
    endAt:
      local.endAt === null
        ? null
        : zonedLocalDateTimeToInstant(local.endAt, timeZone),
  };
}

/**
 * Row → calendar contract. Type maps to its display word, dates and times are
 * formatted in the profile's zone, and optional fields are omitted rather
 * than defaulted — a block renders only what the event actually carries.
 */
export function eventRowToItem(row: EventRow, timeZone: string): EventItem {
  const item: EventItem = {
    id: row.id,
    title: row.title,
    startAt: row.start_at,
    allDay: row.all_day,
    startDate: instantToDateOnly(row.start_at, timeZone),
    dateLabel: formatTaskDueDate(row.start_at, timeZone),
  };

  if (row.end_at !== null) {
    item.endAt = row.end_at;
    item.endDateValue = instantToDateOnly(row.end_at, timeZone);
  }

  if (
    row.type !== null &&
    (EVENT_TYPES as readonly string[]).includes(row.type)
  ) {
    item.typeValue = row.type as EventType;
    item.typeLabel = EVENT_TYPE_LABELS[item.typeValue];
  }

  if (!row.all_day) {
    item.startTime = instantToZonedLocalDateTime(row.start_at, timeZone).slice(11);
    if (row.end_at !== null) {
      item.endTime = instantToZonedLocalDateTime(row.end_at, timeZone).slice(11);
      item.timeLabel = `${formatEventTime(row.start_at, timeZone)} – ${formatEventTime(row.end_at, timeZone)}`;
      item.durationMinutes = Math.max(
        1,
        Math.round(
          (Date.parse(row.end_at) - Date.parse(row.start_at)) / 60_000,
        ),
      );
    } else {
      item.timeLabel = formatEventTime(row.start_at, timeZone);
    }
  }

  if (row.subject_id !== null) {
    item.subjectId = row.subject_id;
    const course = row.subjects?.name?.trim();
    if (course) item.course = course;
  }
  if (row.location !== null) item.location = row.location;
  if (row.description !== null) item.description = row.description;
  if (row.source === "whatsapp") item.source = "whatsapp";

  return item;
}

/**
 * Draft → calendar contract without a database round trip: the optimistic
 * twin of `eventRowToItem`, used by 17.x so an inserted block appears at
 * once carrying the same values the settled row will (same zone, same
 * formatting, same optional-field rules — one mapping path, no client-side
 * date system). `course` is passed separately because the optimistic draft
 * has a subject id but no embedded name yet.
 */
export function eventItemFromLocal(
  id: string,
  local: EventDraftLocal,
  timeZone: string,
  course?: string,
): EventItem {
  const draft = resolveEventDraft(local, timeZone);
  const item = eventRowToItem(
    {
      id,
      title: draft.title,
      type: draft.type,
      description: draft.description,
      location: draft.location,
      start_at: draft.startAt,
      end_at: draft.endAt,
      all_day: draft.allDay,
      subject_id: draft.subjectId,
    },
    timeZone,
  );
  if (item.subjectId !== undefined && course) item.course = course;
  return item;
}
