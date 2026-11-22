/**
 * Google Calendar sync: the `gcal.sync` pipeline.
 *
 * One job = one user (ids-only payload `{ userId }`). The steps:
 *
 *   1. gate: a connected google row and a stored (encrypted) refresh token;
 *   2. mint an in-memory access token (never persisted);
 *   3. mirror the calendar list; `primary` starts ON, every other calendar OFF;
 *      the dedicated export calendar is excluded from the import set;
 *   4. per ACTIVE calendar: incremental `events.list` with the stored
 *      syncToken (first run: a bounded −30d…+365d window); upsert into
 *      `events` with source='google_calendar' + source_ref=<google id>
 *      (the unique index is the dedupe key); a cancelled/deleted Google event
 *      deletes the local row; a gone cursor (410) resets and re-syncs fully;
 *   5. export (opt-in): find-or-create the "UniPilot" calendar, then insert
 *      never-exported rows (source <> google_calendar AND google_event_id IS
 *      NULL) and patch already-exported ones so a deadline edit updates the
 *      same Google event. The private `unipilotSource` property makes every
 *      export self-identifying; the loop never crosses because imported rows
 *      are excluded by source;
 *   6. stamp last_synced_at, record one run row (mode='sync'), record usage.
 *
 * Failure policy: a revoked/expired grant (401/403) marks the connection
 * `error` with sanitized "reconnect" copy and is NOT retried; 429/5xx retry
 * through the runner's backoff; Google response bodies are never logged.
 * The job lease is heartbeat (touch_job) for the whole pass.
 */
import { startJobHeartbeat } from "../heartbeat.mjs";
import {
  ensureExportCalendar,
  insertExportedEvent,
  listCalendars,
  listEvents,
  patchExportedEvent,
  GCAL_MESSAGES,
  GcalError,
  readGcalConfig,
  refreshAccessToken,
} from "./googleClient.mjs";
import * as repo from "./repo.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;
/** First-run window: a month back, a year forward (the web's posture). */
const FIRST_RUN_MIN_AGE_MS = 30 * DAY_MS;
const FIRST_RUN_HORIZON_MS = 365 * DAY_MS;
/** The export pass is bounded so one sync can never hammer the API. */
const EXPORT_INSERT_LIMIT = 100;
const EXPORT_PATCH_LIMIT = 100;

const EXPORT_CALENDAR_SUMMARY = "UniPilot";
const EXPORT_SOURCE_KEY = "unipilotSource";

function permanent(message) {
  const error = new Error(message);
  error.retryable = false;
  return error;
}

/** RFC3339 from a Google dateTime; all-day `date` sits at noon UTC so the
 * calendar day survives the profile-zone rendering for the common offsets. */
function toInstant(googleWhen) {
  if (typeof googleWhen?.dateTime === "string") return googleWhen.dateTime;
  if (typeof googleWhen?.date === "string") {
    return `${googleWhen.date}T12:00:00.000Z`;
  }
  return null;
}

function importedEventOf(googleEvent) {
  if (typeof googleEvent?.id !== "string" || googleEvent.id === "") return null;
  const start = toInstant(googleEvent.start);
  if (start === null) return null;
  const end = toInstant(googleEvent.end);
  return {
    googleEventId: googleEvent.id,
    title: typeof googleEvent.summary === "string" && googleEvent.summary.trim() !== ""
      ? googleEvent.summary.trim()
      : "Untitled event",
    description:
      typeof googleEvent.description === "string" && googleEvent.description.trim() !== ""
        ? googleEvent.description.trim()
        : null,
    startAt: start,
    endAt: end,
    allDay: typeof googleEvent.start?.date === "string",
    location:
      typeof googleEvent.location === "string" && googleEvent.location.trim() !== ""
        ? googleEvent.location.trim()
        : null,
  };
}

function addDays(dateString, days) {
  const [year, month, day] = dateString.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day) + days * DAY_MS);
  return next.toISOString().slice(0, 10);
}

