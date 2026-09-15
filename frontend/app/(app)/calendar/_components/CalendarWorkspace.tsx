"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { CalendarDays, CalendarRange, type LucideIcon } from "lucide-react";
import { useSignInPrompt } from "@/components/auth/SignInPromptProvider";
import { softSpring, stepVariants } from "@/components/motion/presets";
import {
  createEventAction,
  deleteEventAction,
  getEventAction,
  updateEventAction,
} from "@/lib/data/eventActions";
import { EVENT_DELETE_ERROR, EVENT_SAVE_ERROR } from "@/lib/data/eventErrors";
import { eventItemFromLocal, type EventItem } from "@/lib/data/eventValues";
import type { SubjectOption } from "@/lib/data/subjects";
import { CalendarGrid } from "./CalendarGrid";
import { EventLegend } from "./EventBlocks";
import { EventDeleteModal } from "./EventDeleteModal";
import { EventDetailModal } from "./EventDetailModal";
import { EventFormModal } from "./EventFormModal";
import { WeekGrid } from "./WeekGrid";
import {
  monthGrid,
  periodLabel,
  weekGrid,
  type IsoDate,
} from "./calendarMath";
import { toEventDraftLocal, type EventFormValues } from "./calendarEvents";

type DetailState =
  | { status: "idle"; event: null }
  | { status: "loading"; event: null }
  | { status: "found"; event: EventItem }
  | { status: "missing"; event: null };

type CalendarContextValue = {
  events: EventItem[];
  /** The caller's subjects, for the form's course control. */
  subjects: SubjectOption[];
  /** True for the guest render: the grid is real, every action prompts. */
  guest: boolean;
  openCreate: () => void;
  openEdit: (event: EventItem) => void;
  requestDelete: (event: EventItem) => void;
  openDetail: (eventId: string) => void;
  /** All resolve to the sanitized error, or null on success. */
  create: (values: EventFormValues) => Promise<string | null>;
  update: (id: string, values: EventFormValues) => Promise<string | null>;
  remove: (id: string) => Promise<string | null>;
  detail: {
    id: string | null;
    status: DetailState["status"];
    event: EventItem | null;
  };
  closeDetail: () => void;
};

const CalendarContext = createContext<CalendarContextValue | null>(null);

export function useCalendar(): CalendarContextValue {
  const value = useContext(CalendarContext);
  if (!value) {
    throw new Error("useCalendar must be used inside CalendarWorkspace.");
  }
  return value;
}

/**
 * The client work order, mirroring `listEvents`: soonest start first, id as
 * the tiebreak, with optimistic rows keeping their local position until the
 * settled row replaces them.
 */
function sortEvents(list: EventItem[]): EventItem[] {
  return list
    .map((event, index) => ({ event, index }))
    .sort((a, b) => {
      if (a.event.startAt !== b.event.startAt) {
        return a.event.startAt < b.event.startAt ? -1 : 1;
      }
      if (a.event.id !== b.event.id) {
        return a.event.id < b.event.id ? -1 : 1;
      }
      return a.index - b.index;
    })
    .map((entry) => entry.event);
}

function onOptimisticResult(result: {
  error: string | null;
  event: EventItem | null;
}): string | null {
  return result.error ?? (result.event ? null : EVENT_SAVE_ERROR);
}

/**
 * The calendar workspace (17.11 binding + 17.5–17.10): the client boundary
 * that owns the events the server page loaded and every mutation the grids
 * perform.
 *
 * The page stays the server owner of access and data (`getWorkspaceAccess` →
 * `listEventsForDates` in the profile's zone) and passes the initial list
 * here. Every mutation applies its change locally first, calls the existing
 * Server Action, then reconciles with the settled row or rolls the snapshot
 * back and surfaces the sanitized error — the same optimistic contract 16.11
 * established for tasks, sharing the one `eventItemFromLocal` mapping so a
 * pending block carries the values the settled row will.
 *
 * For a guest the list is empty, the detail resolver is skipped (no Server
 * Action runs on `?event=`), and every entry point calls `requireAuth` first
 * and opens the skippable sign-in prompt. The grid itself is the real grid:
 * genuine dates, real event data when it exists, nothing fabricated.
 *
 * The header and the surface are the page's children, rendered inside this
 * provider so the "Add event" trigger opens the same dialog stack the blocks
 * do. All dialogs are the shared `Modal` primitive.
 */
