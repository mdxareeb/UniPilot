/**
 * Google Calendar sync: the DB half (the groupsync/repo.mjs pattern).
 * Every read/write is owner-scoped through the runner's service client; no
 * raw provider body, token or event payload is ever logged or stored.
 */
const EVENT_SOURCE = "google_calendar";

/** The google connection row, or null when there is none. */
export async function getConnection(client, userId) {
  const { data, error } = await client
    .from("integration_connections")
    .select("status, auto_export_to_gcal, export_calendar_id")
    .eq("user_id", userId)
    .eq("provider", "google")
    .maybeSingle();
  if (error) throw new Error("Failed to read the Google connection.");
  return data;
}

/** The stored (encrypted) refresh token through the service-only RPC. */
export async function getRefreshToken(client, userId, key) {
  const { data, error } = await client.rpc("get_google_credentials", {
    p_user_id: userId,
    p_key: key,
  });
  if (error) throw new Error("Failed to read the Google grant.");
  const row = Array.isArray(data) ? data[0] : null;
  return row ? row.refresh_token : null;
}

export async function markConnectionError(client, userId, message) {
  const { error } = await client
    .from("integration_connections")
    .update({ status: "error", last_error: message })
    .eq("user_id", userId)
    .eq("provider", "google");
  if (error) throw new Error("Failed to mark the Google connection.");
}

export async function setConnectionSynced(client, userId, isoDate, exportCalendarId) {
  const patch = { last_synced_at: isoDate, last_error: null };
  if (exportCalendarId !== undefined) patch.export_calendar_id = exportCalendarId;
  const { error } = await client
    .from("integration_connections")
    .update(patch)
    .eq("user_id", userId)
    .eq("provider", "google");
  if (error) throw new Error("Failed to stamp the sync.");
}

export async function clearConnectionError(client, userId) {
  const { error } = await client
    .from("integration_connections")
    .update({ last_error: null })
    .eq("user_id", userId)
    .eq("provider", "google");
  if (error) throw new Error("Failed to clear the error.");
}

/** The caller's calendar rows (import toggles + cursors). */
export async function listCalendarRows(client, userId) {
  const { data, error } = await client
    .from("google_calendars")
    .select("id, google_calendar_id, is_active, sync_cursor, summary")
    .eq("user_id", userId);
  if (error) throw new Error("Failed to read the Google calendars.");
  return data ?? [];
}

/**
 * Mirror Google's calendar list into rows. Existing rows keep the owner's
 * `is_active` (never clobbered); a NEW row is ON only for `primary` (every
 * secondary/holiday calendar starts OFF by design).
 */
export async function upsertCalendarRows(client, userId, googleItems) {
  const existing = await listCalendarRows(client, userId);
  const byGoogleId = new Map(existing.map((row) => [row.google_calendar_id, row]));

  for (const item of googleItems) {
    if (typeof item?.id !== "string" || item.id === "") continue;
    const current = byGoogleId.get(item.id);
    if (current) {
      await client
        .from("google_calendars")
        .update({
          summary: typeof item.summaryOverride === "string" ? item.summaryOverride : item.summary ?? "",
          timezone: item.timeZone ?? null,
        })
        .eq("id", current.id);
      continue;
    }
    await client.from("google_calendars").insert({
      user_id: userId,
      google_calendar_id: item.id,
      summary:
        typeof item.summaryOverride === "string" ? item.summaryOverride : item.summary ?? "",
      timezone: item.timeZone ?? null,
      // Approved default: the student's own primary calendar starts ON;
      // every other calendar waits for an explicit toggle.
      is_active: item.primary === true || item.id === "primary",
      activated_at: item.primary === true || item.id === "primary" ? new Date().toISOString() : null,
    });
  }

  return listCalendarRows(client, userId);
}

