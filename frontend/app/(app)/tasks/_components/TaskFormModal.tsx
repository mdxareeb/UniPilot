"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { MotionNotice } from "@/components/motion/MotionNotice";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import {
  TASK_PRIORITY_OPTIONS,
  TASK_TITLE_MAX_LENGTH,
  type TaskItem,
} from "@/lib/data/taskValues";
import { useTasks, type TaskFormValues } from "./TasksWorkspace";

type TaskFormModalProps = {
  mode: "create" | "edit";
  open: boolean;
  /** The task being edited; null for create. */
  task: TaskItem | null;
  /**
   * Changes on every open (the workspace's session counter). Remounting the
   * body is how the form resets — no open/close effects, no state carried
   * from one dialog to the next.
   */
  formKey: number;
  onClose: () => void;
};

/**
 * The one task form (16.2/16.6 create, 16.7 edit): the same `Modal`, the same
 * fields, the same validation for both verbs — there is no second dialog
 * system, and no form copy that exists for only one of them.
 *
 * Saving is real now: submit calls the workspace's action-backed mutation,
 * which inserts or updates the card optimistically and answers with the
 * settled row or a sanitized error. The dialog shows a pending state while the
 * write is in flight (controls disabled, `aria-busy`, double-submit guarded)
 * and closes only on success; a failure keeps the form as it was and shows the
 * sanitized copy as an inline `MotionNotice`, so retry is the same button.
 *
 * Priority is the 21.7 vocabulary (none/low/medium/high); subject stays absent
 * — the schema has no subject link, so the field would be a promise with
 * nothing behind it (16.6's rule).
 */
export function TaskFormModal({
  mode,
  open,
  task,
  formKey,
  onClose,
}: TaskFormModalProps) {
  const isCreate = mode === "create";

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={isCreate ? "New task" : "Edit task"}
      description={
        isCreate
          ? "Quick add — title first, details later."
          : "Update the task and save your changes."
      }
      className="max-w-md"
    >
      <TaskFormFields
        key={formKey}
        mode={mode}
        task={task}
        onClose={onClose}
      />
    </Modal>
  );
}

function TaskFormFields({
  mode,
  task,
  onClose,
}: {
  mode: "create" | "edit";
  task: TaskItem | null;
  onClose: () => void;
}) {
  const { create, update } = useTasks();
  const [title, setTitle] = useState(task?.title ?? "");
  const [dueDate, setDueDate] = useState(task?.dueDateValue ?? "");
  const [priority, setPriority] = useState<TaskFormValues["priority"]>(
    task?.priorityValue ?? "none",
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const formId = useId();
  const isCreate = mode === "create";

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const trimmed = title.trim();
    if (trimmed === "") {
      setError("Give the task a title before saving.");
      titleRef.current?.focus();
      return;
    }
    if (trimmed.length > TASK_TITLE_MAX_LENGTH) {
      setError("Titles stay under 80 characters so they read on the board.");
      titleRef.current?.focus();
      return;
    }

    const values: TaskFormValues = {
      title: trimmed,
      dueDate: dueDate === "" ? null : dueDate,
      priority,
    };

    setPending(true);
    setError(null);

    const failure =
      mode === "create" ? await create(values) : await update(task!.id, values);

    setPending(false);
    if (failure) {
      setError(failure);
      return;
    }
    onClose();
  }

  return (
    <form
      id={formId}
      onSubmit={onSubmit}
      aria-busy={pending}
      className="flex flex-col gap-4"
      noValidate
    >
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={`${formId}-title`}
          className="text-label-sm font-medium text-foreground"
        >
          Title
        </label>
        <Input
          ref={titleRef}
          id={`${formId}-title`}
          name="title"
          type="text"
          maxLength={TASK_TITLE_MAX_LENGTH}
          placeholder="e.g. Draft OS lab report"
          autoFocus
          required
          value={title}
          disabled={pending}
          onChange={(event) => {
            setTitle(event.target.value);
            if (error !== null) setError(null);
          }}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={`${formId}-due`}
          className="text-label-sm font-medium text-foreground"
        >
          Due date <span className="text-muted-foreground">(optional)</span>
        </label>
        <Input
          id={`${formId}-due`}
          name="due"
          type="date"
          value={dueDate}
          disabled={pending}
          onChange={(event) => setDueDate(event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={`${formId}-priority`}
          className="text-label-sm font-medium text-foreground"
        >
          Priority <span className="text-muted-foreground">(optional)</span>
        </label>
        <Select
          id={`${formId}-priority`}
          name="priority"
          value={priority}
          disabled={pending}
          options={TASK_PRIORITY_OPTIONS}
          onChange={(next) => setPriority(next as TaskFormValues["priority"])}
        />
      </div>

      {error ? (
        <MotionNotice role="alert" className="text-label-sm text-destructive">
          {error}
        </MotionNotice>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={onClose}
          disabled={pending}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending
            ? isCreate
              ? "Adding…"
              : "Saving…"
            : isCreate
              ? "Add task"
              : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
