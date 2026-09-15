/**
 * The events service (Tasks 22.1–22.6) — the only module that reads or writes
 * a student's calendar rows.
 *
 * The repo pattern of `lib/data/tasks.ts`: server-only, typed against the
 * generated `Database` view, using the request-scoped cookie client, so the
 * authenticated session identifies the caller and the owner-only RLS policies
 * on `events` are the enforcement layer. Every query is additionally scoped
 * by `user_id`; the service role is never used.
 *
 * Callers pass the validated *local* draft (`parseEventDraft`); the service
 * reads the profile's zone and resolves it to UTC instants through
 * `resolveEventDraft`, so no component ever does timezone maths. Mutations
 * return the settled row mapped to the calendar contract, or null/false for a
 * zero-row write — never a fabricated success.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { nextDateOnly, zonedDateOnlyToInstant } from "./taskDates";
import { readProfileTimeZone } from "./profileTime";
import {
  eventRowToItem,
  resolveEventDraft,
  type EventDraft,
  type EventDraftLocal,
  type EventItem,
} from "./eventValues";

/** The embedded course name comes through RLS like any other subjects read. */
const EVENT_COLUMNS =
  "id, title, type, description, location, start_at, end_at, all_day, subject_id, source, subjects(name)";

type EventRange = {
  /** Inclusive lower bound, ISO instant. */
  start: string;
  /** Exclusive upper bound, ISO instant. */
  end: string;
};

type EventUpdate = Database["public"]["Tables"]["events"]["Update"];

/** The writable columns, shared by insert and update. */
function toWritable(draft: EventDraft) {
  return {
    title: draft.title,
    type: draft.type,
    location: draft.location,
    description: draft.description,
    start_at: draft.startAt,
    end_at: draft.endAt,
    all_day: draft.allDay,
    subject_id: draft.subjectId,
  };
}

/**
 * 22.2 Load — the caller's events that overlap the half-open window
 * `[start, end)`, soonest first. An event overlaps when it starts before the
 * window ends and either ends inside/after the window start or has no end at
 * all (a point event, included when its start is in the window).
 *
 * Range instants are normalized to UTC `Z` form before they reach PostgREST,
 * so no timezone offset can be mangled into the filter syntax.
 */
export async function listEvents(
  userId: string,
  range: EventRange,
): Promise<EventItem[]> {
  const rangeStart = new Date(range.start);
  const rangeEnd = new Date(range.end);
  if (
    Number.isNaN(rangeStart.getTime()) ||
    Number.isNaN(rangeEnd.getTime()) ||
    rangeStart.getTime() >= rangeEnd.getTime()
  ) {
    return [];
  }

  const supabase = await createClient();
  const timeZone = await readProfileTimeZone(supabase, userId);
  return loadEvents(
    supabase,
    userId,
    {
      start: rangeStart.toISOString(),
      end: rangeEnd.toISOString(),
    },
    timeZone,
  );
}

/**
 * 17.11's load — the events overlapping a *calendar-date* window, e.g. the
 * month grid's first through last displayed date (`lastDate` inclusive). The
 * boundary dates are resolved to the zone's instants here (R15), so the page
 * and every block stay free of timezone maths. The month grid is a superset
 * of the anchor's week, so one load serves both views.
 */
export async function listEventsForDates(
  userId: string,
  range: { firstDate: string; lastDate: string },
): Promise<EventItem[]> {
  const supabase = await createClient();
  const timeZone = await readProfileTimeZone(supabase, userId);
  return loadEvents(
    supabase,
    userId,
    {
      start: zonedDateOnlyToInstant(range.firstDate, timeZone),
      end: zonedDateOnlyToInstant(nextDateOnly(range.lastDate), timeZone),
    },
    timeZone,
  );
}

/** The one overlap query, shared by the instant window and the date window. */
async function loadEvents(
  supabase: SupabaseClient<Database>,
  userId: string,
  range: EventRange,
  timeZone: string,
): Promise<EventItem[]> {
  const { data, error } = await supabase
    .from("events")
    .select(EVENT_COLUMNS)
    .eq("user_id", userId)
    .lt("start_at", range.end)
    .or(
      `end_at.gte.${range.start},and(end_at.is.null,start_at.gte.${range.start})`,
    )
    .order("start_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) throw new Error("Failed to load events.");

  return (data ?? []).map((row) => eventRowToItem(row, timeZone));
}

/** 22.2 Load — one owned event by immutable id, or null when it is not ours. */
export async function getEvent(
  userId: string,
  eventId: string,
): Promise<EventItem | null> {
  const supabase = await createClient();

  const [timeZone, result] = await Promise.all([
    readProfileTimeZone(supabase, userId),
    supabase
      .from("events")
      .select(EVENT_COLUMNS)
      .eq("id", eventId)
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  if (result.error) throw new Error("Failed to load event.");
  return result.data ? eventRowToItem(result.data, timeZone) : null;
}

/** 22.3 Create. */
export async function createEvent(
  userId: string,
  local: EventDraftLocal,
): Promise<EventItem> {
  const supabase = await createClient();
  const timeZone = await readProfileTimeZone(supabase, userId);
  const draft = resolveEventDraft(local, timeZone);

  const { data, error } = await supabase
    .from("events")
    .insert({ user_id: userId, ...toWritable(draft) })
    .select(EVENT_COLUMNS)
    .single();

  if (error || !data) throw new Error("Failed to create event.");
  return eventRowToItem(data, timeZone);
}

/**
 * 22.4 Update — the edit form owns the whole event, so the validated draft
 * replaces every editable field (no sparse-patch ambiguity around `all_day`
 * and the derived end). Null when no owned row matched.
 */
export async function updateEvent(
  userId: string,
  eventId: string,
  local: EventDraftLocal,
): Promise<EventItem | null> {
  const supabase = await createClient();
  const timeZone = await readProfileTimeZone(supabase, userId);
  const draft = resolveEventDraft(local, timeZone);
  const update: EventUpdate = toWritable(draft);

  const { data, error } = await supabase
    .from("events")
    .update(update)
    .eq("id", eventId)
    .eq("user_id", userId)
    .select(EVENT_COLUMNS)
    .maybeSingle();

  if (error) throw new Error("Failed to update event.");
  return data ? eventRowToItem(data, timeZone) : null;
}

/** 22.5 Delete — true when an owned row was removed, false otherwise. */
export async function deleteEvent(
  userId: string,
  eventId: string,
): Promise<boolean> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("events")
    .delete()
    .eq("id", eventId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();

  if (error) throw new Error("Failed to delete event.");
  return data !== null;
}