export function CalendarWorkspace({
  initialEvents,
  subjects,
  timeZone,
  todayIso,
  guest,
  children,
}: {
  initialEvents: EventItem[];
  subjects: SubjectOption[];
  /** The profile's IANA zone, server-read; used only to map optimistic rows. */
  timeZone: string;
  /** The create form's harmless default day, never a fabricated event. */
  todayIso: IsoDate;
  guest: boolean;
  children: ReactNode;
}) {
  const { openPrompt, requireAuth } = useSignInPrompt();
  const guard = useCallback(
    (reason: string): boolean => {
      if (guest) {
        openPrompt(reason);
        return false;
      }
      return requireAuth(reason);
    },
    [guest, openPrompt, requireAuth],
  );

  const [events, setEvents] = useState<EventItem[]>(() => sortEvents(initialEvents));
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<EventItem | null>(null);
  const [deleting, setDeleting] = useState<EventItem | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [deleteKey, setDeleteKey] = useState(0);

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const detailId = searchParams.get("event");
  const [resolvedDetail, setResolvedDetail] = useState<{
    id: string;
    state: DetailState;
  } | null>(null);

  /* 17.10: the detail modal is URL-driven (`?event=<id>`) and resolves the id
     through the Server Action, so a fabricated, altered or foreign id answers
     "not found" — ownership is the server's, never the URL's. A guest never
     resolves: that is what keeps the guest render free of any data read. */
  useEffect(() => {
    if (guest || !detailId) return;

    let cancelled = false;

    getEventAction(detailId)
      .then((result) => {
        if (cancelled) return;
        setResolvedDetail({
          id: detailId,
          state: result.event
            ? { status: "found", event: result.event }
            : { status: "missing", event: null },
        });
      })
      .catch(() => {
        if (!cancelled) {
          setResolvedDetail({
            id: detailId,
            state: { status: "missing", event: null },
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [detailId, guest]);

  const detail: DetailState =
    guest || detailId === null
      ? { status: "idle", event: null }
      : resolvedDetail?.id === detailId
        ? resolvedDetail.state
        : { status: "loading", event: null };

  const openCreate = useCallback(() => {
    if (!guard("Sign in to add events to your calendar.")) return;
    setFormKey((key) => key + 1);
    setCreateOpen(true);
  }, [guard]);

  const openEdit = useCallback(
    (event: EventItem) => {
      if (!guard("Sign in to edit your events.")) return;
      setFormKey((key) => key + 1);
      setEditing(event);
    },
    [guard],
  );

  const requestDelete = useCallback(
    (event: EventItem) => {
      if (!guard("Sign in to delete your events.")) return;
      setDeleteKey((key) => key + 1);
      setDeleting(event);
    },
    [guard],
  );

  const courseFor = useCallback(
    (subjectId: string | null): string | undefined =>
      subjectId === null
        ? undefined
        : subjects.find((subject) => subject.id === subjectId)?.name,
    [subjects],
  );

  const create = useCallback(
    async (values: EventFormValues): Promise<string | null> => {
      if (!guard("Sign in to add events to your calendar.")) return null;

      const tempId = `pending-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      const local = toEventDraftLocal(values);
      const course = courseFor(local.subjectId);

      let optimistic: EventItem | null = null;
      try {
        optimistic = eventItemFromLocal(tempId, local, timeZone, course);
      } catch {
        optimistic = null;
      }
      if (optimistic) {
        const insert = optimistic;
        setEvents((prev) => sortEvents([...prev, insert]));
      }

      let result: Awaited<ReturnType<typeof createEventAction>>;
      try {
        result = await createEventAction(local);
      } catch {
        result = { error: EVENT_SAVE_ERROR, event: null };
      }

      const failure = onOptimisticResult(result);
      if (failure) {
        setEvents((prev) => prev.filter((event) => event.id !== tempId));
        return failure;
      }

      setEvents((prev) =>
        sortEvents([
          ...prev.filter((event) => event.id !== tempId),
          result.event!,
        ]),
      );
      return null;
    },
    [guard, courseFor, timeZone],
  );

  const update = useCallback(
    async (id: string, values: EventFormValues): Promise<string | null> => {
      if (!guard("Sign in to edit your events.")) return null;

      const previous = events.find((event) => event.id === id);
      if (!previous) return EVENT_SAVE_ERROR;

      const local = toEventDraftLocal(values);
      const course = courseFor(local.subjectId);

      let optimistic: EventItem | null = null;
      try {
        optimistic = eventItemFromLocal(id, local, timeZone, course);
      } catch {
        optimistic = null;
      }
      if (optimistic) {
        const next = optimistic;
        setEvents((prev) =>
          sortEvents(prev.map((event) => (event.id === id ? next : event))),
        );
      }

      let result: Awaited<ReturnType<typeof updateEventAction>>;
      try {
        result = await updateEventAction(id, local);
      } catch {
        result = { error: EVENT_SAVE_ERROR, event: null };
      }

      const failure = onOptimisticResult(result);
      if (failure) {
        setEvents((prev) =>
          sortEvents(prev.map((event) => (event.id === id ? previous : event))),
        );
        return failure;
      }

      setEvents((prev) =>
        sortEvents(
          prev.map((event) => (event.id === id ? result.event! : event)),
        ),
      );
      return null;
    },
    [events, guard, courseFor, timeZone],
  );

  const remove = useCallback(
    async (id: string): Promise<string | null> => {
      if (!guard("Sign in to delete your events.")) return null;

      const index = events.findIndex((event) => event.id === id);
      if (index === -1) return EVENT_DELETE_ERROR;
      const previous = events[index];

      setEvents((prev) => prev.filter((event) => event.id !== id));

      let result: Awaited<ReturnType<typeof deleteEventAction>>;
      try {
        result = await deleteEventAction(id);
      } catch {
        result = { error: EVENT_DELETE_ERROR };
      }

      if (result.error) {
        setEvents((prev) => {
          const next = [...prev];
          next.splice(Math.min(index, next.length), 0, previous);
          return sortEvents(next);
        });
        return result.error;
      }
      return null;
    },
    [events, guard],
  );

  const openDetail = useCallback(
    (eventId: string) => {
      router.push(`${pathname}?event=${eventId}`, { scroll: false });
    },
    [pathname, router],
  );

  const closeDetail = useCallback(() => {
    router.replace(pathname, { scroll: false });
  }, [pathname, router]);

  /* Prefer the live item so an edit made from the detail modal is reflected
     immediately; fall back to the resolved snapshot. */
  const detailEvent = useMemo(() => {
    if (!detail.event) return null;
    return events.find((event) => event.id === detail.event!.id) ?? detail.event;
  }, [detail.event, events]);

  const value = useMemo<CalendarContextValue>(
    () => ({
      events,
      subjects,
      guest,
      openCreate,
      openEdit,
      requestDelete,
      openDetail,
      create,
      update,
      remove,
      detail: { id: detailId, status: detail.status, event: detailEvent },
      closeDetail,
    }),
    [
      events,
      subjects,
      guest,
      openCreate,
      openEdit,
      requestDelete,
      openDetail,
      create,
      update,
      remove,
      detailId,
      detail.status,
      detailEvent,
      closeDetail,
    ],
  );

  return (
    <CalendarContext.Provider value={value}>
      {children}

      <EventFormModal
        mode="create"
        open={createOpen}
        event={null}
        defaultDate={todayIso}
        formKey={formKey}
        onClose={() => setCreateOpen(false)}
      />
      <EventFormModal
        mode="edit"
        open={editing !== null}
        event={editing}
        defaultDate={todayIso}
        formKey={formKey}
        onClose={() => setEditing(null)}
      />
      <EventDeleteModal
        event={deleting}
        bodyKey={deleteKey}
        onClose={() => setDeleting(null)}
      />
      <EventDetailModal
        state={detail.status}
        event={detailEvent}
        onClose={closeDetail}
        onEdit={(event) => {
          closeDetail();
          openEdit(event);
        }}
        onDelete={(event) => {
          closeDetail();
          requestDelete(event);
        }}
      />
    </CalendarContext.Provider>
  );
}

/**
 * The two calendar views the approved architecture carries (17.2 §2) —
 * exactly two, no day/agenda/year variants to drift into.
 */
type CalendarView = "week" | "month";

const VIEWS: readonly { id: CalendarView; label: string; icon: LucideIcon }[] = [
  { id: "week", label: "Week", icon: CalendarRange },
  { id: "month", label: "Month", icon: CalendarDays },
];

/**
 * The calendar surface: the Week/Month control (17.2), the legend (17.8) and
 * the real grid the view selects (17.3), now carrying the events 17.11
 * loaded. Consumes the workspace context — it holds only the view state, so
 * a mutation never resets the view or the range.
 *
 * Motion is unchanged from 17.2: the shared-layout traveling indicator
 * (`softSpring`), the view swap through `stepVariants` inside
 * `AnimatePresence`, and the surface on the page ladder's `data-enter` slot.
 * Reduced motion zeroes these transforms through the global MotionConfig.
 */
export function CalendarSurface({
  index,
  todayIso,
}: {
  index: number;
  todayIso: IsoDate;
}) {
  const { events, guest, openDetail } = useCalendar();
  const [view, setView] = useState<CalendarView>("month");

  const rows = view === "month" ? monthGrid(todayIso) : weekGrid(todayIso);
  const label = periodLabel(todayIso);

  return (
    <div
      data-enter="scale"
      style={{ "--motion-index": index } as CSSProperties}
      className="flex min-w-0 flex-col gap-4"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div
          role="group"
          aria-label="Calendar view"
          className="flex min-w-0 flex-wrap items-center gap-1.5"
        >
          {VIEWS.map((option) => {
            const selected = view === option.id;
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={selected}
                onClick={() => setView(option.id)}
                className={`relative min-w-0 rounded-pill border px-3.5 py-2.5 font-heading text-label-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                  selected
                    ? "border-transparent font-semibold text-foreground"
                    : "border-border text-muted-foreground hover:border-foreground hover:text-foreground"
                }`}
              >
                {selected ? (
                  <motion.span
                    aria-hidden="true"
                    layoutId="calendar-view-active"
                    transition={softSpring}
                    className="pointer-events-none absolute inset-0 rounded-pill bg-card shadow-subtle"
                  />
                ) : null}
                <span className="relative flex items-center gap-1.5">
                  <option.icon
                    aria-hidden="true"
                    className="size-3.5 shrink-0"
                  />
                  {option.label}
                </span>
              </button>
            );
          })}
        </div>

        <EventLegend />
      </div>

      {/* The real grid, keyed by view so AnimatePresence treats each view
          as its own surface. Week renders the time-structured `WeekGrid`;
          month keeps 17.3's `CalendarGrid` — no gutter there, by design. */}
      <div className="flex min-w-0 flex-col gap-2 rounded-card border border-border bg-glass p-3 backdrop-blur-md sm:p-4">
        <AnimatePresence initial={false} mode="wait">
          <motion.div
            key={view}
            initial="hidden"
            animate="visible"
            exit="hidden"
            variants={stepVariants(view === "month" ? 1 : -1)}
            transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
          >
            {view === "month" ? (
              <CalendarGrid
                todayIso={todayIso}
                label={`${label} — month view`}
                rows={rows}
                cellHeightClass="min-h-16 md:min-h-24"
                events={events}
                onOpenEvent={(event) => openDetail(event.id)}
              />
            ) : (
              <WeekGrid
                todayIso={todayIso}
                label={`${label} — week view`}
                days={rows[0]}
                events={events}
                onOpenEvent={(event) => openDetail(event.id)}
              />
            )}
          </motion.div>
        </AnimatePresence>
        {/* Honest empty copy only while the calendar is actually empty. */}
        {guest ? (
          <p className="text-label-sm text-muted-foreground">
            Sign in to add classes, exams and deadlines to your calendar.
          </p>
        ) : events.length === 0 ? (
          <p className="text-label-sm text-muted-foreground">
            No classes, exams or deadlines yet — add one to get started.
          </p>
        ) : null}
      </div>
    </div>
  );
}
