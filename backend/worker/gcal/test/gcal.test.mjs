import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  GCAL_MESSAGES,
  GcalError,
  listEvents,
  readGcalConfig,
  refreshAccessToken,
} from "../googleClient.mjs";
import { gcalSync } from "../sync.mjs";
import { createMemoryClient } from "./memoryClient.mjs";

process.env.GOOGLE_OAUTH_CLIENT_ID = "client-id";
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "client-secret";

const USER = "11111111-1111-4111-8111-111111111111";
const CONFIG = readGcalConfig();

function ctxOf(client, extra = {}) {
  return {
    client,
    jobId: "job-1",
    userId: USER,
    attempt: 1,
    maxAttempts: 5,
    workerId: "test-worker",
    log: () => {},
    ...extra,
  };
}

function okJson(body) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  };
}

function failedJson(status) {
  return { ok: false, status, json: async () => ({}) };
}

describe("readGcalConfig", () => {
  it("needs BOTH the client id and secret, and guesses neither", () => {
    assert.equal(readGcalConfig({}), null);
    assert.equal(readGcalConfig({ GOOGLE_OAUTH_CLIENT_ID: "id" }), null);
    assert.ok(CONFIG && CONFIG.clientId === "client-id");
  });
});

describe("refreshAccessToken", () => {
  it("mints an access token from the stored refresh token", async () => {
    const token = await refreshAccessToken(CONFIG, "refresh", async () =>
      okJson({ access_token: "access-1" }),
    );
    assert.equal(token, "access-1");
  });

  it("a revoked grant is permanent with the reconnect copy", async () => {
    await assert.rejects(
      refreshAccessToken(CONFIG, "refresh", async () => failedJson(400)),
      (error) =>
        error instanceof GcalError &&
        error.code === "revoked" &&
        error.retryable === false &&
        error.message === GCAL_MESSAGES.revoked,
    );
  });

  it("a 5xx outage is retryable", async () => {
    await assert.rejects(
      refreshAccessToken(CONFIG, "refresh", async () => failedJson(503)),
      (error) => error instanceof GcalError && error.retryable === true,
    );
  });

  it("a network failure is a retryable outage", async () => {
    await assert.rejects(
      refreshAccessToken(CONFIG, "refresh", async () => {
        throw new Error("socket");
      }),
      (error) => error instanceof GcalError && error.retryable === true,
    );
  });
});

describe("listEvents", () => {
  it("reports a gone cursor so the caller resets it", async () => {
    const result = await listEvents("access", "primary", { syncToken: "old" }, async () => ({
      ok: false,
      status: 410,
      json: async () => ({}),
    }));
    assert.deepEqual(result, { events: [], nextSyncToken: null, cursorGone: true });
  });

  it("returns events and the next sync token", async () => {
    const result = await listEvents("access", "primary", {}, async () =>
      okJson({ items: [{ id: "e1" }], nextSyncToken: "next" }),
    );
    assert.deepEqual(result.events, [{ id: "e1" }]);
    assert.equal(result.nextSyncToken, "next");
    assert.equal(result.cursorGone, false);
  });
});

