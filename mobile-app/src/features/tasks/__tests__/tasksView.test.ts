import { toTaskItem, type TaskRowInput } from "@/features/agenda/agenda";
import {
  filterTasks,
  pendingLabel,
  subjectOptions,
} from "../tasksView";

const NOW = Date.parse("2026-11-22T10:00:00Z");

const row = (over: Partial<TaskRowInput>): TaskRowInput => ({
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

const items = [
  toTaskItem(
    row({
      id: "overdue",
      title: "Overdue",
      due_date: "2026-11-21T10:00:00Z",
      subject_id: "s-1",
      subject: { name: "Databases", color_tag: "CS301" },
    }),
    "UTC",
    NOW,
  ),
  toTaskItem(
    row({
      id: "today",
      title: "Today",
      due_date: "2026-11-22T20:00:00Z",
      subject_id: "s-1",
      subject: { name: "Databases", color_tag: "CS301" },
    }),
    "UTC",
    NOW,
  ),
  toTaskItem(
    row({
      id: "soon",
      title: "Soon",
      due_date: "2026-11-23T08:00:00Z",
      subject_id: "s-2",
      subject: { name: "Physics" },
    }),
    "UTC",
    NOW,
  ),
  toTaskItem(
    row({ id: "done", title: "Done", status: "done", due_date: "2026-11-20T10:00:00Z" }),
    "UTC",
    NOW,
  ),
];

describe("due state", () => {
  it("labels overdue, due today, due soon and later honestly", () => {
    expect(items[0].dueState).toBe("overdue");
    expect(items[0].dueBadge).toBe("Overdue");
    expect(items[1].dueState).toBe("today");
    expect(items[2].dueState).toBe("soon");
    expect(items[3].dueBadge).toBeNull();
  });
});

describe("filterTasks", () => {
  it("keeps open tasks in Upcoming, including overdue ones", () => {
    expect(filterTasks(items, "upcoming", null).map((item) => item.id)).toEqual([
      "overdue",
      "today",
      "soon",
    ]);
  });

  it("shows only tasks due today in the Due Today chip", () => {
    expect(filterTasks(items, "today", null).map((item) => item.id)).toEqual([
      "today",
    ]);
  });

  it("shows only finished tasks in Completed", () => {
    expect(filterTasks(items, "completed", null).map((item) => item.id)).toEqual([
      "done",
    ]);
  });

  it("combines a subject with the status filter", () => {
    expect(filterTasks(items, "upcoming", "s-1").map((item) => item.id)).toEqual([
      "overdue",
      "today",
    ]);
    expect(filterTasks(items, "upcoming", "missing")).toEqual([]);
  });

  it("has no task list for the review chip", () => {
    expect(filterTasks(items, "review", null)).toEqual([]);
  });
});

describe("subjectOptions", () => {
  it("lists courses A-Z with color tags and counts", () => {
    expect(subjectOptions(items)).toEqual([
      { id: "s-1", name: "Databases", colorTag: "CS301", count: 2 },
      { id: "s-2", name: "Physics", colorTag: null, count: 1 },
    ]);
  });
});

describe("pendingLabel", () => {
  it("pluralises honestly and hides at zero", () => {
    expect(pendingLabel(0)).toBeNull();
    expect(pendingLabel(1)).toContain("1 item");
    expect(pendingLabel(3)).toContain("3 items");
  });
});
