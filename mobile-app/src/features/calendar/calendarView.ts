import {
  dayKeyOf,
  formatTime,
  toTaskItem,
  type EventRowInput,
  type TaskRowInput,
} from "@/features/agenda/agenda";

export type CalendarItem = {
  id: string;
  kind: "event" | "deadline";
  title: string;
  startIso: string;
  allDay: boolean;
  timeLabel: string;
  typeLabel: string;
  subjectName: string | null;
  subjectColorTag: string | null;
  location: string | null;
  description: string | null;
  confidence: number | null;
  fromWhatsApp: boolean;
  sourceMessageId: string | null;
};

const EVENT_LABELS: Record<string, string> = {
  exam: "Exam",
  lab: "Lab",
  class: "Class",
  deadline: "Deadline",
};

/** Events plus open task deadlines, in one chronological feed. */
export function buildCalendarItems(
  events: EventRowInput[],
  tasks: TaskRowInput[],
  timeZone: string,
): CalendarItem[] {
  const eventItems: CalendarItem[] = events.map((row) => ({
    id: `event:${row.id}`,
    kind: "event",
    title: row.title,
    startIso: row.start_at,
    allDay: row.all_day,
    timeLabel: row.all_day ? "All day" : formatTime(row.start_at, timeZone),
    typeLabel: row.type ? (EVENT_LABELS[row.type] ?? "Event") : "Event",
    subjectName: row.subject?.name ?? null,
    subjectColorTag: row.subject?.color_tag ?? null,
    location: row.location,
    description: row.description?.trim() || null,
    confidence: row.confidence_score ?? null,
    fromWhatsApp: row.source === "whatsapp_group",
    sourceMessageId: row.source_message_id,
  }));

  const deadlineItems: CalendarItem[] = tasks
    .filter((row) => row.due_date !== null && row.status !== "done")
    .map((row) => {
      const item = toTaskItem(row, timeZone);
      return {
        id: `task:${row.id}`,
        kind: "deadline" as const,
        title: row.title,
        startIso: row.due_date as string,
        allDay: false,
        timeLabel: formatTime(row.due_date as string, timeZone),
        typeLabel: "Due",
        subjectName: item.subjectName,
        subjectColorTag: item.subjectColorTag,
        location: null,
        description: item.description,
        confidence: item.confidence,
        fromWhatsApp: item.fromWhatsApp,
        sourceMessageId: item.sourceMessageId,
      };
    });

  return [...eventItems, ...deadlineItems].sort((a, b) => {
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    return Date.parse(a.startIso) - Date.parse(b.startIso);
  });
}

export type WeekDay = {
  key: string;
  weekdayLabel: string;
  dayNumber: string;
  isToday: boolean;
  isSelected: boolean;
  hasItems: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function partsOf(key: string): { year: number; month: number; day: number } {
  const [year, month, day] = key.split("-").map(Number);
  return { year, month, day };
}

function keyOf(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Shift a `YYYY-MM-DD` key by whole days (UTC noon math, DST-safe). */
export function shiftDayKey(key: string, days: number): string {
  const { year, month, day } = partsOf(key);
  const next = new Date(Date.UTC(year, month - 1, day, 12) + days * DAY_MS);
  return keyOf(
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    next.getUTCDate(),
  );
}

/**
 * The Monday-start week containing `anchorKey`. `itemKeys` carries the
 * `YYYY-MM-DD` keys present in the agenda, so a day can show its dot.
 */
export function weekDays(
  anchorKey: string,
  todayKey: string,
  selectedKey: string,
  itemKeys: ReadonlySet<string>,
): WeekDay[] {
  const { year, month, day } = partsOf(anchorKey);
  const anchor = new Date(Date.UTC(year, month - 1, day, 12));
  const mondayOffset = (anchor.getUTCDay() + 6) % 7;
  const start = new Date(anchor.getTime() - mondayOffset * DAY_MS);

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start.getTime() + index * DAY_MS);
    const key = keyOf(
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      date.getUTCDate(),
    );
    const label = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      weekday: "short",
    })
      .format(date)
      .slice(0, 1);
    return {
      key,
      weekdayLabel: label,
      dayNumber: String(date.getUTCDate()),
      isToday: key === todayKey,
      isSelected: key === selectedKey,
      hasItems: itemKeys.has(key),
    };
  });
}

/** Move the whole week and keep the same weekday selected. */
export function shiftWeek(
  anchorKey: string,
  selectedKey: string,
  weeks: number,
): { anchorKey: string; selectedKey: string } {
  return {
    anchorKey: shiftDayKey(anchorKey, weeks * 7),
    selectedKey: shiftDayKey(selectedKey, weeks * 7),
  };
}

export function itemKeysOf(items: CalendarItem[], timeZone: string): Set<string> {
  return new Set(items.map((item) => dayKeyOf(item.startIso, timeZone)));
}

export function itemsForDay(
  items: CalendarItem[],
  dayKey: string,
  timeZone: string,
): CalendarItem[] {
  return items.filter((item) => dayKeyOf(item.startIso, timeZone) === dayKey);
}

/** "Monday, Nov 24" heading for a selected day key. */
export function dayHeading(dayKey: string): string {
  const { year, month, day } = partsOf(dayKey);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}