describe("gcalSync", () => {
  it("skips quietly when the connection is gone", async () => {
    const client = createMemoryClient();
    const seen = [];
    const gcal = gcalSync({ userId: USER }, ctxOf(client));
    await gcal;
    assert.ok(client.state.calls.includes("integration_connections:select"));
    assert.ok(!client.state.calls.includes("rpc:get_google_credentials"));
  });

  it("imports active calendars, deletes cancelled events and exports opt-in rows", async () => {
    const client = createMemoryClient();
    client.state.tables.integration_connections.push({
      user_id: USER,
      provider: "google",
      status: "connected",
      auto_export_to_gcal: true,
      export_calendar_id: "unipilot-cal",
      last_error: null,
    });
    // An event imported in a previous run that Google has since cancelled.
    client.state.tables.events.push({
      id: "existing-1",
      user_id: USER,
      title: "Old event",
      start_at: new Date().toISOString(),
      all_day: false,
      source: "google_calendar",
      source_ref: "gevent-cancelled",
    });
    // One unexported task and one already-exported event; one undated task
    // must never be exported (it is not a deadline).
    client.state.tables.tasks.push({
      id: "task-1",
      user_id: USER,
      title: "Assignment 5",
      status: "todo",
      source: "whatsapp_group",
      due_date: new Date(Date.now() + 3 * 86400000).toISOString(),
      description: "From the group",
      google_event_id: null,
    });
    client.state.tables.tasks.push({
      id: "task-undated",
      user_id: USER,
      title: "Read the chapter",
      status: "todo",
      source: "manual",
      due_date: null,
      description: null,
      google_event_id: null,
    });
    client.state.tables.events.push({
      id: "event-2",
      user_id: USER,
      title: "Study group",
      start_at: new Date(Date.now() + 86400000).toISOString(),
      end_at: null,
      all_day: false,
      source: "manual",
      google_event_id: "gexport-1",
    });

    client.state.rpcHandlers.set("get_google_credentials", () => ({
      data: [{ refresh_token: "stored-refresh" }],
      error: null,
    }));

    const fetchCalls = [];
    const fakeFetch = async (url, init) => {
      fetchCalls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body });
      const target = String(url);
      if (target.startsWith("https://oauth2.googleapis.com/token")) {
        return okJson({ access_token: "access-1" });
      }
      if (target.includes("/users/me/calendarList")) {
        return okJson({
          items: [
            { id: "primary", summary: "Primary", primary: true },
            { id: "holiday", summary: "Holidays" },
            { id: "unipilot-cal", summary: "UniPilot" },
          ],
        });
      }
      if (target.includes("/calendars/primary/events")) {
        return okJson({
          items: [
            {
              id: "gevent-1",
              status: "confirmed",
              summary: "Class",
              start: { dateTime: new Date(Date.now() + 86400000).toISOString() },
              end: { dateTime: new Date(Date.now() + 2 * 86400000).toISOString() },
            },
            { id: "gevent-cancelled", status: "cancelled" },
          ],
          nextSyncToken: "next-primary",
        });
      }
      if (target.includes("/calendars/holiday/events")) {
        // An inactive calendar is never asked for events.
        throw new Error("inactive calendar was fetched");
      }
      if (target.includes("/calendars/unipilot-cal/events") && init?.method === "POST") {
        return okJson({ id: "gexport-new-1" });
      }
      if (target.includes("/calendars/unipilot-cal/events/") && init?.method === "PATCH") {
        return okJson({ id: "gexport-1" });
      }
      return failedJson(404);
    };

    await gcalSync({ userId: USER }, ctxOf(client, { fetchImpl: fakeFetch }));

    // Calendars mirrored: primary ON, the holiday OFF, the export calendar row
    // exists but is not importable.
    const calendars = client.state.tables.google_calendars;
    const primary = calendars.find((row) => row.google_calendar_id === "primary");
    const holiday = calendars.find((row) => row.google_calendar_id === "holiday");
    assert.ok(primary?.is_active === true, "primary starts ON");
    assert.ok(holiday?.is_active === false, "secondary starts OFF");
    assert.equal(primary.sync_cursor, "next-primary");

    // The first run is a bounded window, not an unbounded crawl.
    const primaryList = fetchCalls.find((call) =>
      call.url.includes("/calendars/primary/events"),
    );
    assert.ok(primaryList.url.includes("timeMin="));
    assert.ok(primaryList.url.includes("timeMax="));

    // The new event was imported; the cancelled one deleted the local row.
    const imported = client.state.tables.events.find(
      (row) => row.source === "google_calendar" && row.source_ref === "gevent-1",
    );
    assert.ok(imported, "the new Google event was imported");
    assert.equal(
      client.state.tables.events.some((row) => row.source_ref === "gevent-cancelled"),
      false,
      "the cancelled event's row is gone",
    );

    // The export pass inserted the task and patched the already-exported event.
    const task = client.state.tables.tasks.find((row) => row.id === "task-1");
    assert.equal(task.google_event_id, "gexport-new-1");
    const undated = client.state.tables.tasks.find((row) => row.id === "task-undated");
    assert.equal(undated.google_event_id ?? null, null, "undated tasks stay local");
    const inserts = fetchCalls.filter(
      (call) => call.method === "POST" && call.url.includes("/calendars/unipilot-cal/events"),
    );
    assert.equal(inserts.length, 1, "only the dated task used the export calendar");
    const insertBody = JSON.parse(inserts[0].body);
    assert.equal(insertBody.extendedProperties.private.unipilotSource, "task:task-1");
    assert.equal(insertBody.summary, "Assignment 5");
    assert.ok(
      fetchCalls.some((call) => call.method === "PATCH" && call.url.includes("gexport-1")),
      "the already-exported event was patched, not duplicated",
    );

    // Stamps: connection freshness, a sync run row, one usage event.
    const connection = client.state.tables.integration_connections[0];
    assert.ok(connection.last_synced_at);
    assert.equal(connection.status, "connected");
    assert.equal(client.state.tables.integration_runs[0]?.mode, "sync");
    assert.equal(client.state.tables.usage_events[0]?.kind, "gcal_sync");
  });

  it("re-syncs the same Google event in place, not as a duplicate", async () => {
    const client = createMemoryClient();
    client.state.tables.integration_connections.push({
      user_id: USER,
      provider: "google",
      status: "connected",
      auto_export_to_gcal: false,
      export_calendar_id: null,
    });
    client.state.rpcHandlers.set("get_google_credentials", () => ({
      data: [{ refresh_token: "stored-refresh" }],
      error: null,
    }));

    let title = "Class";
    const fakeFetch = async (url) => {
      const target = String(url);
      if (target.startsWith("https://oauth2.googleapis.com/token")) {
        return okJson({ access_token: "access-1" });
      }
      if (target.includes("/users/me/calendarList")) {
        return okJson({ items: [{ id: "primary", summary: "Primary", primary: true }] });
      }
      if (target.includes("/calendars/primary/events")) {
        return okJson({
          items: [
            {
              id: "gevent-1",
              status: "confirmed",
              summary: title,
              start: { dateTime: "2026-11-24T09:00:00Z" },
              end: { dateTime: "2026-11-24T10:00:00Z" },
            },
          ],
          nextSyncToken: "next-1",
        });
      }
      return failedJson(404);
    };

    await gcalSync({ userId: USER }, ctxOf(client, { fetchImpl: fakeFetch }));
    title = "Class moved";
    await gcalSync({ userId: USER }, ctxOf(client, { fetchImpl: fakeFetch }));

    const imported = client.state.tables.events.filter(
      (row) => row.source === "google_calendar",
    );
    assert.equal(imported.length, 1, "the unique key kept one local row");
    assert.equal(imported[0].source_ref, "gevent-1");
    assert.equal(imported[0].title, "Class moved", "the second pass updated it");
  });

  it("a revoked grant marks the connection error and is permanent", async () => {
    const client = createMemoryClient();
    client.state.tables.integration_connections.push({
      user_id: USER,
      provider: "google",
      status: "connected",
      auto_export_to_gcal: false,
      export_calendar_id: null,
    });
    client.state.rpcHandlers.set("get_google_credentials", () => ({
      data: [{ refresh_token: "stored-refresh" }],
      error: null,
    }));

    await assert.rejects(
      gcalSync(
        { userId: USER },
        ctxOf(client, {
          fetchImpl: async (url) => {
            if (String(url).startsWith("https://oauth2.googleapis.com/token")) {
              return failedJson(400);
            }
            return failedJson(500);
          },
        }),
      ),
      (error) => error.retryable === false,
    );

    const connection = client.state.tables.integration_connections[0];
    assert.equal(connection.status, "error");
    assert.equal(connection.last_error, GCAL_MESSAGES.revoked);
    assert.equal(client.state.tables.integration_runs[0]?.status, "failed");
    assert.equal(client.state.tables.integration_runs[0]?.mode, "sync");
  });

  it("a missing stored refresh token is the same permanent reconnect", async () => {
    const client = createMemoryClient();
    client.state.tables.integration_connections.push({
      user_id: USER,
      provider: "google",
      status: "connected",
      auto_export_to_gcal: false,
      export_calendar_id: null,
    });
    client.state.rpcHandlers.set("get_google_credentials", () => ({
      data: [],
      error: null,
    }));

    await assert.rejects(
      gcalSync({ userId: USER }, ctxOf(client, { fetchImpl: async () => failedJson(500) })),
      (error) => error.retryable === false,
    );

    const connection = client.state.tables.integration_connections[0];
    assert.equal(connection.status, "error");
    assert.equal(connection.last_error, GCAL_MESSAGES.revoked);
    assert.equal(client.state.tables.integration_runs[0]?.status, "failed");
  });
});
