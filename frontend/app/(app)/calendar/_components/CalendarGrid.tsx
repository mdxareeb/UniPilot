import type { EventItem } from "@/lib/data/eventValues";
import { EventChip } from "./EventBlocks";
import { eventsForDate } from "./calendarEvents";
import type { CalendarCell } from "./calendarMath";
import { isToday, WEEKDAY_LABELS, type IsoDate } from "./calendarMath";

type CalendarGridProps = {
  /** The server's reference date, `YYYY-MM-DD`. Drives the today marker. */
  todayIso: IsoDate;
  /** The period label rendered above the grid, e.g. "August 2026". */
  label: string;
  /** 5–6 rows (month) or one row (week) of seven cells, Monday-first. */
  rows: readonly CalendarCell[][];
  /**
   * The view's rows get meaningful vertical space. Week: tall — seven days
   * spread the surface; Month: compact — 35–42 cells stay scannable. Pass a
   * class so the same cell component serves both densities without a prop
   * lattice.
   */
  cellHeightClass: string;
  /** The real events the page loaded (17.11); empty for a guest. */
  events: readonly EventItem[];
  /** Opens one event's detail (17.10). */
  onOpenEvent: (event: EventItem) => void;
};

/** More chips than this and the cell starts reading as a list, not a date. */
const MAX_CHIPS_PER_CELL = 3;

/**
 * The date grid both views render (Task 17.3), now carrying the events
 * 17.11 loads.
 *
 * Presentation only: every date arrived from `calendarGrid`'s pure
 * arithmetic and every event from the data layer's mapped contract; the
 * component holds no state, no clock, and no queries.
 *
 * Semantics (§19): a `<table>` with a real caption and one `<th>` per
 * weekday header, because that is exactly what a calendar grid is; date
 * cells carry their full ISO date in `data-date` and an
 * `aria-current="date"` marker on today, so the current day is identified by
 * semantics and shape — a filled pill — never by colour alone (§20).
 *
 * Events (§9/§30): real chips only, keyed by `data-date` and capped so a
 * busy day still reads as a date. A day with more shows an honest "+N more"
 * count — nothing fabricated, nothing silently dropped. Type is carried by
 * the chip's icon and accessible name, never by colour.
 *
 * Borders (§17): one thin outer border and hairline row/column rules — a
 * light grid, not a spreadsheet. Spillover days (previous/next month in the
 * month view) are muted rather than boxed, so the displayed month reads as
 * the figure and its neighbours as the ground.
 */
export function CalendarGrid({
  todayIso,
  label,
  rows,
  cellHeightClass,
  events,
  onOpenEvent,
}: CalendarGridProps) {
  return (
    <table className="w-full table-fixed border-collapse border border-border text-center">
      <caption className="sr-only">{label}</caption>
      <thead>
        <tr>
          {WEEKDAY_LABELS.map((weekday) => (
            <th
              key={weekday}
              scope="col"
              className="border-b border-border px-1 py-2 font-mono text-label-caps uppercase text-muted-foreground"
            >
              {/* Two letters on the narrowest screens so a 7-column grid
                  never clips at 320px; the full label from `sm` up. */}
              <span className="sm:hidden" aria-hidden="true">
                {weekday.slice(0, 2)}
              </span>
              <span className="hidden sm:inline">{weekday}</span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row[0].iso} className="border-b border-border last:border-b-0">
            {row.map((cell) => {
              const today = isToday(cell.iso, todayIso);
              const cellEvents = eventsForDate(events, cell.iso);
              const visible = cellEvents.slice(0, MAX_CHIPS_PER_CELL);
              const hidden = cellEvents.length - visible.length;

              return (
                <td
                  key={cell.iso}
                  data-date={cell.iso}
                  aria-current={today ? "date" : undefined}
                  className={`border-r border-border p-1 last:border-r-0 align-top sm:p-1.5 ${
                    cell.inPeriod ? "" : "text-muted-foreground/60"
                  }`}
                >
                  <div
                    className={`flex ${cellHeightClass} flex-col gap-1`}
                  >
                    <span
                      className={`flex size-7 items-center justify-center self-end text-label-sm sm:text-body-md ${
                        today
                          ? "rounded-pill bg-foreground font-semibold text-background"
                          : cell.inPeriod
                            ? "text-foreground"
                            : "text-muted-foreground"
                      }`}
                    >
                      {cell.day}
                    </span>
                    {visible.map((event) => (
                      <EventChip
                        key={event.id}
                        event={event}
                        onOpen={onOpenEvent}
                      />
                    ))}
                    {hidden > 0 ? (
                      <span className="px-1 text-left text-label-sm text-muted-foreground">
                        +{hidden} more
                      </span>
                    ) : null}
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
