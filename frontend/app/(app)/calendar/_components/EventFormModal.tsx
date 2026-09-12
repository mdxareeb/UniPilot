"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { MotionNotice } from "@/components/motion/MotionNotice";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import {
  EVENT_LOCATION_MAX_LENGTH,
  EVENT_TITLE_MAX_LENGTH,
  EVENT_TYPE_OPTIONS,
  type EventItem,
} from "@/lib/data/eventValues";
import type { IsoDate } from "./calendarMath";
import { eventFormValues, type EventFormValues } from "./calendarEvents";
import { useCalendar } from "./CalendarWorkspace";

type EventFormModalProps = {
  mode: "create" | "edit";
  open: boolean;
  /** The event being edited; null for create. */
  event: EventItem | null;
  /** The server's date, the create form's harmless starting day. */
  defaultDate: IsoDate;
  /**
   * Changes on every open (the workspace's session counter). Remounting the
   * body is how the form resets — no open/close effects.
   */
  formKey: number;
  onClose: () => void;
};

/**
 * The one event form (17.9 create, 17.10 edit): the same `Modal`, the same
 * fields, the same validation for both verbs — there is no second dialog
 * system.
 *
 * Saving is real: submit calls the workspace's action-backed mutation, which
 * inserts or updates the block optimistically and answers with the settled
 * row or a sanitized error. The dialog shows a pending state (controls
 * disabled, `aria-busy`, double-submit guarded) and closes only on success; a
 * failure keeps the form as it was and shows the sanitized copy inline, so
 * retry is the same button.
 *
 * `allDay` switches the native inputs between one `datetime-local` pair and
 * one `date` pair; both produce exactly the wall-clock strings the service's
 * parser accepts, and the timezone resolution stays server-side (R15).
 * Course options come from the caller's real subjects and the field is
 * absent when there are none — never an empty promise.
 */
export function EventFormModal({
  mode,
  open,
  event,
  defaultDate,
  formKey,
  onClose,
}: EventFormModalProps) {
  const isCreate = mode === "create";

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={isCreate ? "New event" : "Edit event"}
      description={
        isCreate
          ? "Add a class, exam, deadline or plain event."
          : "Update the event and save your changes."
      }
      className="max-w-md"
    >
      <EventFormFields
        key={formKey}
        mode={mode}
        event={event}
        defaultDate={defaultDate}
        onClose={onClose}
      />
    </Modal>
  );
}