export async function setCalendarCursor(client, calendarRowId, cursor, syncedAtIso) {
  const { error } = await client
    .from("google_calendars")
    .update({ sync_cursor: cursor, last_synced_at: syncedAtIso })
    .eq("id", calendarRowId);
  if (error) throw new Error("Failed to save the calendar cursor.");
}

/** Upsert one imported Google event; true when a row was inserted. */
export async function upsertEvent(client, userId, event) {
  const { data, error } = await client
    .from("events")
    .insert({
      user_id: userId,
      title: event.title,
      description: event.description,
      start_at: event.startAt,
      end_at: event.endAt,
      all_day: event.allDay,
      location: event.location,
      source: EVENT_SOURCE,
      source_ref: event.googleEventId,
    })
    .select("id")
    .maybeSingle();
  if (error) throw new Error("Failed to import the event.");
  return data !== null;
}

/** A cancelled/deleted Google event deletes the local row (approved semantics). */
export async function deleteEventBySourceRef(client, userId, googleEventId) {
  const { data, error } = await client
    .from("events")
    .delete()
    .eq("user_id", userId)
    .eq("source", EVENT_SOURCE)
    .eq("source_ref", googleEventId)
    .select("id")
    .maybeSingle();
  if (error) throw new Error("Failed to remove the cancelled event.");
  return data !== null;
}

/** The export set: never-exported rows that did NOT come from Google. */
export async function listUnexportedRows(client, userId, limit) {
  const [tasks, events] = await Promise.all([
    client
      .from("tasks")
      .select("id, title, due_date, description")
      .eq("user_id", userId)
      .neq("source", EVENT_SOURCE)
      .is("google_event_id", null)
      .neq("status", "done")
      .order("created_at", { ascending: true })
      .limit(limit),
    client
      .from("events")
      .select("id, title, start_at, end_at, all_day, description, location")
      .eq("user_id", userId)
      .neq("source", EVENT_SOURCE)
      .is("google_event_id", null)
      .order("created_at", { ascending: true })
      .limit(limit),
  ]);
  if (tasks.error || events.error) throw new Error("Failed to list the export set.");
  return { tasks: tasks.data ?? [], events: events.data ?? [] };
}

/** Rows already exported: patch them so a deadline edit updates, never duplicates. */
export async function listExportedRows(client, userId, limit) {
  const [tasks, events] = await Promise.all([
    client
      .from("tasks")
      .select("id, title, due_date, description, google_event_id")
      .eq("user_id", userId)
      .neq("source", EVENT_SOURCE)
      .not("google_event_id", "is", null)
      .order("updated_at", { ascending: true })
      .limit(limit),
    client
      .from("events")
      .select("id, title, start_at, end_at, all_day, description, location, google_event_id")
      .eq("user_id", userId)
      .neq("source", EVENT_SOURCE)
      .not("google_event_id", "is", null)
      .order("updated_at", { ascending: true })
      .limit(limit),
  ]);
  if (tasks.error || events.error) throw new Error("Failed to list the exported set.");
  return { tasks: tasks.data ?? [], events: events.data ?? [] };
}

export async function setGoogleEventId(client, table, userId, rowId, googleEventId) {
  const { error } = await client
    .from(table)
    .update({ google_event_id: googleEventId })
    .eq("id", rowId)
    .eq("user_id", userId);
  if (error) throw new Error("Failed to record the exported event.");
}

/** One audit row per pass (mode = 'sync'). */
export async function recordRun(client, userId, status, message) {
  const { error } = await client.from("integration_runs").insert({
    user_id: userId,
    mode: "sync",
    status,
    completed_at: new Date().toISOString(),
    error: message,
  });
  if (error) throw new Error("Failed to record the run.");
}

export async function recordUsage(client, userId, kind, quantity = 1) {
  const { error } = await client.from("usage_events").insert({
    user_id: userId,
    kind,
    quantity,
  });
  if (error) {
    // The ledger never blocks the sync (the whatsapp.extract rule).
    return false;
  }
  return true;
}
