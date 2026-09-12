/**
 * tests/qa/tasks-data.spec.ts — Task 21.x's tasks data proof.
 *
 * Two halves, matching the two halves of the service:
 *
 * 1. The pure modules the service is built on — `lib/data/taskValues.ts`
 *    (validation, vocabulary, row → display mapping) and `lib/data/taskDates.ts`
 *    (date-only ↔ instant, display formatting). They are server-used but import
 *    no server-only code, so this Chromium-suite runner can exercise them
 *    directly; these are the exact functions the Server Actions call.
 *
 * 2. The RLS/schema operations the server-only service wraps
 *    (`lib/data/tasks.ts` uses `next/headers` and cannot be imported here), run
 *    with two REAL users (QA1/QA2) through `@supabase/supabase-js` so the
 *    database — not a mock — decides ownership: own reads and writes,
 *    cross-user reads empty and cross-user writes affecting zero rows, the
 *    closed vocabularies rejecting bad input, and an id-scoped teardown that
 *    leaves no residue.
 *
 * Local-only by construction (the guard below refuses any non-loopback
 * target); hosted is never contacted. The spec creates only its own rows and
 * removes exactly those ids again, so it is order-independent alongside the
 * other suites.
 */
import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  parseTaskDraft,
  parseTaskPatch,
  parseTaskPriority,
  parseTaskStatus,
  taskRowToItem,
} from "../../lib/data/taskValues";
import {
  formatTaskDueDate,
  zonedDateOnlyToInstant,
} from "../../lib/data/taskDates";

const LOCAL_TARGET = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const qa1Password = process.env.UNIPILOT_QA_PASSWORD ?? "";
const qa2Password = process.env.UNIPILOT_QA2_PASSWORD ?? "";

const QA1 = "qa.unipilot@unipilot.test";
const QA2 = "qa2.unipilot@unipilot.test";

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

