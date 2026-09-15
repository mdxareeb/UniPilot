"use client";

import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import type { EventItem } from "@/lib/data/eventValues";
import { eventKind, EVENT_KIND_META } from "./EventBlocks";
import type { useCalendar } from "./CalendarWorkspace";

type DetailStatus = ReturnType<typeof useCalendar>["detail"]["status"];

type EventDetailModalProps = {
  state: DetailStatus;
  /** The resolved event, kept in sync with the live list. */
  event: EventItem | null;
  onClose: () => void;
  onEdit: (event: EventItem) => void;
  onDelete: (event: EventItem) => void;
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
 * The event detail (17.10): a compact `Modal` for one event resolved by its
 * immutable `id`. The id travels in the URL (`?event=<id>`) and is resolved
 * through `getEventAction`, so a fabricated, altered or another user's id
 * answers "not found" — ownership is server-side and RLS is the authority,
 * never the URL.
 *
 * Only supported fields render, in the calendar's monochrome treatment:
 * title, type, the profile-zone when, course and location when the event
 * carries them, plus the `via WhatsApp` provenance line (P5.3) for
 * WhatsApp-sourced events. Edit and Delete are the real 17.9/17.10 actions;
 * each closes this dialog and opens its own, so two dialogs never stack.
 */
export function EventDetailModal({
  state,
  event,
  onClose,
  onEdit,
  onDelete,
}: EventDetailModalProps) {
  const found = state === "found" && event !== null;

  return (
    <Modal
      open={state !== "idle"}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={found ? event.title : "Event not found"}
      description={
        found
          ? EVENT_KIND_META[eventKind(event)].label
          : "That event could not be opened."
      }
      className="max-w-md"
    >
      {state === "loading" ? (
        <p className="text-label-sm text-muted-foreground">Loading event…</p>
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
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="When"
              value={
                event.allDay
                  ? `${event.dateLabel} · All day`
                  : `${event.dateLabel}${event.timeLabel ? ` · ${event.timeLabel}` : ""}`
              }
            />
            <Field label="Type" value={EVENT_KIND_META[eventKind(event)].label} />
            <Field label="Course" value={event.course ?? "No course"} />
            {event.location ? (
              <Field label="Location" value={event.location} />
            ) : null}
          </dl>

          {event.source === "whatsapp" ? (
            <p className="font-mono text-label-caps text-muted-foreground">
              via WhatsApp
            </p>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onEdit(event)}>
              Edit event
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => onDelete(event)}
            >
              Delete event
            </Button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