/** The exported event body: times plus the self-identifying private property. */
function exportedBodyOf(kind, row, sourceValue) {
  const body = {
    summary: row.title,
    description: row.description ?? undefined,
    extendedProperties: { private: { [EXPORT_SOURCE_KEY]: sourceValue } },
  };
  if (kind === "task") {
    // A deadline is a timed event with a real 30-minute span. The export set
    // excludes undated tasks, so the fallback is only a defensive path.
    if (row.due_date) {
      body.start = { dateTime: row.due_date, timeZone: "UTC" };
      body.end = {
        dateTime: new Date(Date.parse(row.due_date) + 30 * 60 * 1000).toISOString(),
        timeZone: "UTC",
      };
    } else {
      const today = new Date().toISOString().slice(0, 10);
      body.start = { date: today };
      body.end = { date: addDays(today, 1) };
    }
  } else if (row.all_day) {
    // Google's all-day end is exclusive: a one-day event ends the next day.
    const startDate = row.start_at.slice(0, 10);
    body.start = { date: startDate };
    body.end = { date: row.end_at ? row.end_at.slice(0, 10) : addDays(startDate, 1) };
  } else {
    body.start = { dateTime: row.start_at, timeZone: "UTC" };
    body.end = {
      dateTime: row.end_at ?? new Date(Date.parse(row.start_at) + 60 * 60 * 1000).toISOString(),
      timeZone: "UTC",
    };
    if (row.location) body.location = row.location;
  }
  return body;
}

