"use client";

import { useState } from "react";
import { MotionNotice } from "@/components/motion/MotionNotice";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import type { EventItem } from "@/lib/data/eventValues";
import { useCalendar } from "./CalendarWorkspace";

type EventDeleteModalProps = {
  /** The event awaiting confirmation, or null when the dialog is closed. */
  event: EventItem | null;
  /** Changes on every open; remounts the body so pending/error start fresh. */
  bodyKey: number;
  onClose: () => void;
};

/**
 * The event delete confirmation (17.10), the `SkipOnboarding` pattern: the
 * event is identified by its real title, Cancel is first, and Delete is the
 * one destructive button. Never single-click — a block only opens detail,
 * which is where this dialog is reached.
 *
 * The removal is optimistic: the block leaves the grid while the write is in
 * flight and is re-inserted at its old position if the action fails, with the
 * sanitized error shown here. There is no undo promise, because the data
 * model has no restore.
 */
export function EventDeleteModal({
  event,
  bodyKey,
  onClose,
}: EventDeleteModalProps) {
  return (
    <Modal
      open={event !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Delete this event?"
      description={
        event ? `“${event.title}” will be removed from your calendar.` : undefined
      }
      showClose={false}
      className="max-w-sm"
    >
      {event ? (
        <EventDeleteBody key={bodyKey} event={event} onClose={onClose} />
      ) : null}
    </Modal>
  );
}

function EventDeleteBody({
  event,
  onClose,
}: {
  event: EventItem;
  onClose: () => void;
}) {
  const { remove } = useCalendar();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (pending) return;
    setPending(true);
    setError(null);

    const failure = await remove(event.id);

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
          {pending ? "Deleting…" : "Delete event"}
        </Button>
      </div>
    </>
  );
}