test.describe("tasks data (21.x)", () => {
  test("pure validation, vocabulary and display mapping", () => {
    /* ---- 21.3 create draft ------------------------------------------------- */
    expect(parseTaskDraft({ title: "  Draft OS lab report  " })).toEqual({
      title: "Draft OS lab report",
      description: null,
      dueDate: null,
      effortMinutes: null,
      priority: null,
    });
    expect(parseTaskDraft({ title: "   " })).toBeNull();
    expect(parseTaskDraft({ title: "x".repeat(81) })).toBeNull();
    expect(parseTaskDraft({ title: "x".repeat(80) })).not.toBeNull();
    expect(parseTaskDraft({ title: "ok", dueDate: "2026-02-30" })).toBeNull();
    expect(parseTaskDraft({ title: "ok", dueDate: "2026-09-02" })).toEqual({
      title: "ok",
      description: null,
      dueDate: "2026-09-02",
      effortMinutes: null,
      priority: null,
    });
    expect(
      parseTaskDraft({ title: "ok", dueDate: "2026-09-02", priority: "high" }),
    ).toEqual({
      title: "ok",
      description: null,
      dueDate: "2026-09-02",
      effortMinutes: null,
      priority: "high",
    });
    expect(parseTaskDraft({ title: "ok", priority: "none" })).toMatchObject({
      priority: null,
    });
    expect(parseTaskDraft({ title: "ok", priority: "urgent" })).toBeNull();
    expect(parseTaskDraft({ title: "ok", effortMinutes: 0 })).toBeNull();
    expect(parseTaskDraft({ title: "ok", effortMinutes: 30.5 })).toBeNull();
    expect(
      parseTaskDraft({ title: "ok", description: "  read ch. 4  " }),
    ).toEqual({
      title: "ok",
      description: "read ch. 4",
      dueDate: null,
      effortMinutes: null,
      priority: null,
    });

    /* ---- 21.4 update patch: absent = leave, null/"" = clear ---------------- */
    expect(parseTaskPatch({})).toBeNull();
    expect(parseTaskPatch({ title: "  Renamed  " })).toEqual({
      title: "Renamed",
    });
    expect(parseTaskPatch({ dueDate: null })).toEqual({ dueDate: null });
    expect(parseTaskPatch({ dueDate: "" })).toEqual({ dueDate: null });
    expect(parseTaskPatch({ effortMinutes: null })).toEqual({
      effortMinutes: null,
    });
    expect(parseTaskPatch({ priority: "high" })).toEqual({ priority: "high" });
    expect(parseTaskPatch({ priority: "none" })).toEqual({ priority: null });
    expect(parseTaskPatch({ title: "  " })).toBeNull();
    expect(parseTaskPatch({ dueDate: "not-a-date" })).toBeNull();
    expect(parseTaskPatch({ effortMinutes: -1 })).toBeNull();
    expect(parseTaskPatch({ priority: "urgent" })).toBeNull();

    /* ---- 21.6 status ------------------------------------------------------- */
    expect(parseTaskStatus("todo")).toBe("todo");
    expect(parseTaskStatus("in_progress")).toBe("in_progress");
    expect(parseTaskStatus("done")).toBe("done");
    expect(parseTaskStatus("in-progress")).toBeNull();
    expect(parseTaskStatus("blocked")).toBeNull();

    /* ---- 21.7 priority: none clears, junk is invalid ----------------------- */
    expect(parseTaskPriority("low")).toBe("low");
    expect(parseTaskPriority("medium")).toBe("medium");
    expect(parseTaskPriority("high")).toBe("high");
    expect(parseTaskPriority("none")).toBeNull();
    expect(parseTaskPriority("urgent")).toBeUndefined();
    expect(parseTaskPriority(3)).toBeUndefined();

    /* ---- 21.2 / 21.8 display contract -------------------------------------- */
    expect(
      taskRowToItem(
        {
          id: "11111111-1111-4111-8111-111111111111",
          title: "Draft OS lab report",
          status: "in_progress",
          due_date: "2026-09-02T00:00:00.000Z",
          priority: "high",
        },
        "UTC",
      ),
    ).toEqual({
      id: "11111111-1111-4111-8111-111111111111",
      title: "Draft OS lab report",
      status: "in-progress",
      dueDate: "Wed, Sep 2",
      dueDateValue: "2026-09-02",
      priority: "High",
      priorityValue: "high",
    });

    expect(
      taskRowToItem(
        {
          id: "22222222-2222-4222-8222-222222222222",
          title: "No extras",
          status: "todo",
          due_date: null,
          priority: null,
        },
        "UTC",
      ),
    ).toEqual({
      id: "22222222-2222-4222-8222-222222222222",
      title: "No extras",
      status: "todo",
    });

    /* ---- 21.8 dates: stored as UTC instants, shown in the profile zone ----- */
    expect(formatTaskDueDate("2026-09-02T00:00:00.000Z", "UTC")).toBe(
      "Wed, Sep 2",
    );

    // 00:00 in New York (EDT, UTC-4) is 04:00Z; formatting back in the same
    // zone returns the same calendar date.
    const newYork = zonedDateOnlyToInstant("2026-09-02", "America/New_York");
    expect(newYork).toBe("2026-09-02T04:00:00.000Z");
    expect(formatTaskDueDate(newYork, "America/New_York")).toBe("Wed, Sep 2");

    // The extreme eastern zone (+14) crosses back a UTC day; the date must
    // still round-trip, which is why the date is stored at the zone's own
    // start of day rather than at UTC midnight.
    const kiritimati = zonedDateOnlyToInstant("2026-09-02", "Pacific/Kiritimati");
    expect(formatTaskDueDate(kiritimati, "Pacific/Kiritimati")).toBe(
      "Wed, Sep 2",
    );
  });

  test("two users: CRUD, status, priority and vocabulary are RLS-isolated", async () => {
    test.setTimeout(120_000);

    if (!LOCAL_TARGET.test(url)) {
      throw new Error(`tasks-data is local-only; refusing target "${url || "(unset)"}"`);
    }
    if (!anonKey || !serviceKey) {
      throw new Error(
        "Missing NEXT_PUBLIC_SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY (frontend/.env.development.local)",
      );
    }
    if (!qa1Password || !qa2Password) {
      throw new Error(
        "Missing UNIPILOT_QA_PASSWORD / UNIPILOT_QA2_PASSWORD; seed both identities first (npm run seed:qa)",
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

    /** Every row this spec creates, so teardown removes exactly those ids. */
    const createdIds: string[] = [];

    const insertTask = async (
      client: SupabaseClient,
      userId: string,
      title: string,
      extra: Record<string, unknown> = {},
    ): Promise<string> => {
      const { data, error } = await client
        .from("tasks")
        .insert({ user_id: userId, title, ...extra })
        .select("id")
        .single();
      expect(error, `insert "${title}": ${error?.message}`).toBeNull();
      const id = (data as { id: string }).id;
      createdIds.push(id);
      return id;
    };

    try {
      const qa1Id = await signIn(qa1, QA1, qa1Password);
      const qa2Id = await signIn(qa2, QA2, qa2Password);
      expect(qa1Id).not.toBe(qa2Id);

      /* ---- 21.3 create ------------------------------------------------------ */
      const taskA = await insertTask(qa1, qa1Id, "QA1 task A", {
        priority: "high",
        due_date: "2026-09-02T04:00:00.000Z",
      });
      const taskB = await insertTask(qa2, qa2Id, "QA2 task B");

      /* ---- 21.2 load: each user sees only their own ------------------------- */
      const qa1Visible = await expectAllowed(
        qa1.from("tasks").select("id, user_id"),
        "QA1 lists tasks",
      );
      const qa1Ids = ((qa1Visible as { id: string; user_id: string }[] | null) ?? []).map(
        (row) => row.id,
      );
      expect(qa1Ids).toContain(taskA);
      expect(qa1Ids).not.toContain(taskB);

      // The row itself is unreachable by id through RLS, not just absent from
      // an unfiltered list.
      await expect(
        expectAllowed(
          qa1.from("tasks").select("id").eq("id", taskB),
          "QA1 gets QA2's task by id",
        ),
      ).resolves.toEqual([]);

      /* ---- 21.4 update: cross-user affects zero rows ------------------------ */
      await expect(
        affectedRows(
          qa1.from("tasks").update({ title: "hijacked" }).eq("id", taskB).select("id"),
          "QA1 cross-updates QA2's task",
        ),
      ).resolves.toBe(0);

      await expect(
        expectAllowed(
          qa1
            .from("tasks")
            .update({ title: "QA1 task A renamed" })
            .eq("id", taskA)
            .select("title"),
          "QA1 renames own task",
        ),
      ).resolves.toEqual([{ title: "QA1 task A renamed" }]);

      /* ---- 21.5 delete: cross-user affects zero rows, own works ------------- */
      await expect(
        affectedRows(
          qa1.from("tasks").delete().eq("id", taskB).select("id"),
          "QA1 cross-deletes QA2's task",
        ),
      ).resolves.toBe(0);
      await expect(
        expectAllowed(
          qa2.from("tasks").select("id").eq("id", taskB),
          "QA2's task survives QA1's delete",
        ),
      ).resolves.toEqual([{ id: taskB }]);

      /* ---- 21.6 status: own change works, junk is rejected by the CHECK ----- */
      await expect(
        expectAllowed(
          qa1
            .from("tasks")
            .update({ status: "in_progress" })
            .eq("id", taskA)
            .select("status"),
          "QA1 sets in_progress",
        ),
      ).resolves.toEqual([{ status: "in_progress" }]);

      const badStatus = await qa1
        .from("tasks")
        .update({ status: "blocked" })
        .eq("id", taskA)
        .select("id");
      expect(badStatus.error, "invalid status must be rejected").toBeTruthy();

      /* ---- 21.7 priority: low|medium|high, NULL clears, junk rejected ------- */
      for (const priority of ["low", "medium", "high"]) {
        await expect(
          expectAllowed(
            qa1
              .from("tasks")
              .update({ priority })
              .eq("id", taskA)
              .select("priority"),
            `QA1 sets priority ${priority}`,
          ),
        ).resolves.toEqual([{ priority }]);
      }
      await expect(
        expectAllowed(
          qa1
            .from("tasks")
            .update({ priority: null })
            .eq("id", taskA)
            .select("priority"),
          "QA1 clears priority",
        ),
      ).resolves.toEqual([{ priority: null }]);

      const badPriority = await qa1
        .from("tasks")
        .update({ priority: "urgent" })
        .eq("id", taskA)
        .select("id");
      expect(badPriority.error, "invalid priority must be rejected").toBeTruthy();

      /* ---- boundary validation the service mirrors -------------------------- */
      const blankTitle = await qa1
        .from("tasks")
        .insert({ user_id: qa1Id, title: "   " })
        .select("id");
      expect(blankTitle.error, "blank titles must be rejected").toBeTruthy();

      const zeroEffort = await qa1
        .from("tasks")
        .insert({ user_id: qa1Id, title: "Zero effort", effort_minutes: 0 })
        .select("id");
      expect(zeroEffort.error, "non-positive effort must be rejected").toBeTruthy();

      /* ---- 21.5 delete own: the row is actually gone ------------------------ */
      await expect(
        affectedRows(
          qa1.from("tasks").delete().eq("id", taskA).select("id"),
          "QA1 deletes own task",
        ),
      ).resolves.toBe(1);
      await expect(
        expectAllowed(
          qa1.from("tasks").select("id").eq("id", taskA),
          "QA1's deleted task is gone",
        ),
      ).resolves.toEqual([]);
    } finally {
      if (createdIds.length > 0) {
        await service.from("tasks").delete().in("id", createdIds);
      }
    }

    /* ---- No residue: every seeded id is gone (id-scoped, race-safe) --------- */
    const residue = await service
      .from("tasks")
      .select("id")
      .in("id", createdIds);
    expect(residue.error, `residue check: ${residue.error?.message}`).toBeNull();
    expect(residue.data).toEqual([]);
  });
});