export async function gcalSync(payload, ctx) {
  const userId =
    typeof payload?.userId === "string" && payload.userId.trim() !== ""
      ? payload.userId.trim()
      : (typeof ctx.userId === "string" ? ctx.userId : "");
  if (!userId) throw permanent("gcal.sync needs a userId.");

  const config = readGcalConfig();
  if (config === null) throw permanent(GCAL_MESSAGES.not_configured);

  const stopHeartbeat = startJobHeartbeat(ctx);
  let imported = 0;
  let removed = 0;
  let exported = 0;
  let updated = 0;

  try {
    const connection = await repo.getConnection(ctx.client, userId);
    if (!connection || connection.status !== "connected") {
      // Nothing to do: the user disconnected between enqueue and run.
      ctx.log(`gcal user=${userId.slice(0, 8)} skipped=no-connection`);
      return;
    }

    const refreshToken = await repo.getRefreshToken(
      ctx.client,
      userId,
      process.env.UNIPILOT_INTEGRATIONS_KEY ?? "",
    );
    if (!refreshToken) {
      throw new GcalError("revoked", GCAL_MESSAGES.revoked, false);
    }

    const accessToken = await refreshAccessToken(config, refreshToken, ctx.fetchImpl);

    // 3. mirror the calendar list (primary ON; the export calendar excluded).
    const googleItems = await listCalendars(accessToken, ctx.fetchImpl);
    const calendars = await repo.upsertCalendarRows(ctx.client, userId, googleItems);
    const exportCalendarId = connection.export_calendar_id ?? null;
    const importable = calendars.filter(
      (row) => row.is_active && row.google_calendar_id !== exportCalendarId,
    );

    for (const calendar of importable) {
      let cursor = calendar.sync_cursor;
      let cursorGone = false;
      const firstRun = !cursor;
      const result = await listEvents(
        accessToken,
        calendar.google_calendar_id,
        {
          syncToken: cursor ?? undefined,
          timeMin: firstRun
            ? new Date(Date.now() - FIRST_RUN_MIN_AGE_MS).toISOString()
            : undefined,
          timeMax: firstRun
            ? new Date(Date.now() + FIRST_RUN_HORIZON_MS).toISOString()
            : undefined,
        },
        ctx.fetchImpl,
      );
      cursorGone = result.cursorGone;

      for (const googleEvent of result.events) {
        if (googleEvent.status === "cancelled") {
          if (await repo.deleteEventBySourceRef(ctx.client, userId, googleEvent.id)) {
            removed += 1;
          }
          continue;
        }
        const event = importedEventOf(googleEvent);
        if (event === null) continue;
        if (await repo.upsertEvent(ctx.client, userId, event)) imported += 1;
      }

      if (cursorGone) {
        // The cursor expired: one bounded full window re-syncs the calendar.
        const full = await listEvents(
          accessToken,
          calendar.google_calendar_id,
          {
            timeMin: new Date(Date.now() - FIRST_RUN_MIN_AGE_MS).toISOString(),
            timeMax: new Date(Date.now() + FIRST_RUN_HORIZON_MS).toISOString(),
          },
          ctx.fetchImpl,
        );
        for (const googleEvent of full.events) {
          if (googleEvent.status === "cancelled") continue;
          const event = importedEventOf(googleEvent);
          if (event === null) continue;
          if (await repo.upsertEvent(ctx.client, userId, event)) imported += 1;
        }
        await repo.setCalendarCursor(ctx.client, calendar.id, full.nextSyncToken, new Date().toISOString());
      } else {
        await repo.setCalendarCursor(ctx.client, calendar.id, result.nextSyncToken, new Date().toISOString());
      }
    }

    // 5. the opt-in export pass.
    let exportId = exportCalendarId;
    if (connection.auto_export_to_gcal) {
      exportId = await ensureExportCalendar(accessToken, exportCalendarId, ctx.fetchImpl);

      const unexported = await repo.listUnexportedRows(ctx.client, userId, EXPORT_INSERT_LIMIT);
      for (const row of unexported.tasks) {
        const googleEventId = await insertExportedEvent(
          accessToken,
          exportId,
          exportedBodyOf("task", row, `task:${row.id}`),
          ctx.fetchImpl,
        );
        await repo.setGoogleEventId(ctx.client, "tasks", userId, row.id, googleEventId);
        exported += 1;
      }
      for (const row of unexported.events) {
        const googleEventId = await insertExportedEvent(
          accessToken,
          exportId,
          exportedBodyOf("event", row, `event:${row.id}`),
          ctx.fetchImpl,
        );
        await repo.setGoogleEventId(ctx.client, "events", userId, row.id, googleEventId);
        exported += 1;
      }

      // Already-exported rows: patch so an edit updates, never duplicates.
      const exportedRows = await repo.listExportedRows(ctx.client, userId, EXPORT_PATCH_LIMIT);
      for (const row of exportedRows.tasks) {
        await patchExportedEvent(
          accessToken,
          exportId,
          row.google_event_id,
          exportedBodyOf("task", row, `task:${row.id}`),
          ctx.fetchImpl,
        );
        updated += 1;
      }
      for (const row of exportedRows.events) {
        await patchExportedEvent(
          accessToken,
          exportId,
          row.google_event_id,
          exportedBodyOf("event", row, `event:${row.id}`),
          ctx.fetchImpl,
        );
        updated += 1;
      }
    }

    // 6. stamp freshness, clear any stale error, audit, usage.
    await repo.setConnectionSynced(ctx.client, userId, new Date().toISOString(), exportId ?? undefined);
    await repo.recordRun(ctx.client, userId, "succeeded", null);
    await repo.recordUsage(ctx.client, userId, "gcal_sync");

    ctx.log(
      `gcal user=${userId.slice(0, 8)} calendars=${importable.length} imported=${imported} removed=${removed} exported=${exported} updated=${updated}`,
    );
  } catch (caught) {
    if (caught instanceof GcalError) {
      if (!caught.retryable) {
        await repo.markConnectionError(ctx.client, userId, caught.message).catch(() => {});
        // A permanent failure is part of the pass's history; a retryable one
        // will be retried and only its final settlement is recorded.
        await repo.recordRun(ctx.client, userId, "failed", caught.message).catch(() => {});
      }
      const error = permanent(caught.message);
      error.retryable = caught.retryable;
      throw error;
    }
    throw caught;
  } finally {
    stopHeartbeat();
  }
}
