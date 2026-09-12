import type { EventItem } from "@/lib/data/eventValues";
import { EventBlockFor, EventChip } from "./EventBlocks";
import {
  allDayEventsForDate,
  eventsForDate,
  timedPlacement,
} from "./calendarEvents";
import { isToday, WEEKDAY_LABELS, type CalendarCell, type IsoDate } from "./calendarMath";
import { hourLabels } from "./calendarTime";

type WeekGridProps = {
  /** The server's reference date, `YYYY-MM-DD`. Drives the today marker. */
  todayIso: IsoDate;
  /** The period label rendered above the grid, e.g. "August 2026". */
  label: string;
  /** The week's seven day cells, Monday-first. */
  days: readonly CalendarCell[];
  /** The real events the page loaded (17.11); empty for a guest. */
  events: readonly EventItem[];
  /** Opens one event's detail (17.10). */
  onOpenEvent: (event: EventItem) => void;
};

/** The hour-row height: enough air for a real event block, short enough
 *  that 24 rows keep the week scannable. One class, both structures. */
const HOUR_ROW_CLASS = "h-14 md:h-16";

/**
 * The week view's time-structured grid (Task 17.4), now positioned against
 * the real events 17.11 loads.
 *
 * Alignment is the whole design (§8): the gutter and the seven day columns
 * are ONE table sharing ONE row rhythm — each hour is a single `<tr>`
 * containing the time `<th>` and seven day `<td>`s, so a label cannot drift
 * from its rows the way two side-by-side lists inevitably would. The
 * weekday header spans the same eight columns, so the day columns keep one
 * width from header to last row (§12).
 *
 * Events (17.5 §11): a timed event renders inside the hour cell its start
 * falls in, absolutely positioned by `top`/`height` percentages computed
 * from the profile-zone `HH:mm` values — minute precision, multi-hour
 * blocks spilling into the following rows. All-day events ride in the day
 * header's chip band, where a day-shaped thing belongs. Multi-day timed
 * events anchor to their start day; their other days carry the month view's
 * chip, the documented single-column fallback until the design defines
 * overlap and span layouts (§11). Nothing is placed by client time: the
 * server mapped every value in the profile's zone (17.14's UI half).
 *
 * Overlap: without a design for side-by-side blocks, two events starting in
 * the same hour/day render in the same column, in reading order — the
 * documented fallback, not an invented layout.
 */
export function WeekGrid({
  todayIso,
  label,
  days,
  events,
  onOpenEvent,
}: WeekGridProps) {
  const hours = hourLabels();

  return (
    <table className="w-full table-fixed border-collapse border border-border text-center">
      <caption className="sr-only">{label}</caption>
      <thead>
        <tr>
          {/* The gutter's own header: a quiet, screen-reader-only "Time" —
              the visual grid explains itself, the tree still needs the
              corner named. */}
          <th scope="col" className="sr-only">
            Time
          </th>
          {days.map((day) => {
            const today = isToday(day.iso, todayIso);
            const weekday = WEEKDAY_LABELS[days.indexOf(day)];
            const allDay = allDayEventsForDate(events, day.iso);
            return (
              <th
                key={day.iso}
                scope="col"
                data-date={day.iso}
                aria-current={today ? "date" : undefined}
                className="border-b border-border px-1 py-2 align-top"
              >
                <span className="flex flex-col items-center gap-1">
                  <span className="font-mono text-label-caps uppercase text-muted-foreground">
                    <span className="sm:hidden" aria-hidden="true">
                      {weekday.slice(0, 2)}
                    </span>
                    <span className="hidden sm:inline">{weekday}</span>
                  </span>
                  <span
                    className={`flex size-7 items-center justify-center text-label-sm sm:text-body-md ${
                      today
                        ? "rounded-pill bg-foreground font-semibold text-background"
                        : "text-foreground"
                    }`}
                  >
                    {day.day}
                  </span>
                  {allDay.length > 0 ? (
                    <span className="flex w-full min-w-0 flex-col gap-0.5">
                      {allDay.map((event) => (
                        <EventChip
                          key={event.id}
                          event={event}
                          onOpen={onOpenEvent}
                        />
                      ))}
                    </span>
                  ) : null}
                </span>
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {hours.map(({ hour, label: hourLabel }) => (
          <tr key={hour} className="border-b border-border last:border-b-0">
            <th
              scope="row"
              className={`w-14 border-r border-border pr-1.5 text-right align-top sm:w-16 ${HOUR_ROW_CLASS}`}
            >
              <span className="font-mono text-label-caps text-muted-foreground">
                {hourLabel}
              </span>
            </th>
            {days.map((day) => {
              const starting = eventsForDate(events, day.iso).filter(
                (event) => timedPlacement(event)?.hour === hour,
              );
              return (
                <td
                  key={`${day.iso}-${hour}`}
                  data-date={day.iso}
                  data-hour={hour}
                  className="border-r border-border last:border-r-0"
                >
                  {/* The hour slot: relative so a block can be positioned
                      inside it by (data-date, data-hour) and minute offset,
                      spilling into later rows by height. */}
                  <div className={`relative ${HOUR_ROW_CLASS}`}>
                    {starting.map((event) => {
                      const placement = timedPlacement(event);
                      if (placement === null) return null;
                      return (
                        <EventBlockFor
                          key={event.id}
                          event={event}
                          placement={placement}
                          onOpen={onOpenEvent}
                        />
                      );
                    })}
                  </div>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
