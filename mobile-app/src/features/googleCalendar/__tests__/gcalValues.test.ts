import {
  GCAL_COPY,
  gcalSyncedLabel,
  gcalView,
  parseGcalSnapshot,
  sortCalendars,
} from "../gcalValues";

const snapshot = (over = {}) => ({
  configured: true,
  status: "connected",
  lastError: null,
  autoExport: false,
  lastSyncedAt: "2026-11-22T10:00:00Z",
  calendars: [
    {
      id: "c2",
      googleCalendarId: "holiday@group.v.calendar.google.com",
      summary: "Holidays",
      timezone: null,
      isActive: false,
    },
    {
      id: "c1",
      googleCalendarId: "primary",
      summary: "Primary",
      timezone: "UTC",
      isActive: true,
    },
  ],
  ...over,
});

describe("parseGcalSnapshot", () => {
  it("accepts a well-formed snapshot and keeps only real calendars", () => {
    const parsed = parseGcalSnapshot(snapshot());
    expect(parsed?.status).toBe("connected");
    expect(parsed?.calendars.length).toBe(2);
    expect(parsed?.lastSyncedAt).toBe("2026-11-22T10:00:00Z");
  });

  it("drops calendar rows without ids and refuses a bad shape", () => {
    const parsed = parseGcalSnapshot({
      ...snapshot(),
      calendars: [{ summary: "no ids" }, { id: "c3", googleCalendarId: "x@group" }],
    });
    expect(parsed?.calendars.length).toBe(1);
    expect(parseGcalSnapshot(null)).toBeNull();
    expect(parseGcalSnapshot({ status: "nonsense" })).toBeNull();
  });

  it("keeps the honest not_configured state", () => {
    const parsed = parseGcalSnapshot({
      configured: false,
      status: "not_configured",
      lastError: null,
      autoExport: false,
      lastSyncedAt: null,
      calendars: [],
    });
    expect(parsed?.status).toBe("not_configured");
  });
});

describe("gcalView", () => {
  it("shows the connect control only when a link can start", () => {
    expect(gcalView(parseGcalSnapshot(snapshot())!).showConnect).toBe(false);
    const notLinked = gcalView(parseGcalSnapshot(snapshot({ status: "not_connected" }))!);
    expect(notLinked.showConnect).toBe(true);
    expect(notLinked.showCalendars).toBe(false);
    const needsReconnect = gcalView(parseGcalSnapshot(snapshot({ status: "error" }))!);
    expect(needsReconnect.tone).toBe("danger");
    expect(needsReconnect.showConnect).toBe(true);
    expect(needsReconnect.showDisconnect).toBe(true);
  });
});

describe("gcalSyncedLabel", () => {
  it("reports the same relative timestamps as the workspace", () => {
    const now = Date.parse("2026-11-22T10:02:00Z");
    const parsed = parseGcalSnapshot(snapshot())!;
    expect(gcalSyncedLabel(parsed, now)).toBe("2m ago");
    expect(
      gcalSyncedLabel(parseGcalSnapshot(snapshot({ lastSyncedAt: null }))!, now),
    ).toBe("Not synced yet");
  });
});

describe("sortCalendars", () => {
  it("orders active first, then A to Z", () => {
    const parsed = parseGcalSnapshot(snapshot())!;
    const sorted = sortCalendars(parsed.calendars);
    expect(sorted.map((calendar) => calendar.googleCalendarId)).toEqual([
      "primary",
      "holiday@group.v.calendar.google.com",
    ]);
  });
});

describe("GCAL_COPY", () => {
  it("never promises anything the server does not do", () => {
    expect(GCAL_COPY.DISCONNECT_NOTE).toContain("left as they are");
    expect(GCAL_COPY.SYNC_NOT_CONNECTED).toContain("Connect");
  });
});
