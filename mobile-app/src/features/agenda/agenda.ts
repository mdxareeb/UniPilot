/**
 * Read-only Tasks and Calendar for the mobile app: the row → display mapping.
 * Mirrors the web's rules (dates are formatted in the profile's timezone, never
 * as a raw timestamp) and carries the "From WhatsApp" provenance marker. Pure,
 * so it is testable without a device.
 */
/** A subject joined onto a row; `color_tag` is an optional UI slug, not a hue. */
export type AgendaSubject = {
  name: string;
  color_tag?: string | null;
};

export type TaskRowInput = {
  id: string;
  title: string;
  status: string;
  due_date: string | null;
  priority: string | null;
  task_type: string | null;
  source: string;
  /** The captured WhatsApp message this row came from; null for manual rows. */
  source_message_id: string | null;
  subject: AgendaSubject | null;
};

export type TaskListItem = {
  id: string;
  title: string;
  done: boolean;
  statusLabel: string;
  /** "Wed, Sep 2", or null when the task has no due date. */
  dueLabel: string | null;
  subjectName: string | null;
  /** The subject's optional tag slug; null renders the name alone. */
  subjectColorTag: string | null;
  sourceMessageId: string | null;
  fromWhatsApp: boolean;
  typeLabel: string | null;
};

export type EventRowInput = {
  id: string;
  title: string;
  start_at: string;
  end_at: string | null;
  all_day: boolean;
  type: string | null;
  location: string | null;
  source: string;
  /** The captured WhatsApp message this row came from; null for manual rows. */
  source_message_id: string | null;
  subject: AgendaSubject | null;
};

export type EventListItem = {
  id: string;
  title: string;
  /** "Mon, Nov 16": the heading its day group sits under. */
  dayLabel: string;
  /** Sort key: the calendar day in the profile zone, `YYYY-MM-DD`. */
  dayKey: string;
  /** "9:00 AM" or "All day". */
  timeLabel: string;
  typeLabel: string | null;
  location: string | null;
  subjectName: string | null;
  /** The subject's optional tag slug; null renders the name alone. */
  subjectColorTag: string | null;
  sourceMessageId: string | null;
  fromWhatsApp: boolean;
};

export type EventDayGroup = {
  dayKey: string;
  dayLabel: string;
  events: EventListItem[];
};

const STATUS_LABELS: Record<string, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
};

const TASK_TYPE_LABELS: Record<string, string> = {
  assignment: "Assignment",
  quiz: "Quiz",
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  exam: "Exam",
  class: "Class",
  deadline: "Deadline",
};

/** Where an item came from; shown only for WhatsApp group sync. */
export const WHATSAPP_MARK = "From WhatsApp";

/** A usable IANA zone, or UTC when the stored one is missing or invalid. */
export function safeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}

export function formatDay(instantIso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: safeZone(timeZone),
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(instantIso));
}

export function formatTime(instantIso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: safeZone(timeZone),
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(new Date(instantIso))
    .replace(/\u202f/g, " ");
}

/** `YYYY-MM-DD` for the day an instant falls on in the zone. */
export function dayKeyOf(instantIso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: safeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(instantIso));
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

export function toTaskItem(row: TaskRowInput, timeZone: string): TaskListItem {
  return {
    id: row.id,
    title: row.title,
    done: row.status === "done",
    statusLabel: STATUS_LABELS[row.status] ?? row.status,
    dueLabel: row.due_date ? formatDay(row.due_date, timeZone) : null,
    subjectName: row.subject?.name ?? null,
    subjectColorTag: row.subject?.color_tag ?? null,
    sourceMessageId: row.source_message_id,
    fromWhatsApp: row.source === "whatsapp_group",
    typeLabel: row.task_type ? (TASK_TYPE_LABELS[row.task_type] ?? null) : null,
  };
}

/**
 * Open tasks first, soonest due first, undated last; finished tasks sink to the
 * bottom. Ties keep title order so the list does not shuffle between refreshes.
 */
export function sortTasks(
  rows: TaskRowInput[],
  timeZone: string,
): TaskListItem[] {
  const decorated = rows.map((row) => ({
    item: toTaskItem(row, timeZone),
    due: row.due_date ? Date.parse(row.due_date) : Number.POSITIVE_INFINITY,
  }));
  decorated.sort((a, b) => {
    if (a.item.done !== b.item.done) return a.item.done ? 1 : -1;
    if (a.due !== b.due) return a.due < b.due ? -1 : 1;
    return a.item.title.localeCompare(b.item.title);
  });
  return decorated.map((entry) => entry.item);
}

export function toEventItem(row: EventRowInput, timeZone: string): EventListItem {
  return {
    id: row.id,
    title: row.title,
    dayLabel: formatDay(row.start_at, timeZone),
    dayKey: dayKeyOf(row.start_at, timeZone),
    timeLabel: row.all_day ? "All day" : formatTime(row.start_at, timeZone),
    typeLabel: row.type ? (EVENT_TYPE_LABELS[row.type] ?? null) : null,
    location: row.location && row.location.trim() !== "" ? row.location : null,
    subjectName: row.subject?.name ?? null,
    subjectColorTag: row.subject?.color_tag ?? null,
    sourceMessageId: row.source_message_id,
    fromWhatsApp: row.source === "whatsapp_group",
  };
}

/** Day groups in date order; within a day all-day first, then by start time. */
export function groupEventsByDay(
  rows: EventRowInput[],
  timeZone: string,
): EventDayGroup[] {
  const sorted = [...rows].sort((a, b) => {
    const byDay = dayKeyOf(a.start_at, timeZone).localeCompare(
      dayKeyOf(b.start_at, timeZone),
    );
    if (byDay !== 0) return byDay;
    if (a.all_day !== b.all_day) return a.all_day ? -1 : 1;
    return Date.parse(a.start_at) - Date.parse(b.start_at);
  });
  const groups: EventDayGroup[] = [];
  for (const row of sorted) {
    const item = toEventItem(row, timeZone);
    const last = groups[groups.length - 1];
    if (last !== undefined && last.dayKey === item.dayKey) {
      last.events.push(item);
    } else {
      groups.push({ dayKey: item.dayKey, dayLabel: item.dayLabel, events: [item] });
    }
  }
  return groups;
}
