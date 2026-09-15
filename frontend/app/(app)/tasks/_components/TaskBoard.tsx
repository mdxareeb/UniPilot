"use client";

import {
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react";
import { AnimatePresence } from "motion/react";
import { CheckSquare, CircleDot, ListTodo, type LucideIcon } from "lucide-react";
import { MotionNotice } from "@/components/motion/MotionNotice";
import { Button } from "@/components/ui/Button";
import type { TaskItem, TaskUiStatus } from "@/lib/data/taskValues";
import { TaskCard } from "./TaskCard";
import { useTasks } from "./TasksWorkspace";

type StatusFilter = "all" | TaskUiStatus;

const FILTERS: readonly { id: StatusFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "todo", label: "To do" },
  { id: "in-progress", label: "In progress" },
  { id: "done", label: "Done" },
];

/**
 * The three Kanban columns (Task 16.4). One entry per status in the approved
 * vocabulary — never a fourth. The `id` is the UI status value, so the column
 * a task lands in is decided by data, not by a lookup table that could drift.
 */
const COLUMNS: readonly {
  id: TaskUiStatus;
  label: string;
  icon: LucideIcon;
  empty: string;
}[] = [
  { id: "todo", label: "To do", icon: ListTodo, empty: "No tasks here yet." },
  {
    id: "in-progress",
    label: "In progress",
    icon: CircleDot,
    empty: "No tasks here yet.",
  },
  { id: "done", label: "Done", icon: CheckSquare, empty: "No completed tasks yet." },
];

/**
 * The task board, bound to the real service (16.11) and the workspace state.
 *
 * Filtering is unchanged (16.3): one status dimension over the same three
 * columns, derived from the one filter value. What changed is where the tasks
 * come from — the workspace context — and what the columns can do now that the
 * write exists: 16.9's drag-and-drop, where a card dropped on a column calls
 * `setTaskStatusAction` through the context and the column highlights as a
 * drop target only while a drag is in flight.
 *
 * Keyboard path (16.9, never pointer-only): with focus inside a card,
 * ArrowLeft/ArrowRight move it one column; the same context mutation runs,
 * focus follows the card to its new column, and a polite live region
 * announces the move. The hint under the board names the keys.
 *
 * Optimistic behaviour (21.9) lives in the workspace; this component renders
 * the result and the workspace's sanitized error when a move rolls back.
 */
