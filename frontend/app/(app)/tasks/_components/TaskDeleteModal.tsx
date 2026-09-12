"use client";

import { useState } from "react";
import { MotionNotice } from "@/components/motion/MotionNotice";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import type { TaskItem } from "@/lib/data/taskValues";
import { useTasks } from "./TasksWorkspace";

type TaskDeleteModalProps = {
  /** The task awaiting confirmation, or null when the dialog is closed. */
  task: TaskItem | null;
  /** Changes on every open; remounts the body so pending/error start fresh. */
  bodyKey: number;
  onClose: () => void;
};

/**
 * The delete confirmation (16.8), the `SkipOnboarding` pattern applied to a
 * destructive action: the task is identified by its real title, Cancel is the
 * default focus, and Delete is the one destructive button in the workspace.
 *
 * Never single-click: the card's delete control only opens this dialog. The
 * removal itself is optimistic — the card leaves the board while the write is
 * in flight and is re-inserted at its old position if the action fails, with
 * the sanitized error shown here. There is no undo promise, because the data
 * model has no restore.
 */
export function TaskDeleteModal({
  task,
  bodyKey,
  onClose,
}: TaskDeleteModalProps) {
  return (
    <Modal
      open={task !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Delete this task?"
      description={
        task ? `“${task.title}” will be removed from your board.` : undefined
      }
      showClose={false}
      className="max-w-sm"
    >
      {task ? (
        <TaskDeleteBody key={bodyKey} task={task} onClose={onClose} />
      ) : null}
    </Modal>
  );
}

function TaskDeleteBody({
  task,
  onClose,
}: {
  task: TaskItem;
  onClose: () => void;
}) {
  const { remove } = useTasks();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (pending) return;
    setPending(true);
    setError(null);

    const failure = await remove(task.id);

    setPending(false);
    if (failure) {
      setError(failure);
      return;
    }
    onClose();
  }

  return (
    <>
      {error ? (
        <MotionNotice
          role="alert"
          className="mb-4 text-label-sm text-destructive"
        >
          {error}
        </MotionNotice>
      ) : null}

      {/* Staying is listed first, so the harmless action leads; the delete
          button is the only destructive fill in the product. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="primary"
          onClick={onClose}
          disabled={pending}
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="destructive"
          onClick={confirm}
          disabled={pending}
          aria-busy={pending}
        >
          {pending ? "Deleting…" : "Delete task"}
        </Button>
      </div>
    </>
  );
}
