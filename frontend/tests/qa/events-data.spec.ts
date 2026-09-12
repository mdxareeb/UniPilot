/**
 * tests/qa/events-data.spec.ts — Task 22.x's events data proof.
 *
 * Two halves, matching the two halves of the service:
 *
 * 1. The pure modules the service is built on — `lib/data/eventValues.ts`
 *    (vocabulary, validation, local→instant resolution, row → calendar
 *    mapping) and the event additions to `lib/data/taskDates.ts` (wall-clock
 *    ↔ instant, DST edges, time formatting). They import no server-only code,
 *    so this Chromium-suite runner exercises the exact functions the Server
 *    Actions call.
 *
 * 2. The RLS/schema operations the server-only service wraps, with two REAL
 *    users (QA1/QA2): own reads and writes, cross-user reads empty and
 *    cross-user writes affecting zero rows, the range window returning only
 *    overlapping rows, the CHECK constraints and the same-user subject trigger
 *    rejecting bad input, and an id-scoped teardown that leaves no residue.
 *
 * Local-only by construction (the guard below refuses any non-loopback
 * target); hosted is never contacted.
 */
import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  eventRowToItem,
  parseEventDraft,
  resolveEventDraft,
  type EventDraftLocal,
} from "../../lib/data/eventValues";
import {
  formatEventTime,
  instantToZonedLocalDateTime,
  zonedLocalDateTimeToInstant,
} from "../../lib/data/taskDates";

const LOCAL_TARGET = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const qa1Password = process.env.UNIPILOT_QA_PASSWORD ?? "";
const qa2Password = process.env.UNIPILOT_QA2_PASSWORD ?? "";

const QA1 = "qa.unipilot@unipilot.test";
const QA2 = "qa2.unipilot@unipilot.test";

/** The half-open window the range test queries. */
const WINDOW_START = "2026-10-01T00:00:00.000Z";
const WINDOW_END = "2026-10-08T00:00:00.000Z";

type Result = { data: unknown; error: { message: string } | null };

async function expectAllowed(promise: PromiseLike<Result>, message: string) {
  const { data, error } = await promise;
  expect(error, `${message}: ${error?.message}`).toBeNull();
  return data;
}

async function affectedRows(
  promise: PromiseLike<Result>,
  message: string,
): Promise<number> {
  const data = await expectAllowed(promise, message);
  return ((data as { id: string }[] | null) ?? []).length;
}