export function TaskBoard({ index }: { index: number }) {
  const {
    tasks,
    guest,
    error,
    clearError,
    announcement,
    openDetail,
    openEdit,
    requestDelete,
    move,
  } = useTasks();

  const [filter, setFilter] = useState<StatusFilter>("all");
  const [draggingTask, setDraggingTask] = useState<TaskItem | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<TaskUiStatus | null>(
    null,
  );
  /* Focus follows a keyboard move: `handleMove` records the card id, the
     render below passes `focusOnMount` to that card's fresh instance in its
     new column, and the card clears the record once it has taken focus.
     Focusing is done by the card itself (see `TaskCard`) so the hidden
     shared-layout clone Motion keeps during the transition can never receive
     focus. State, not a ref: the value is read while rendering the cards, and
     both the id and the task list update in the same batched render. */
  const [focusAfterMove, setFocusAfterMove] = useState<string | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  const hasTasks = tasks.length > 0;

  const visible = useMemo(() => {
    if (filter === "all") return tasks;
    return tasks.filter((task) => task.status === filter);
  }, [tasks, filter]);

  const filteredToNothing =
    hasTasks && filter !== "all" && visible.length === 0;

  function handleMove(task: TaskItem, status: TaskUiStatus) {
    move(task, status);
    setFocusAfterMove(task.id);
  }

  function handleDrop(event: DragEvent<HTMLElement>, status: TaskUiStatus) {
    event.preventDefault();
    const id = event.dataTransfer.getData("text/plain") || draggingTask?.id;
    const task = tasks.find((item) => item.id === id);
    setDraggingTask(null);
    setDragOverStatus(null);
    if (!task) return;
    if (task.status !== status) {
      handleMove(task, status);
    }
  }

  return (
    <div
      ref={boardRef}
      data-enter="scale"
      style={{ "--motion-index": index } as React.CSSProperties}
      className="flex min-w-0 flex-col gap-4"
    >
      {/* Polite announcements for keyboard moves; visually hidden, always
          mounted so the change is spoken. */}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {error ? (
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-base border border-border bg-glass p-3 backdrop-blur-md">
          <MotionNotice role="alert" className="text-label-sm text-destructive">
            {error}
          </MotionNotice>
          <Button variant="ghost" size="sm" onClick={clearError}>
            Dismiss
          </Button>
        </div>
      ) : null}

      <div
        role="group"
        aria-label="Filter tasks by status"
        className="flex min-w-0 flex-wrap items-center gap-1.5"
      >
        {FILTERS.map((chip) => {
          const active = filter === chip.id;
          return (
            <button
              key={chip.id}
              type="button"
              aria-pressed={active}
              onClick={() => setFilter(chip.id)}
              /* `py-2.5` puts the chip at Button-`sm` height (~40px) — the
                  project's compact-control target, a thumb can hit it. */
              className={`relative min-w-0 rounded-pill border px-3.5 py-2.5 font-heading text-label-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                active
                  ? "border-transparent font-semibold text-foreground"
                  : "border-border text-muted-foreground hover:border-foreground hover:text-foreground"
              }`}
            >
              <span className="relative">{chip.label}</span>
            </button>
          );
        })}
        {filter !== "all" ? (
          <Button
            variant="ghost"
            size="sm"
            className="ml-1"
            onClick={() => setFilter("all")}
          >
            Clear
          </Button>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        {filteredToNothing ? (
          <p className="text-label-sm text-muted-foreground">
            No tasks match this filter.
          </p>
        ) : null}
        <div
          className="grid min-w-0 gap-4 md:grid-cols-3"
          role="list"
          aria-label="Tasks by status"
        >
          {COLUMNS.map((column, columnPosition) => {
            const columnTasks = hasTasks
              ? visible.filter((task) => task.status === column.id)
              : [];
            const isDropTarget = dragOverStatus === column.id;
            return (
              <section
                key={column.id}
                aria-label={column.label}
                data-enter
                data-drop-target={isDropTarget ? "true" : undefined}
                style={
                  { "--motion-index": index + columnPosition } as React.CSSProperties
                }
                onDragOver={(event) => {
                  if (!draggingTask) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  if (dragOverStatus !== column.id) setDragOverStatus(column.id);
                }}
                onDragLeave={(event) => {
                  if (event.currentTarget.contains(event.relatedTarget as Node)) {
                    return;
                  }
                  setDragOverStatus((current) =>
                    current === column.id ? null : current,
                  );
                }}
                onDrop={(event) => handleDrop(event, column.id)}
                className={`flex min-w-0 flex-col gap-3 rounded-card border p-4 transition-colors backdrop-blur-md ${
                  isDropTarget
                    ? "border-foreground bg-glass-strong"
                    : "border-border bg-glass"
                }`}
              >
                <h3 className="flex items-center gap-1.5 font-mono text-label-caps uppercase text-muted-foreground">
                  <column.icon aria-hidden="true" className="size-3.5 shrink-0" />
                  {column.label}
                  {hasTasks ? (
                    <span aria-hidden="true" className="text-muted-foreground">
                      {columnTasks.length}
                    </span>
                  ) : null}
                </h3>

                {hasTasks && columnTasks.length > 0 ? (
                  <ul className="flex min-w-0 list-none flex-col gap-2.5">
                    <AnimatePresence initial={false}>
                      {columnTasks.map((task) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          dragging={draggingTask?.id === task.id}
                          focusOnMount={focusAfterMove === task.id}
                          onFocusHandled={() => setFocusAfterMove(null)}
                          onOpen={(item) => openDetail(item.id)}
                          onEdit={openEdit}
                          onDelete={requestDelete}
                          onMove={handleMove}
                          onDragStart={setDraggingTask}
                          onDragEnd={() => {
                            setDraggingTask(null);
                            setDragOverStatus(null);
                          }}
                        />
                      ))}
                    </AnimatePresence>
                  </ul>
                ) : (
                  <p className="text-label-sm text-muted-foreground">
                    {guest
                      ? "Sign in to add and track tasks here."
                      : column.empty}
                  </p>
                )}
              </section>
            );
          })}
        </div>

        {!hasTasks ? (
          <p className="text-label-sm text-muted-foreground">
            {guest
              ? "Sign in to add your first task and track it through the board."
              : "No tasks yet. Add your first task to get started."}
          </p>
        ) : (
          /* 16.9's keyboard path is real but invisible; naming it here is how
             a keyboard user learns the board is movable. */
          <p className="text-label-sm text-muted-foreground">
            Tip: focus a task and press ← or → to move it between columns.
          </p>
        )}
      </div>
    </div>
  );
}
