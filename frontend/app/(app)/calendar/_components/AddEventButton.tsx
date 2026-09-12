"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useCalendar } from "./CalendarWorkspace";

/**
 * The header's "Add event" trigger (17.9): pressing it opens the workspace's
 * create dialog, whose submit writes through `createEventAction` and inserts
 * the block into the grid on success.
 *
 * The trigger is only a trigger — the dialog, the fields, the validation and
 * the pending/error states all live in `EventFormModal`, shared with 17.10's
 * edit flow so the two verbs cannot drift apart.
 */
export function AddEventButton() {
  const { openCreate } = useCalendar();

  return (
    <Button size="sm" onClick={openCreate}>
      <Plus aria-hidden="true" className="size-4" />
      Add event
    </Button>
  );
}
