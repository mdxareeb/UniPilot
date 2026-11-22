import type { TaskListItem } from "@/features/agenda/agenda";

export type TaskStatusFilter = "upcoming" | "today" | "review" | "completed";

export const TASK_FILTERS: readonly {
  id: TaskStatusFilter;
  label: string;
}[] = [
  { id: "upcoming", label: "Upcoming" },
  { id: "today", label: "Due Today" },
  { id: "review", label: "Needs Review" },
  { id: "completed", label: "Completed" },
];

export type SubjectOption = {
  id: string;
  name: string;
  colorTag: string | null;
  count: number;
};

/** Distinct courses present in the list, A to Z, with their task counts. */
export function subjectOptions(items: TaskListItem[]): SubjectOption[] {
  const byId = new Map<string, SubjectOption>();
  for (const item of items) {
    if (item.subjectId === null || item.subjectName === null) continue;
    const existing = byId.get(item.subjectId);
    if (existing) {
      existing.count += 1;
    } else {
      byId.set(item.subjectId, {
        id: item.subjectId,
        name: item.subjectName,
        colorTag: item.subjectColorTag,
        count: 1,
      });
    }
  }
  return [...byId.values()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

/**
 * The status chip semantics:
 * - Upcoming: every open task (the default; overdue keeps its red badge);
 * - Due Today: open tasks due today in the profile zone;
 * - Completed: finished tasks;
 * - Needs Review: not a task filter (the screen renders the candidate queue).
 */
export function filterTasks(
  items: TaskListItem[],
  status: TaskStatusFilter,
  subjectId: string | null,
): TaskListItem[] {
  const byStatus =
    status === "completed"
      ? items.filter((item) => item.done)
      : status === "today"
        ? items.filter((item) => !item.done && item.dueState === "today")
        : status === "review"
          ? []
          : items.filter((item) => !item.done);

  if (subjectId === null) return byStatus;
  return byStatus.filter((item) => item.subjectId === subjectId);
}

/** `2 Pending` copy for the review banner and chip. */
export function pendingLabel(count: number): string | null {
  if (count <= 0) return null;
  return `${count} ${count === 1 ? "item" : "items"} from WhatsApp need review`;
}
