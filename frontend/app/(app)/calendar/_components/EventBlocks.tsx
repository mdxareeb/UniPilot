"use client";

import {
  BookOpen,
  CalendarClock,
  CalendarDays,
  ClipboardCheck,
  MessageCircle,
  type LucideIcon,
} from "lucide-react";
import type { EventItem, EventType } from "@/lib/data/eventValues";
import {
  blockShowsMetadata,
  type BlockPlacement,
} from "./calendarEvents";

/** The four render treatments: the closed vocabulary plus plain events. */
type EventKind = EventType | "plain";

type KindMeta = {
  label: string;
  Icon: LucideIcon;
};

/**
 * The one place a type picks its treatment (17.5–17.7). Monochrome: the icon
 * and the accessible name carry the category, never colour alone, so the
 * legend (17.8) and the blocks cannot disagree about the vocabulary.
 */
export const EVENT_KIND_META: Record<EventKind, KindMeta> = {
  class: { label: "Class", Icon: BookOpen },
  exam: { label: "Exam", Icon: ClipboardCheck },
  deadline: { label: "Deadline", Icon: CalendarClock },
  plain: { label: "Event", Icon: CalendarDays },
};

export function eventKind(event: EventItem): EventKind {
  return event.typeValue ?? "plain";
}

/**
 * The block's (and chip's) accessible name: category, title, time or all-day,
 * the display date, and the provenance for WhatsApp-sourced events —
 * everything the visual hierarchy demotes is still spoken once, and the
 * `aria-label` override cannot swallow the sr-only marker.
 */
export function eventAccessibleName(event: EventItem): string {
  const parts = [`${EVENT_KIND_META[eventKind(event)].label}: ${event.title}`];
  const when = event.allDay ? "All day" : event.timeLabel;
  if (when) parts.push(when);
  parts.push(event.dateLabel);
  if (event.source === "whatsapp") parts.push("From WhatsApp");
  return parts.join(", ");
}

/**
 * 17.x — the provenance marker (P5.3), rendered by the block and the chip for
 * WhatsApp-sourced events only. The glyph is the generic Lucide chat bubble in
 * the inherited monochrome treatment — never the official brand mark, which
 * stays scoped to `/integrations` — and the sr-only span names the source in
 * the DOM while `eventAccessibleName` announces it through the `aria-label`.
 */
function WhatsAppMarker() {
  return (
    <>
      <MessageCircle aria-hidden="true" className="size-3 shrink-0" />
      <span className="sr-only">From WhatsApp</span>
    </>
  );
}

type BlockProps = {
  event: EventItem;
  placement: BlockPlacement;
  onOpen: (event: EventItem) => void;
};

function EventBlock({
  event,
  placement,
  onOpen,
  kind,
}: BlockProps & { kind: EventKind }) {
  const { Icon } = EVENT_KIND_META[kind];
  const showMetadata = blockShowsMetadata(event);

  return (
    <button
      type="button"
      data-event-id={event.id}
      data-source={event.source}
      data-fontprobe-role="content"
      aria-label={eventAccessibleName(event)}
      onClick={() => onOpen(event)}
      style={{
        top: `${placement.topPercent}%`,
        height: `${placement.heightPercent}%`,
      }}
      className="absolute inset-x-1 z-10 flex min-w-0 flex-col overflow-hidden rounded-base border border-border bg-glass-subtle px-1.5 py-1 text-left shadow-subtle transition-colors hover:border-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
    >
      <span className="flex min-w-0 items-center gap-1">
        <Icon
          aria-hidden="true"
          className="size-3 shrink-0 text-muted-foreground"
        />
        <span className="min-w-0 truncate text-label-sm font-medium text-foreground">
          {event.title}
        </span>
        {event.source === "whatsapp" ? <WhatsAppMarker /> : null}
      </span>
      {/* Metadata is demoted by duration: a 20-minute block keeps its title,
          a class-length block earns its line of quiet context. */}
      {showMetadata ? (
        <span className="min-w-0 truncate text-label-sm text-muted-foreground">
          {event.allDay ? "All day" : event.timeLabel}
          {event.course ? ` · ${event.course}` : ""}
        </span>
      ) : null}
    </button>
  );
}

/** 17.5 — the class block (a class turn on the week grid). */
export function ClassEventBlock(props: BlockProps) {
  return <EventBlock {...props} kind="class" />;
}

/** 17.6 — the exam block. */
export function ExamEventBlock(props: BlockProps) {
  return <EventBlock {...props} kind="exam" />;
}

/** 17.7 — the deadline block. */
export function DeadlineEventBlock(props: BlockProps) {
  return <EventBlock {...props} kind="deadline" />;
}

/** A typed event whose category is NULL — the plain fourth treatment. */
export function PlainEventBlock(props: BlockProps) {
  return <EventBlock {...props} kind="plain" />;
}

/** Dispatch: the event's type picks exactly one block, no guessing. */
export function EventBlockFor(props: BlockProps) {
  switch (props.event.typeValue) {
    case "class":
      return <ClassEventBlock {...props} />;
    case "exam":
      return <ExamEventBlock {...props} />;
    case "deadline":
      return <DeadlineEventBlock {...props} />;
    default:
      return <PlainEventBlock {...props} />;
  }
}

/** The month view's inline treatment of any type: icon + title, one line. */
export function EventChip({
  event,
  onOpen,
}: {
  event: EventItem;
  onOpen: (event: EventItem) => void;
}) {
  const { Icon } = EVENT_KIND_META[eventKind(event)];

  return (
    <button
      type="button"
      data-event-id={event.id}
      data-source={event.source}
      data-fontprobe-role="content"
      aria-label={eventAccessibleName(event)}
      onClick={() => onOpen(event)}
      className="flex w-full min-w-0 items-center gap-1 rounded-base border border-border bg-glass-subtle px-1 py-0.5 text-left transition-colors hover:border-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
    >
      <Icon
        aria-hidden="true"
        className="size-3 shrink-0 text-muted-foreground"
      />
      <span className="min-w-0 truncate text-label-sm text-foreground">
        {event.title}
      </span>
      {event.source === "whatsapp" ? <WhatsAppMarker /> : null}
    </button>
  );
}

/** The three legend entries, in the vocabulary's canonical order. */
export const EVENT_LEGEND_ITEMS: readonly EventType[] = [
  "class",
  "exam",
  "deadline",
];

/**
 * 17.8 — the legend: the same icons the blocks render, named once, so the
 * vocabulary is learnable without hovering anything. No colour key exists to
 * explain, because type is never carried by colour.
 */
export function EventLegend() {
  return (
    <ul
      aria-label="Event types"
      className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1"
    >
      {EVENT_LEGEND_ITEMS.map((type) => {
        const { label, Icon } = EVENT_KIND_META[type];
        return (
          <li key={type} className="flex items-center gap-1.5">
            <Icon
              aria-hidden="true"
              className="size-3.5 shrink-0 text-muted-foreground"
            />
            <span className="text-label-sm text-muted-foreground">{label}</span>
          </li>
        );
      })}
    </ul>
  );
}
