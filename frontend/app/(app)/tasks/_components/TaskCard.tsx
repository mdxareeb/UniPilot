"use client";

import { useEffect, useRef, type DragEvent, type KeyboardEvent } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { MotionListItem } from "@/components/motion/MotionListItem";
import { IconButton } from "@/components/ui/IconButton";
import type { TaskItem, TaskUiStatus } from "@/lib/data/taskValues";

/** Status order on the board; the keyboard move path walks it. */
const PREVIOUS: Record<TaskUiStatus, TaskUiStatus | null> = {
  todo: null,
  "in-progress": "todo",
  done: "in-progress",
};
const NEXT: Record<TaskUiStatus, TaskUiStatus | null> = {
  todo: "in-progress",
  "in-progress": "done",
  done: null,
};

type TaskCardProps = {
  /** The task to present. */
  task: TaskItem;
  /** True while this card is the one being dragged. */
  dragging: boolean;
  /**
   * Focus this card's title button on mount. Set only for the instance the
   * board mounts in the destination column after a keyboard move — the
   * exiting shared-layout clone never mounts, so focus cannot land on a
   * stale copy.
   */
  focusOnMount?: boolean;
  /** Called after a `focusOnMount` focus lands, so the board clears its flag. */
  onFocusHandled?: () => void;
  onOpen: (task: TaskItem) => void;
  onEdit: (task: TaskItem) => void;
  onDelete: (task: TaskItem) => void;
  /** Move to another column (pointer drop or keyboard). */
  onMove: (task: TaskItem, status: TaskUiStatus) => void;
  onDragStart: (task: TaskItem) => void;
  onDragEnd: () => void;
};

/**
 * One task card on the Kanban board (16.5, made real by 16.11).
 *
 * The title opens the detail modal (16.10), and the two icon buttons open the
 * edit (16.7) and delete (16.8) dialogs; nothing on the card mutates a task by
 * itself. The card is also the drag source for 16.9: the pointer path uses the
 * native drag events, and the keyboard path is ArrowLeft/ArrowRight on any
 * focused control inside the card, walking the columns' order. Both call the
 * same `onMove`, so the two paths cannot disagree.
 *
 * The metadata line is unchanged from 16.5 — mono, uppercase, quiet, each
 * field printed only when the task carries it. Priority is a word, never a
 * coloured badge. `subject` is still absent because the schema has no subject
 * link to fill it (16.6's rule), not because the card cannot render it.
 *
 * Motion is the shared system: the card is a `MotionListItem` with `layout`,
 * so insertions, removals and the reflow around them animate instead of
 * jumping, and a status move reads as the card leaving one column and arriving
 * in the next through the shared list variants. (A `layoutId` shared across
 * the two columns was tried for a travelling card and produced two live nodes
 * for one id mid-move — a duplicate in the DOM and in the accessibility tree —
 * so the move stays a clean unmount/mount.) Reduced motion lands instantly
 * through the shared provider.
 */
export function TaskCard({
  task,
  dragging,
  focusOnMount = false,
  onFocusHandled,
  onOpen,
  onEdit,
  onDelete,
  onMove,
  onDragStart,
  onDragEnd,
}: TaskCardProps) {
  const titleRef = useRef<HTMLButtonElement>(null);

  /* Keyboard focus follows the card to its new column by focusing the fresh
     instance as it mounts. Querying the DOM after the move instead can catch
     Motion's exiting shared-layout clone of the same `layoutId` — a hidden
     copy the user cannot tab to — which is what made the follow flaky under
     load. The exiting clone never re-renders with this prop, so only the
     settled card takes focus. */
  useEffect(() => {
    if (!focusOnMount) return;
    titleRef.current?.focus();
    onFocusHandled?.();
  }, [focusOnMount, onFocusHandled]);

  const meta = [task.subject, task.dueDate, task.priority].filter(
    (value): value is string => Boolean(value),
  );

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const next =
      event.key === "ArrowLeft" ? PREVIOUS[task.status] : NEXT[task.status];
    if (next === null) return;
    event.preventDefault();
    onMove(task, next);
  }

  function onDragStartInternal(event: DragEvent<HTMLDivElement>) {
    event.dataTransfer.effectAllowed = "move";
    // The id is the payload; some browsers require some data set for a drag to
    // start, so it doubles as the fallback when the board reads the drop.
    event.dataTransfer.setData("text/plain", task.id);
    onDragStart(task);
  }

  return (
    <MotionListItem
      as="li"
      data-task-id={task.id}
      className={`min-w-0 rounded-base border border-border bg-glass-subtle p-3.5 transition-opacity${
        dragging ? " opacity-60" : ""
      }`}
    >
      {/* The drag source is the card's content wrapper, not the layout
          element itself: `MotionListItem` types its props as plain HTML
          attributes and deliberately drops Motion's own drag handlers, so the
          native DnD handlers live here where React's types apply. */}
      <div
        draggable
        data-dragging={dragging ? "true" : undefined}
        onDragStart={onDragStartInternal}
        onDragEnd={onDragEnd}
        onKeyDown={onKeyDown}
        className="min-w-0"
      >
        <div className="flex min-w-0 items-start justify-between gap-2">
          <button
            ref={titleRef}
            type="button"
            data-card-focus
            data-fontprobe-role="content"
            onClick={() => onOpen(task)}
            aria-label={`Open details for ${task.title}`}
            className="min-w-0 flex-1 rounded-base text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
          >
            <span className="wrap-anywhere text-body-md font-medium text-foreground">
              {task.title}
            </span>
          </button>
          <div className="flex shrink-0 items-center gap-0.5">
            <IconButton
              size="sm"
              aria-label={`Edit ${task.title}`}
              onClick={() => onEdit(task)}
            >
              <Pencil aria-hidden="true" className="size-3.5" />
            </IconButton>
            <IconButton
              size="sm"
              aria-label={`Delete ${task.title}`}
              onClick={() => onDelete(task)}
            >
              <Trash2 aria-hidden="true" className="size-3.5" />
            </IconButton>
          </div>
        </div>

        {meta.length > 0 ? (
          <p className="mt-1.5 flex min-w-0 flex-wrap items-baseline gap-x-2 font-mono text-label-caps uppercase text-muted-foreground">
            {meta.map((value) => (
              <span key={value} className="shrink-0">
                {value}
              </span>
            ))}
          </p>
        ) : null}
      </div>
    </MotionListItem>
  );
}
