/**
 * The calendar UI's pure event helpers (Tasks 17.5–17.11): where an event's
 * data resolves on the grids, and how the one form's values become a draft
 * and back.
 *
 * Pure by construction, so the placement maths is exercised directly by the
 * structure spec the same way `calendarMath` is. Everything here operates on
 * the profile-zone values the data layer already mapped (`startDate`,
 * `startTime`, `endTime`, `endDateValue`) — no clock, no timezone maths, no
 * second date system. An event is positioned by the established seam: date →
 * column, start/end → vertical offset + height on the hour rows, minute
 * precision (17.5 §11), all derived from those strings.
 */
import type {
  EventDraftLocal,
  EventItem,
  EventType,
} from "@/lib/data/eventValues";
import { addDays, type IsoDate } from "./calendarMath";

/** A point event's rendered height when the model carries no end. */
const DEFAULT_BLOCK_MINUTES = 30;
/** The shortest a block stays legible: a 5-minute event still reads. */
const MIN_BLOCK_MINUTES = 20;
const MINUTES_PER_DAY = 24 * 60;

/** The closed type vocabulary plus the "no category" state the form offers. */
export type EventTypeChoice = "none" | EventType;

/**
 * What the one event form collects. Date and time are separate fields
 * because `allDay` switches the native inputs between a datetime pair and a
 * date pair; the conversion to the service's `EventDraftLocal` lives here so
 * both verbs send the identical shape.
 */
export type EventFormValues = {
  title: string;
  type: EventTypeChoice;
  allDay: boolean;
  /** "YYYY-MM-DD" from the date input. */
  startDate: string;
  /** "HH:mm" from the time part of `datetime-local`; unused when allDay. */
  startTime: string;
  /** "" when the event has no end. For all-day it is the last day. */
  endDate: string;
  /** "" when absent; unused when allDay. */
  endTime: string;
  location: string;
  /** "" for no course; otherwise a subject id. */
  subjectId: string;
};

/** Form values → the validated local draft the Server Action parses. */
export function toEventDraftLocal(values: EventFormValues): EventDraftLocal {
  return {
    title: values.title.trim(),
    type: values.type === "none" ? null : values.type,
    allDay: values.allDay,
    startAt: values.allDay
      ? values.startDate
      : `${values.startDate}T${values.startTime}`,
    endAt:
      values.endDate === ""
        ? null
        : values.allDay
          ? values.endDate
          : `${values.endDate}T${values.endTime}`,
    location: values.location.trim() === "" ? null : values.location.trim(),
    description: null,
    subjectId: values.subjectId === "" ? null : values.subjectId,
  };
}

/**
 * Event contract → form values for the edit dialog. All-day ends come back
 * as the exclusive next day, so the form shows the last real day; timed ends
 * are already the inclusive end date.
 */
export function eventFormValues(event: EventItem): EventFormValues {
  return {
    title: event.title,
    type: event.typeValue ?? "none",
    allDay: event.allDay,
    startDate: event.startDate,
    startTime: event.startTime ?? "",
    endDate:
      event.endDateValue === undefined
        ? ""
        : event.allDay
          ? addDays(event.endDateValue, -1)
          : event.endDateValue,
    endTime: event.endTime ?? "",
    location: event.location ?? "",
    subjectId: event.subjectId ?? "",
  };
}

/**
 * The dates an event occupies, as a half-open span `[start, endExclusive)`:
 * all-day events already store an exclusive end, a timed end date is
 * inclusive (an event ending tomorrow at 01:00 touches tomorrow), and a
 * point event touches its start date alone.
 */
export function eventDateSpan(event: EventItem): {
  start: IsoDate;
  endExclusive: IsoDate;
} {
  if (event.allDay) {
    return {
      start: event.startDate,
      endExclusive: event.endDateValue ?? addDays(event.startDate, 1),
    };
  }
  const lastDay = event.endDateValue ?? event.startDate;
  return { start: event.startDate, endExclusive: addDays(lastDay, 1) };
}

/** Whether the event touches a grid date (month chips, week all-day band). */
export function eventCoversDate(event: EventItem, iso: IsoDate): boolean {
  const { start, endExclusive } = eventDateSpan(event);
  return start <= iso && iso < endExclusive;
}

/**
 * The order one date renders its events in: all-day first, then by start
 * time, then title — the calendar's own reading order, not the service's.
 */
function compareForDate(a: EventItem, b: EventItem): number {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  const aTime = a.startTime ?? "";
  const bTime = b.startTime ?? "";
  if (aTime !== bTime) return aTime < bTime ? -1 : 1;
  return a.title.localeCompare(b.title);
}

/** Every event touching one date, in reading order. */
export function eventsForDate(
  events: readonly EventItem[],
  iso: IsoDate,
): EventItem[] {
  return events.filter((event) => eventCoversDate(event, iso)).sort(compareForDate);
}

/** The all-day events of one week day, in the day header's chip band. */
export function allDayEventsForDate(
  events: readonly EventItem[],
  iso: IsoDate,
): EventItem[] {
  return eventsForDate(events, iso).filter((event) => event.allDay);
}

/** "HH:mm" → minutes after midnight; null for anything malformed. */
export function minutesOf(time: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes < MINUTES_PER_DAY ? minutes : null;
}

/**
 * A timed event's block geometry inside the week grid: which hour cell it
 * starts in, its minute offset as a percentage of that cell, and its height
 * as a percentage of one hour row (heights above 100% intentionally spill
 * into the following rows — that is the multi-hour block). Minute precision
 * comes from `startTime`/`endTime`; an end past midnight clamps to the end
 * of the displayed day, and a point event gets the 30-minute reading height.
 */
export type BlockPlacement = {
  /** The 0–23 hour cell the block begins in (`data-hour`). */
  hour: number;
  topPercent: number;
  heightPercent: number;
};

export function timedPlacement(event: EventItem): BlockPlacement | null {
  if (event.allDay || event.startTime === undefined) return null;
  const start = minutesOf(event.startTime);
  if (start === null) return null;

  const end = event.endTime === undefined ? null : minutesOf(event.endTime);
  const duration =
    end !== null && end > start
      ? end - start
      : (event.durationMinutes ?? DEFAULT_BLOCK_MINUTES);

  const clamped = Math.max(
    MIN_BLOCK_MINUTES,
    Math.min(duration, MINUTES_PER_DAY - start),
  );

  return {
    hour: Math.floor(start / 60),
    topPercent: ((start % 60) / 60) * 100,
    heightPercent: (clamped / 60) * 100,
  };
}

/** What a block shows: metadata demoted by duration (17.5's reading rule). */
export function blockShowsMetadata(event: EventItem): boolean {
  const placement = timedPlacement(event);
  if (placement === null) return true;
  return placement.heightPercent >= 75;
}
