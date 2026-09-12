"use client";

import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import {
  TASK_STATUS_LABELS,
  type TaskItem,
} from "@/lib/data/taskValues";
import type { useTasks } from "./TasksWorkspace";

type DetailStatus = ReturnType<typeof useTasks>["detail"]["status"];

type TaskDetailModalProps = {
  state: DetailStatus;
  /** The resolved task, kept in sync with the live list. */
  task: TaskItem | null;
  onClose: () => void;
  onEdit: (task: TaskItem) => void;
  onDelete: (task: TaskItem) => void;
};

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="font-mono text-label-caps uppercase text-muted-foreground">
        {label}
      </dt>
      <dd className="wrap-anywhere text-body-md text-foreground">{value}</dd>
    </div>
  );
}

/**
 * The task detail (16.10): a compact `Modal` for one task resolved by its
 * immutable `id`. The id travels in the URL (`?task=<id>`) and is resolved
 * through `getTaskAction`, so a fabricated, altered or another user's id
 * answers "Task not found" — ownership is server-side and RLS is the
 * authority, never the URL.
 *
 * Only supported fields render, in the Kanban's monochrome status treatment:
 * the title, the status word, and the same mono metadata line the card uses.
 * Edit and Delete are the real 16.7/16.8 actions; each closes this dialog and
 * opens its own, so two dialogs never stack.
 */
export function TaskDetailModal({
  state,
  task,
  onClose,
  onEdit,
  onDelete,
}: TaskDetailModalProps) {
  const found = state === "found" && task !== null;

  return (
    <Modal
      open={state !== "idle"}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={found ? task.title : "Task not found"}
      description={
        found ? TASK_STATUS_LABELS[task.status] : "That task could not be opened."
      }
      className="max-w-md"
    >
      {state === "loading" ? (
        <p className="text-label-sm text-muted-foreground">Loading task…</p>
      ) : null}

      {state === "missing" ? (
        <div className="flex flex-col gap-4">
          <p className="text-label-sm text-muted-foreground">
            It may have been deleted, or it belongs to another workspace.
          </p>
          <div className="flex justify-end">
            <Button type="button" variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      ) : null}

      {found ? (
        <div className="flex flex-col gap-5">
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Status" value={TASK_STATUS_LABELS[task.status]} />
            <Field
              label="Due"
              value={task.dueDate ?? "No due date"}
            />
            <Field label="Priority" value={task.priority ?? "No priority"} />
          </dl>

          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onEdit(task)}>
              Edit task
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => onDelete(task)}
            >
              Delete task
            </Button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
