"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useTasks } from "./TasksWorkspace";

/**
 * The header's "New task" trigger (16.2), now the real thing: pressing it
 * opens the workspace's create dialog, whose submit writes through
 * `createTaskAction` and inserts the card into the board on success.
 *
 * The trigger is only a trigger — the dialog, the fields, the validation and
 * the pending/error states all live in `TaskFormModal`, shared with 16.7's
 * edit flow so the two verbs cannot drift apart.
 */
export function QuickAddTask() {
  const { openCreate } = useTasks();

  return (
    <Button size="sm" onClick={openCreate}>
      <Plus aria-hidden="true" className="size-4" />
      New task
    </Button>
  );
}