function EventFormFields({
  mode,
  event,
  defaultDate,
  onClose,
}: {
  mode: "create" | "edit";
  event: EventItem | null;
  defaultDate: IsoDate;
  onClose: () => void;
}) {
  const { create, update, subjects } = useCalendar();
  const initial: EventFormValues = event
    ? eventFormValues(event)
    : {
        title: "",
        type: "none",
        allDay: false,
        startDate: defaultDate,
        startTime: "",
        endDate: "",
        endTime: "",
        location: "",
        subjectId: "",
      };
  const [title, setTitle] = useState(initial.title);
  const [type, setType] = useState(initial.type);
  const [allDay, setAllDay] = useState(initial.allDay);
  const [startDate, setStartDate] = useState(initial.startDate);
  const [startTime, setStartTime] = useState(initial.startTime);
  const [endDate, setEndDate] = useState(initial.endDate);
  const [endTime, setEndTime] = useState(initial.endTime);
  const [location, setLocation] = useState(initial.location);
  const [subjectId, setSubjectId] = useState(initial.subjectId);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const formId = useId();
  const isCreate = mode === "create";

  /** The complete wall-clock value a `datetime-local` input owns. */
  const startLocal =
    startDate !== "" && startTime !== "" ? `${startDate}T${startTime}` : "";
  const endLocal =
    endDate !== "" && endTime !== "" ? `${endDate}T${endTime}` : "";

  async function onSubmit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (pending) return;

    const trimmed = title.trim();
    if (trimmed === "") {
      setError("Give the event a title before saving.");
      titleRef.current?.focus();
      return;
    }
    if (trimmed.length > EVENT_TITLE_MAX_LENGTH) {
      setError("Titles stay under 120 characters so they read on the grid.");
      titleRef.current?.focus();
      return;
    }
    if (startDate === "" || (!allDay && startTime === "")) {
      setError(allDay ? "Pick a start date." : "Pick a start date and time.");
      return;
    }
    if (!allDay && endDate !== "" && endTime === "") {
      setError("Add an end time too, or clear the end date.");
      return;
    }
    if (allDay ? endDate !== "" && endDate < startDate : endLocal !== "" && endLocal < startLocal) {
      setError("The end can't be before the start.");
      return;
    }

    const values: EventFormValues = {
      title: trimmed,
      type,
      allDay,
      startDate,
      startTime,
      endDate,
      endTime,
      location,
      subjectId,
    };

    setPending(true);
    setError(null);

    const failure =
      mode === "create" ? await create(values) : await update(event!.id, values);

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
          maxLength={EVENT_TITLE_MAX_LENGTH}
          placeholder="e.g. Data Structures lecture"
          autoFocus
          required
          value={title}
          disabled={pending}
          onChange={(changeEvent) => {
            setTitle(changeEvent.target.value);
            if (error !== null) setError(null);
          }}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={`${formId}-type`}
          className="text-label-sm font-medium text-foreground"
        >
          Type
        </label>
        <Select
          id={`${formId}-type`}
          name="type"
          value={type}
          disabled={pending}
          onChange={(changeEvent) =>
            setType(changeEvent.target.value as EventFormValues["type"])
          }
        >
          {EVENT_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>

      {subjects.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={`${formId}-course`}
            className="text-label-sm font-medium text-foreground"
          >
            Course <span className="text-muted-foreground">(optional)</span>
          </label>
          <Select
            id={`${formId}-course`}
            name="course"
            value={subjectId}
            disabled={pending}
            onChange={(changeEvent) => setSubjectId(changeEvent.target.value)}
          >
            <option value="">No course</option>
            {subjects.map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.name}
              </option>
            ))}
          </Select>
        </div>
      ) : null}

      <label className="flex items-center gap-2 text-label-sm text-foreground">
        <input
          type="checkbox"
          name="allDay"
          checked={allDay}
          disabled={pending}
          onChange={(changeEvent) => setAllDay(changeEvent.target.checked)}
          className="size-4 rounded-xs border-border accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        />
        All day
      </label>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={`${formId}-start`}
          className="text-label-sm font-medium text-foreground"
        >
          Starts
        </label>
        <Input
          id={`${formId}-start`}
          name="start"
          type={allDay ? "date" : "datetime-local"}
          value={allDay ? startDate : startLocal}
          required
          disabled={pending}
          onChange={(changeEvent) => {
            const value = changeEvent.target.value;
            if (allDay) {
              setStartDate(value);
            } else if (value === "") {
              setStartDate("");
              setStartTime("");
            } else {
              setStartDate(value.slice(0, 10));
              setStartTime(value.slice(11, 16));
            }
          }}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={`${formId}-end`}
          className="text-label-sm font-medium text-foreground"
        >
          Ends <span className="text-muted-foreground">(optional)</span>
        </label>
        <Input
          id={`${formId}-end`}
          name="end"
          type={allDay ? "date" : "datetime-local"}
          value={allDay ? endDate : endLocal}
          disabled={pending}
          onChange={(changeEvent) => {
            const value = changeEvent.target.value;
            if (allDay) {
              setEndDate(value);
            } else if (value === "") {
              setEndDate("");
              setEndTime("");
            } else {
              setEndDate(value.slice(0, 10));
              setEndTime(value.slice(11, 16));
            }
          }}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={`${formId}-location`}
          className="text-label-sm font-medium text-foreground"
        >
          Location <span className="text-muted-foreground">(optional)</span>
        </label>
        <Input
          id={`${formId}-location`}
          name="location"
          type="text"
          maxLength={EVENT_LOCATION_MAX_LENGTH}
          placeholder="e.g. Hall B"
          value={location}
          disabled={pending}
          onChange={(changeEvent) => setLocation(changeEvent.target.value)}
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
              ? "Add event"
              : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