test.describe("events data (22.x)", () => {
  test("pure validation, timezone resolution and display mapping", () => {
    /* ---- 22.3/22.4 parse: shapes, vocabulary, ordering -------------------- */
    expect(
      parseEventDraft({
        title: "  Algorithms lecture  ",
        type: "class",
        startAt: "2026-09-02T09:00",
        endAt: "2026-09-02T10:30",
        location: "  Room 4  ",
        subjectId: "22222222-2222-4222-8222-222222222222",
      }),
    ).toEqual({
      title: "Algorithms lecture",
      type: "class",
      startAt: "2026-09-02T09:00",
      endAt: "2026-09-02T10:30",
      allDay: false,
      location: "Room 4",
      description: null,
      subjectId: "22222222-2222-4222-8222-222222222222",
    });

    expect(parseEventDraft({ title: "   ", startAt: "2026-09-02T09:00" })).toBeNull();
    expect(
      parseEventDraft({ title: "x".repeat(121), startAt: "2026-09-02T09:00" }),
    ).toBeNull();
    expect(
      parseEventDraft({ title: "ok", startAt: "2026-09-02T09:00", type: "lecture" }),
    ).toBeNull();
    expect(
      parseEventDraft({ title: "ok", startAt: "2026-09-02T09:00", type: "none" }),
    ).toMatchObject({ type: null });
    // 2026-02-30 is not a real date.
    expect(
      parseEventDraft({ title: "ok", startAt: "2026-02-30T09:00" }),
    ).toBeNull();
    // A timed event needs a time; an all-day event must not carry one.
    expect(parseEventDraft({ title: "ok", startAt: "2026-09-02" })).toBeNull();
    expect(
      parseEventDraft({ title: "ok", startAt: "2026-09-02T09:00", allDay: true }),
    ).toBeNull();
    expect(
      parseEventDraft({
        title: "ok",
        startAt: "2026-09-02T10:00",
        endAt: "2026-09-02T09:00",
      }),
    ).toBeNull();
    expect(
      parseEventDraft({
        title: "ok",
        startAt: "2026-09-04",
        endAt: "2026-09-02",
        allDay: true,
      }),
    ).toBeNull();
    expect(
      parseEventDraft({ title: "ok", startAt: "2026-09-02T09:00", subjectId: "not-a-uuid" }),
    ).toBeNull();
    expect(
      parseEventDraft({ title: "ok", startAt: "2026-09-02", allDay: "yes" }),
    ).toBeNull();

    /* ---- 22.x resolve: local wall clock → UTC instants (R15) -------------- */
    const timed: EventDraftLocal = {
      title: "Algorithms lecture",
      type: "class",
      startAt: "2026-09-02T09:00",
      endAt: "2026-09-02T10:30",
      allDay: false,
      location: null,
      description: null,
      subjectId: null,
    };
    expect(resolveEventDraft(timed, "America/New_York")).toMatchObject({
      startAt: "2026-09-02T13:00:00.000Z", // 09:00 EDT
      endAt: "2026-09-02T14:30:00.000Z",
    });
    expect(resolveEventDraft(timed, "Pacific/Kiritimati")).toMatchObject({
      startAt: "2026-09-01T19:00:00.000Z", // 09:00 +14 crosses back a UTC day
    });

    // All-day: a half-open whole-day span in the profile's zone.
    const allDay = resolveEventDraft(
      { ...timed, type: null, startAt: "2026-09-02", endAt: null, allDay: true },
      "America/New_York",
    );
    expect(allDay).toMatchObject({
      startAt: "2026-09-02T04:00:00.000Z",
      endAt: "2026-09-03T04:00:00.000Z",
    });
    const multiDay = resolveEventDraft(
      { ...timed, type: null, startAt: "2026-09-02", endAt: "2026-09-04", allDay: true },
      "America/New_York",
    );
    expect(multiDay).toMatchObject({
      endAt: "2026-09-05T04:00:00.000Z",
    });

    // DST edges. 02:30 does not exist on New York's spring-forward night, so
    // the value resolves forward past the gap (03:30 EDT) rather than back an
    // hour; an ordinary time round-trips exactly, and the fall-back hour
    // picks its first occurrence.
    const spring = zonedLocalDateTimeToInstant(
      "2026-03-08T02:30",
      "America/New_York",
    );
    expect(spring).toBe("2026-03-08T07:30:00.000Z"); // 03:30 EDT
    expect(instantToZonedLocalDateTime(spring, "America/New_York")).toBe(
      "2026-03-08T03:30",
    );
    expect(
      instantToZonedLocalDateTime(
        zonedLocalDateTimeToInstant("2026-09-02T09:00", "America/New_York"),
        "America/New_York",
      ),
    ).toBe("2026-09-02T09:00");
    const fall = zonedLocalDateTimeToInstant(
      "2026-11-01T01:30",
      "America/New_York",
    );
    expect(instantToZonedLocalDateTime(fall, "America/New_York")).toBe(
      "2026-11-01T01:30",
    );
    expect(formatEventTime(fall, "America/New_York")).toBe("1:30 AM");

    /* ---- 22.2 mapping: row → the calendar contract ------------------------ */
    expect(
      eventRowToItem(
        {
          id: "11111111-1111-4111-8111-111111111111",
          title: "Algorithms lecture",
          type: "class",
          description: "Chapter 4",
          location: "Room 4",
          start_at: "2026-09-02T13:00:00.000Z",
          end_at: "2026-09-02T14:30:00.000Z",
          all_day: false,
          subject_id: "22222222-2222-4222-8222-222222222222",
          subjects: { name: "Algorithms" },
        },
        "America/New_York",
      ),
    ).toEqual({
      id: "11111111-1111-4111-8111-111111111111",
      title: "Algorithms lecture",
      typeValue: "class",
      typeLabel: "Class",
      startAt: "2026-09-02T13:00:00.000Z",
      endAt: "2026-09-02T14:30:00.000Z",
      allDay: false,
      startDate: "2026-09-02",
      endDateValue: "2026-09-02",
      startTime: "09:00",
      endTime: "10:30",
      durationMinutes: 90,
      dateLabel: "Wed, Sep 2",
      timeLabel: "9:00 AM – 10:30 AM",
      course: "Algorithms",
      subjectId: "22222222-2222-4222-8222-222222222222",
      location: "Room 4",
      description: "Chapter 4",
    });

    // An all-day event has a date and no clock; a plain event has no type.
    expect(
      eventRowToItem(
        {
          id: "33333333-3333-4333-8333-333333333333",
          title: "Reading day",
          type: null,
          description: null,
          location: null,
          start_at: "2026-09-02T04:00:00.000Z",
          end_at: "2026-09-03T04:00:00.000Z",
          all_day: true,
          subject_id: null,
          subjects: null,
        },
        "America/New_York",
      ),
    ).toEqual({
      id: "33333333-3333-4333-8333-333333333333",
      title: "Reading day",
      startAt: "2026-09-02T04:00:00.000Z",
      endAt: "2026-09-03T04:00:00.000Z",
      allDay: true,
      startDate: "2026-09-02",
      endDateValue: "2026-09-03",
      dateLabel: "Wed, Sep 2",
    });
  });

  test("two users: events are RLS-isolated, range-query correct and constraint-guarded", async () => {
    test.setTimeout(120_000);

    if (!LOCAL_TARGET.test(url)) {
      throw new Error(`events-data is local-only; refusing target "${url || "(unset)"}"`);
    }
    if (!anonKey || !serviceKey) {
      throw new Error(
        "Missing NEXT_PUBLIC_SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY (frontend/.env.development.local)",
      );
    }
    if (!qa1Password || !qa2Password) {
      throw new Error(
        "Missing UNIPILOT_QA_PASSWORD / UNIPILOT_QA2_PASSWORD; seed the identities first (npm run seed:qa)",
      );
    }

    const service = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const qa1 = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const qa2 = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const signIn = async (client: SupabaseClient, email: string, password: string) => {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      expect(error, `sign-in failed for ${email}: ${error?.message}`).toBeNull();
      return data.user!.id;
    };

    const createdEventIds: string[] = [];
    const createdSubjectIds: string[] = [];

    const insertEvent = async (
      client: SupabaseClient,
      userId: string,
      title: string,
      fields: Record<string, unknown>,
    ): Promise<string> => {
      const { data, error } = await client
        .from("events")
        .insert({ user_id: userId, title, ...fields })
        .select("id")
        .single();
      expect(error, `insert "${title}": ${error?.message}`).toBeNull();
      const id = (data as { id: string }).id;
      createdEventIds.push(id);
      return id;
    };

    /** The service's overlap window, mirrored with the request-scoped client. */
    const queryRange = async (
      client: SupabaseClient,
      userId: string,
      startIso: string,
      endIso: string,
    ): Promise<string[]> => {
      const { data, error } = await client
        .from("events")
        .select("id")
        .eq("user_id", userId)
        .lt("start_at", endIso)
        .or(`end_at.gte.${startIso},and(end_at.is.null,start_at.gte.${startIso})`)
        .order("start_at", { ascending: true });
      expect(error, `range query: ${error?.message}`).toBeNull();
      return ((data as { id: string }[] | null) ?? []).map((row) => row.id);
    };

    try {
      const qa1Id = await signIn(qa1, QA1, qa1Password);
      const qa2Id = await signIn(qa2, QA2, qa2Password);
      expect(qa1Id).not.toBe(qa2Id);

      /* ---- 22.3 create ------------------------------------------------------ */
      const inWindow = await insertEvent(qa1, qa1Id, "QA1 in-window", {
        type: "class",
        start_at: "2026-10-01T13:00:00.000Z",
        end_at: "2026-10-01T14:00:00.000Z",
      });
      const overlap = await insertEvent(qa1, qa1Id, "QA1 overlaps window start", {
        start_at: "2026-09-30T23:00:00.000Z",
        end_at: "2026-10-01T12:00:00.000Z",
      });
      await insertEvent(qa1, qa1Id, "QA1 out-of-window", {
        start_at: "2026-12-01T13:00:00.000Z",
      });
      const qa2InWindow = await insertEvent(qa2, qa2Id, "QA2 in-window", {
        start_at: "2026-10-02T09:00:00.000Z",
        all_day: false,
      });

      /* ---- 22.2 load: own rows only, range-honest --------------------------- */
      await expect(
        queryRange(qa1, qa1Id, WINDOW_START, WINDOW_END),
        "QA1's window returns its overlapping rows, soonest first, and no others",
      ).resolves.toEqual([overlap, inWindow]);
      await expect(
        queryRange(qa2, qa2Id, WINDOW_START, WINDOW_END),
      ).resolves.toEqual([qa2InWindow]);

      // A cross-user get by id returns nothing (RLS).
      await expect(
        expectAllowed(
          qa1.from("events").select("id").eq("id", qa2InWindow),
          "QA1 gets QA2's event by id",
        ),
      ).resolves.toEqual([]);

      /* ---- 22.4/22.5: cross-user writes affect zero rows -------------------- */
      await expect(
        affectedRows(
          qa1.from("events").update({ title: "hijacked" }).eq("id", qa2InWindow).select("id"),
          "QA1 cross-updates QA2's event",
        ),
      ).resolves.toBe(0);
      await expect(
        affectedRows(
          qa1.from("events").delete().eq("id", qa2InWindow).select("id"),
          "QA1 cross-deletes QA2's event",
        ),
      ).resolves.toBe(0);
      await expect(
        expectAllowed(
          qa1.from("events").update({ title: "QA1 renamed" }).eq("id", inWindow).select("title"),
          "QA1 updates its own event",
        ),
      ).resolves.toEqual([{ title: "QA1 renamed" }]);

      /* ---- 22.6 type CHECK --------------------------------------------------- */
      for (const type of ["class", "exam", "deadline"]) {
        await insertEvent(qa1, qa1Id, `Type ${type}`, {
          type,
          start_at: "2026-10-03T09:00:00.000Z",
        });
      }
      const badType = await qa1.from("events").insert({
        user_id: qa1Id,
        title: "Bad type",
        type: "lecture",
        start_at: "2026-10-03T09:00:00.000Z",
      });
      expect(badType.error, "invalid event type must be rejected").toBeTruthy();

      // Schema boundary: end before start is rejected before it can persist.
      const badRange = await qa1.from("events").insert({
        user_id: qa1Id,
        title: "Backwards",
        start_at: "2026-10-03T10:00:00.000Z",
        end_at: "2026-10-03T09:00:00.000Z",
      });
      expect(badRange.error, "end before start must be rejected").toBeTruthy();

      /* ---- course: same-user subject trigger -------------------------------- */
      const qa2Subject = await expectAllowed(
        service
          .from("subjects")
          .insert({ user_id: qa2Id, name: "QA2 course" })
          .select("id")
          .single(),
        "seed QA2 subject",
      );
      const qa2SubjectId = (qa2Subject as { id: string }).id;
      createdSubjectIds.push(qa2SubjectId);

      const ownSubject = await expectAllowed(
        qa1
          .from("subjects")
          .insert({ user_id: qa1Id, name: "QA1 course" })
          .select("id")
          .single(),
        "seed QA1 subject",
      );
      const ownSubjectId = (ownSubject as { id: string }).id;
      createdSubjectIds.push(ownSubjectId);

      const foreignSubject = await qa1.from("events").insert({
        user_id: qa1Id,
        title: "Foreign course",
        start_at: "2026-10-04T09:00:00.000Z",
        subject_id: qa2SubjectId,
      });
      expect(
        foreignSubject.error,
        "an event cannot reference another user's subject",
      ).toBeTruthy();

      await insertEvent(qa1, qa1Id, "Own course", {
        start_at: "2026-10-04T09:00:00.000Z",
        subject_id: ownSubjectId,
      });
    } finally {
      if (createdEventIds.length > 0) {
        await service.from("events").delete().in("id", createdEventIds);
      }
      if (createdSubjectIds.length > 0) {
        await service.from("subjects").delete().in("id", createdSubjectIds);
      }
    }

    /* ---- No residue: every seeded id is gone (id-scoped, race-safe) --------- */
    const residueEvents = await service
      .from("events")
      .select("id")
      .in("id", createdEventIds);
    expect(residueEvents.error, `residue check: ${residueEvents.error?.message}`).toBeNull();
    expect(residueEvents.data).toEqual([]);
  });
});
