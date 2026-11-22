import {
  buildCalendarItems,
  dayHeading,
  itemKeysOf,
  itemsForDay,
  shiftDayKey,
  shiftWeek,
  weekDays,
} from "../calendarView";
import type { EventRowInput, TaskRowInput } from "@/features/agenda/agenda";

const event = (over: Partial<EventRowInput>): EventRowInput => ({
  id: "e",
  title: "Event",
  start_at: "2026-11-24T09:00:00Z",
  end_at: null,
  all_day: false,
  type: null,
  location: null,
  source: "manual",
  source_message_id: null,
  subject: null,
  ...over,
});

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

describe("buildCalendarItems", () => {
  it("merges events and open deadlines, chronologically", () => {
    const items = buildCalendarItems(
      [
        event({ id: "exam", title: "Midterm", start_at: "2026-11-26T04:30:00Z", type: "exam" }),
        event({ id: "class", title: "Lecture", start_at: "2026-11-24T04:30:00Z", type: "class" }),
      ],
      [
        task({ id: "due", title: "Assignment", due_date: "2026-11-25T18:29:00Z" }),
        task({ id: "done", title: "Done", status: "done", due_date: "2026-11-24T18:29:00Z" }),
        task({ id: "none", title: "No date" }),
      ],
      "Asia/Kolkata",
    );
    expect(items.map((item) => item.id)).toEqual([
      "event:class",
      "task:due",
      "event:exam",
    ]);
    expect(items[1].typeLabel).toBe("Due");
    const keys = itemKeysOf(items, "Asia/Kolkata");
    expect(keys.has("2026-11-24")).toBe(true);
    expect(keys.has("2026-11-25")).toBe(true);
  });

  it("carries Google Calendar provenance on imported events only", () => {
    const items = buildCalendarItems(
      [event({ id: "g", source: "google_calendar" })],
      [
        task({
          id: "due",
          due_date: "2026-11-25T18:29:00Z",
          google_event_id: "g-1",
        }),
      ],
      "UTC",
    );
    expect(items[0].fromGoogleCalendar).toBe(true);
    expect(items[0].fromWhatsApp).toBe(false);
    // A task exported to Google is not a Google-sourced row.
    expect(items[1].fromGoogleCalendar).toBe(false);
  });
});

describe("week strip", () => {
  it("builds a Monday-start week with today, selection and dots", () => {
    const days = weekDays(
      "2026-11-22",
      "2026-11-22",
      "2026-11-22",
      new Set(["2026-11-19"]),
    );
    expect(days.map((day) => day.key)).toEqual([
      "2026-11-16",
      "2026-11-17",
      "2026-11-18",
      "2026-11-19",
      "2026-11-20",
      "2026-11-21",
      "2026-11-22",
    ]);
    expect(days[6].isToday).toBe(true);
    expect(days[6].isSelected).toBe(true);
    expect(days[3].hasItems).toBe(true);
    expect(days[3].weekdayLabel).toBe("T");
  });

  it("shifts days and whole weeks without DST drift", () => {
    expect(shiftDayKey("2026-11-22", 2)).toBe("2026-11-24");
    expect(shiftDayKey("2026-12-01", -1)).toBe("2026-11-30");
    expect(shiftWeek("2026-11-22", "2026-11-22", 1)).toEqual({
      anchorKey: "2026-11-29",
      selectedKey: "2026-11-29",
    });
    expect(shiftWeek("2026-11-22", "2026-11-22", -1)).toEqual({
      anchorKey: "2026-11-15",
      selectedKey: "2026-11-15",
    });
  });
});

describe("itemsForDay and heading", () => {
  it("filters the agenda by the selected zone day", () => {
    const items = buildCalendarItems(
      [
        event({ id: "late", start_at: "2026-11-24T20:00:00Z" }),
        event({ id: "next", start_at: "2026-11-26T09:00:00Z" }),
      ],
      [],
      "Asia/Kolkata",
    );
    expect(itemsForDay(items, "2026-11-25", "Asia/Kolkata").map((i) => i.id)).toEqual([
      "event:late",
    ]);
    expect(dayHeading("2026-11-25")).toBe("Wednesday, Nov 25");
  });
});
