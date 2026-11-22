import {
  groupEventsByDay,
  safeZone,
  sortTasks,
  toEventItem,
  toTaskItem,
  type EventRowInput,
  type TaskRowInput,
} from "../agenda";

const task = (over: Partial<TaskRowInput>): TaskRowInput => ({
  id: "t",
  title: "Task",
  status: "todo",
  due_date: null,
  priority: null,
  task_type: null,
  source: "manual",
  source_message_id: null,
  subject: null,
  ...over,
});

const event = (over: Partial<EventRowInput>): EventRowInput => ({
  id: "e",
  title: "Event",
  start_at: "2026-11-20T09:00:00Z",
  end_at: null,
  all_day: false,
  type: null,
  location: null,
  source: "manual",
  source_message_id: null,
  subject: null,
  ...over,
});

describe("tasks", () => {
  it("marks WhatsApp tasks and shows the course", () => {
    const item = toTaskItem(
      task({
        source: "whatsapp_group",
        source_message_id: "m-1",
        subject: { name: "Databases" },
        task_type: "assignment",
      }),
      "UTC",
    );
    expect(item.fromWhatsApp).toBe(true);
    expect(item.subjectName).toBe("Databases");
    expect(item.typeLabel).toBe("Assignment");
    expect(item.sourceMessageId).toBe("m-1");
    expect(toTaskItem(task({}), "UTC").fromWhatsApp).toBe(false);
  });

  it("carries the subject tag slug and falls back to a null tag", () => {
    const tagged = toTaskItem(
      task({ subject: { name: "Linear Algebra", color_tag: "MATH201" } }),
      "UTC",
    );
    expect(tagged.subjectColorTag).toBe("MATH201");
    expect(toTaskItem(task({ subject: { name: "Databases" } }), "UTC").subjectColorTag).toBeNull();
    expect(toTaskItem(task({ subject: { name: "Databases", color_tag: null } }), "UTC").subjectColorTag).toBeNull();
  });

  it("formats the due date in the profile zone, never as a raw timestamp", () => {
    // 2026-11-19T20:00Z is already Nov 20 in Asia/Kolkata (UTC+5:30).
    const row = task({ due_date: "2026-11-19T20:00:00Z" });
    expect(toTaskItem(row, "Asia/Kolkata").dueLabel).toBe("Fri, Nov 20");
    expect(toTaskItem(row, "America/Los_Angeles").dueLabel).toBe("Thu, Nov 19");
    expect(toTaskItem(task({}), "UTC").dueLabel).toBeNull();
  });

  it("orders open tasks by due date, undated last, done at the bottom", () => {
    const sorted = sortTasks(
      [
        task({ id: "done", title: "A", status: "done", due_date: "2026-11-01T00:00:00Z" }),
        task({ id: "none", title: "B" }),
        task({ id: "late", title: "C", due_date: "2026-12-01T00:00:00Z" }),
        task({ id: "soon", title: "D", due_date: "2026-11-20T00:00:00Z" }),
      ],
      "UTC",
    );
    expect(sorted.map((t) => t.id)).toEqual(["soon", "late", "none", "done"]);
    expect(sorted[3].done).toBe(true);
  });
});

describe("calendar", () => {
  it("marks WhatsApp events and labels all-day and timed ones", () => {
    const timed = toEventItem(
      event({
        source: "whatsapp_group",
        source_message_id: "m-1",
        type: "exam",
        subject: { name: "Physics", color_tag: "PHY101" },
      }),
      "UTC",
    );
    expect(timed.fromWhatsApp).toBe(true);
    expect(timed.fromGoogleCalendar).toBe(false);
    expect(timed.typeLabel).toBe("Exam");
    expect(timed.timeLabel).toBe("9:00 AM");
    expect(timed.subjectColorTag).toBe("PHY101");
    expect(timed.sourceMessageId).toBe("m-1");
    expect(toEventItem(event({ all_day: true }), "UTC").timeLabel).toBe("All day");
  });

  it("marks Google Calendar imports and exported tasks", () => {
    const imported = toEventItem(
      event({ source: "google_calendar", source_message_id: null }),
      "UTC",
    );
    expect(imported.fromGoogleCalendar).toBe(true);
    expect(imported.fromWhatsApp).toBe(false);

    expect(toTaskItem(task({ google_event_id: "g-1" }), "UTC").onGoogleCalendar).toBe(true);
    expect(toTaskItem(task({ google_event_id: null }), "UTC").onGoogleCalendar).toBe(false);
    expect(toTaskItem(task({}), "UTC").onGoogleCalendar).toBe(false);
  });

  it("puts an event on the day it falls on in the profile zone", () => {
    const row = event({ start_at: "2026-11-19T20:00:00Z" });
    expect(toEventItem(row, "Asia/Kolkata").dayKey).toBe("2026-11-20");
    expect(toEventItem(row, "America/Los_Angeles").dayKey).toBe("2026-11-19");
  });

  it("groups by day in order, all-day first, then by time", () => {
    const days = groupEventsByDay(
      [
        event({ id: "later", start_at: "2026-11-20T15:00:00Z" }),
        event({ id: "next-day", start_at: "2026-11-21T09:00:00Z" }),
        event({ id: "early", start_at: "2026-11-20T08:00:00Z" }),
        event({ id: "allday", start_at: "2026-11-20T12:00:00Z", all_day: true }),
      ],
      "UTC",
    );
    expect(days.map((d) => d.dayKey)).toEqual(["2026-11-20", "2026-11-21"]);
    expect(days[0].events.map((e) => e.id)).toEqual(["allday", "early", "later"]);
    expect(days[0].dayLabel).toBe("Fri, Nov 20");
  });

  it("falls back to UTC for a missing or invalid timezone", () => {
    expect(safeZone(null)).toBe("UTC");
    expect(safeZone("Not/AZone")).toBe("UTC");
    expect(safeZone("Asia/Kolkata")).toBe("Asia/Kolkata");
  });
});
