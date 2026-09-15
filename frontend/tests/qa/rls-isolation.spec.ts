/**
 * tests/qa/rls-isolation.spec.ts — Task 20.9's schema-level isolation proof.
 *
 * Proves the ratified RLS matrix (DATABASE.md) with two REAL users on the LOCAL
 * stack: QA1 and QA2 sign in with their seeded passwords (no forged tokens),
 * a service-role client seeds one owned row per table (plus one child row each)
 * and cleans up, and an anonymous client proves deny-by-default.
 *
 * It is schema-level only: no application data access is added (Stage 3), no
 * rows survive the run, and hosted is never contacted. The local-only guard
 * below refuses any non-127.0.0.1/localhost target before a client is created.
 *
 * Run: `npx playwright test tests/qa/rls-isolation.spec.ts` (stack + dev server
 * up; the QA identities seeded per QA_SESSION.md).
 */
import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const LOCAL_TARGET = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const qa1Password = process.env.UNIPILOT_QA_PASSWORD ?? "";
const qa2Password = process.env.UNIPILOT_QA2_PASSWORD ?? "";

const QA1 = "qa.unipilot@unipilot.test";
const QA2 = "qa2.unipilot@unipilot.test";

/** Tables with a `user_id` owner and rows the test seeds for both users. */
const OWNED_TABLES = [
  "subjects",
  "tasks",
  "events",
  "documents",
  "conversations",
  "tool_runs",
  "notifications",
  "usage_events",
] as const;
type OwnedTable = (typeof OWNED_TABLES)[number];

/** Benign update a client would use, per table (cross-user update proof). */
const UPDATE_PATCH: Record<OwnedTable, Record<string, unknown>> = {
  subjects: { name: "rls-cross-update" },
  tasks: { title: "rls-cross-update" },
  events: { title: "rls-cross-update" },
  documents: { name: "rls-cross-update.pdf" },
  conversations: { title: "rls-cross-update" },
  tool_runs: { status: "failed" },
  notifications: { title: "rls-cross-update" },
  usage_events: { quantity: 999 },
};

/** Tables whose owner may delete their own rows. */
const DELETE_CAPABLE = [
  "subjects",
  "tasks",
  "events",
  "documents",
  "conversations",
  "notifications",
] as const;

/** Every table whose residue teardown checks, child tables included. */
const RESIDUE_TABLES = [
  ...OWNED_TABLES,
  "document_chunks",
  "messages",
  "integration_connections",
  "integration_runs",
  "integration_messages",
  "integration_candidates",
] as const;

type Result = { data: unknown; error: { message: string } | null };

async function expectAllowed(promise: PromiseLike<Result>, message: string) {
  const { data, error } = await promise;
  expect(error, `${message}: ${error?.message}`).toBeNull();
  return data;
}

async function expectDenied(promise: PromiseLike<Result>, message: string) {
  const { data, error } = await promise;
  expect(error, `${message}: expected the request to be denied`).toBeTruthy();
  expect(data ?? null, `${message}: denied request returned data`).toBeNull();
}

async function insertOne(
  promise: PromiseLike<Result>,
  message: string,
): Promise<string> {
  const data = await expectAllowed(promise, message);
  const row = data as { id: string } | null;
  expect(row?.id, `${message}: no row returned`).toBeTruthy();
  return row!.id;
}

async function selectIds(
  promise: PromiseLike<Result>,
  message: string,
): Promise<string[]> {
  const data = await expectAllowed(promise, message);
  return ((data as { id: string }[] | null) ?? []).map((row) => row.id);
}

async function affectedRows(
  promise: PromiseLike<Result>,
  message: string,
): Promise<number> {
  const data = await expectAllowed(promise, message);
  return ((data as { id: string }[] | null) ?? []).length;
}

/**
 * A cross-user write must change nothing. After the step-0 ACL audit (24.x),
 * tables whose write grants were revoked outright (`usage_events`,
 * `subscriptions`, `notifications` INSERT, `profiles`/`tool_runs` DELETE)
 * answer "permission denied" — a stronger denial than RLS filtering — while
 * tables that keep their client grant answer zero affected rows. Both are
 * isolation; neither may succeed.
 */
async function expectCrossWriteDenied(
  rows: PromiseLike<number>,
  message: string,
) {
  try {
    expect(await rows, message).toBe(0);
  } catch (error) {
    expect(String(error), message).toMatch(/permission denied/i);
  }
}

function tableCount(
  service: SupabaseClient,
  table: string,
): PromiseLike<{ count: number | null; error: { message: string } | null }> {
  return service.from(table).select("*", { count: "exact", head: true });
}

test.describe("rls isolation: two users, one database", () => {
  test("QA1 and QA2 cannot see, change or delete each other's rows", async () => {
    test.setTimeout(180_000);

    if (!LOCAL_TARGET.test(url)) {
      throw new Error(
        `rls-isolation is local-only; refusing target "${url || "(unset)"}"`,
      );
    }
    if (!anonKey || !serviceKey) {
      throw new Error(
        "Missing NEXT_PUBLIC_SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY (frontend/.env.development.local)",
      );
    }
    if (!qa1Password || !qa2Password) {
      throw new Error(
        "Missing UNIPILOT_QA_PASSWORD / UNIPILOT_QA2_PASSWORD (frontend/.env.development.local); seed both identities first (`npm run seed:qa` from the repo root)",
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
    const anon = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const signIn = async (client: SupabaseClient, email: string, password: string) => {
      const { data, error } = await client.auth.signInWithPassword({
        email,
        password,
      });
      expect(error, `sign-in failed for ${email}: ${error?.message}`).toBeNull();
      return data.user!.id;
    };

    const ids: Record<string, string> = {};
    const rows: Record<string, Record<OwnedTable, string>> = {};

    /** Pre-seed counts, so teardown can prove it returned to that state. */
    const countsBefore: Record<string, number> = {};

    /**
     * Profile rows are provisioned per auth user, so the local database may
     * legitimately hold accounts beyond the two QA identities (a founder
     * account, for one). This spec's residue property is that it adds and
     * removes none of them, so the count is compared against its own snapshot
     * rather than a hard-coded pristine number.
     */
    let profilesBefore = -1;

    /** Every row this spec creates, so teardown never touches anyone else's. */
    const seededRows: { table: OwnedTable; id: string }[] = [];
    const seededChunks: string[] = [];
    const seededMessages: string[] = [];

    /** One owned row per table + one document chunk and one message. */
    const seedFor = async (userId: string, tag: string) => {
      const seeded = {} as Record<OwnedTable, string>;
      seeded.subjects = await insertOne(
        service.from("subjects").insert({ user_id: userId, name: `RLS subject ${tag}` }).select("id").single(),
        `${tag} seed subjects`,
      );
      seeded.tasks = await insertOne(
        service.from("tasks").insert({ user_id: userId, title: `RLS task ${tag}`, status: "todo" }).select("id").single(),
        `${tag} seed tasks`,
      );
      seeded.events = await insertOne(
        service.from("events").insert({ user_id: userId, title: `RLS event ${tag}`, start_at: new Date().toISOString() }).select("id").single(),
        `${tag} seed events`,
      );
      seeded.documents = await insertOne(
        service.from("documents").insert({ user_id: userId, name: `rls-${tag}.pdf`, status: "uploaded" }).select("id").single(),
        `${tag} seed documents`,
      );
      seeded.conversations = await insertOne(
        service.from("conversations").insert({ user_id: userId, title: `RLS conversation ${tag}` }).select("id").single(),
        `${tag} seed conversations`,
      );
      seeded.tool_runs = await insertOne(
        service.from("tool_runs").insert({ user_id: userId, tool_id: "flashcards", status: "completed" }).select("id").single(),
        `${tag} seed tool_runs`,
      );
      seeded.notifications = await insertOne(
        service.from("notifications").insert({ user_id: userId, kind: "system", title: `RLS notification ${tag}` }).select("id").single(),
        `${tag} seed notifications`,
      );
      seeded.usage_events = await insertOne(
        service.from("usage_events").insert({ user_id: userId, kind: "document_pages", quantity: 1 }).select("id").single(),
        `${tag} seed usage_events`,
      );
      for (const table of OWNED_TABLES) {
        seededRows.push({ table, id: seeded[table] });
      }
      const chunkId = await insertOne(
        service.from("document_chunks").insert({ document_id: seeded.documents, chunk_index: 0, content: `RLS chunk ${tag}` }).select("id").single(),
        `${tag} seed document_chunks`,
      );
      seededChunks.push(chunkId);
      const messageId = await insertOne(
        service.from("messages").insert({ conversation_id: seeded.conversations, role: "user", content: `RLS message ${tag}` }).select("id").single(),
        `${tag} seed messages`,
      );
      seededMessages.push(messageId);
      return { seeded, chunkId, messageId };
    };

    /**
     * Deletes exactly this spec's rows by id — never by `user_id`. Since 13.10
     * QA1 owns persisted onboarding subjects, a user-scoped delete here would
     * quietly destroy the other spec's data (and its redirect-gate state).
     */
    const cleanup = async () => {
      if (seededMessages.length > 0) {
        await service.from("messages").delete().in("id", seededMessages);
      }
      if (seededChunks.length > 0) {
        await service.from("document_chunks").delete().in("id", seededChunks);
      }
      for (const table of OWNED_TABLES) {
        const tableIds = seededRows
          .filter((row) => row.table === table)
          .map((row) => row.id);
        if (tableIds.length > 0) {
          await service.from(table).delete().in("id", tableIds);
        }
      }
    };

    try {
      ids.qa1 = await signIn(qa1, QA1, qa1Password);
      ids.qa2 = await signIn(qa2, QA2, qa2Password);
      expect(ids.qa1, "QA1 and QA2 must be different users").not.toBe(ids.qa2);

      // Snapshot every table before seeding. Teardown must return these counts
      // exactly — including QA1's Task 13.10 onboarding subjects, which this
      // spec did not create and must not remove.
      for (const table of RESIDUE_TABLES) {
        const { count, error } = await tableCount(service, table);
        expect(error, `pre-run count ${table}: ${error?.message}`).toBeNull();
        countsBefore[table] = count ?? -1;
      }
      const profilesSnapshot = await tableCount(service, "profiles");
      expect(
        profilesSnapshot.error,
        `pre-run count profiles: ${profilesSnapshot.error?.message}`,
      ).toBeNull();
      profilesBefore = profilesSnapshot.count ?? -1;

      const s1 = await seedFor(ids.qa1, "QA1");
      const s2 = await seedFor(ids.qa2, "QA2");
      rows.qa1 = s1.seeded;
      rows.qa2 = s2.seeded;

      /* ---- Owned tables: own-only reads, denied anon, cross-user empties ---- */
      for (const table of OWNED_TABLES) {
        await expect(
          selectIds(
            qa1.from(table).select("id").eq("id", rows.qa1[table]),
            `QA1 reads own ${table}`,
          ),
          `QA1 reads own ${table}`,
        ).resolves.toEqual([rows.qa1[table]]);
        await expect(
          selectIds(
            qa2.from(table).select("id").eq("id", rows.qa2[table]),
            `QA2 reads own ${table}`,
          ),
          `QA2 reads own ${table}`,
        ).resolves.toEqual([rows.qa2[table]]);

        await expect(
          selectIds(
            qa1.from(table).select("id").eq("id", rows.qa2[table]),
            `QA1 must not read QA2's ${table}`,
          ),
          `QA1 must not read QA2's ${table}`,
        ).resolves.toEqual([]);
        await expect(
          selectIds(
            qa2.from(table).select("id").eq("id", rows.qa1[table]),
            `QA2 must not read QA1's ${table}`,
          ),
          `QA2 must not read QA1's ${table}`,
        ).resolves.toEqual([]);

        await expectDenied(
          anon.from(table).select("id"),
          `anon must not read ${table}`,
        );
        await expectDenied(
          anon.from(table).insert({ user_id: ids.qa1 }),
          `anon must not insert ${table}`,
        );
      }

      // Anon writes are denied at every operation, not just INSERT.
      await expectDenied(
        anon.from("subjects").update({ name: "anon" }).eq("id", rows.qa1.subjects),
        "anon must not update subjects",
      );
      await expectDenied(
        anon.from("subjects").delete().eq("id", rows.qa1.subjects),
        "anon must not delete subjects",
      );

      /* ---- Cross-user updates affect 0 rows; deletes too where allowed ---- */
      for (const table of OWNED_TABLES) {
        await expectCrossWriteDenied(
          affectedRows(
            qa1
              .from(table)
              .update(UPDATE_PATCH[table])
              .eq("id", rows.qa2[table])
              .select("id"),
            `QA1 cross-update ${table}`,
          ),
          `QA1 cross-update ${table}`,
        );
        await expectCrossWriteDenied(
          affectedRows(
            qa2
              .from(table)
              .update(UPDATE_PATCH[table])
              .eq("id", rows.qa1[table])
              .select("id"),
            `QA2 cross-update ${table}`,
          ),
          `QA2 cross-update ${table}`,
        );
      }
      for (const table of DELETE_CAPABLE) {
        await expectCrossWriteDenied(
          affectedRows(
            qa1
              .from(table)
              .delete()
              .eq("id", rows.qa2[table])
              .select("id"),
            `QA1 cross-delete ${table}`,
          ),
          `QA1 cross-delete ${table}`,
        );
        await expectCrossWriteDenied(
          affectedRows(
            qa2
              .from(table)
              .delete()
              .eq("id", rows.qa1[table])
              .select("id"),
            `QA2 cross-delete ${table}`,
          ),
          `QA2 cross-delete ${table}`,
        );
      }

      // tool_runs has no client DELETE: after the audit the grant itself is
      // gone (permission denied) rather than RLS filtering the command to
      // zero rows; either way the history is untouchable.
      await expectCrossWriteDenied(
        affectedRows(
          qa1.from("tool_runs").delete().eq("id", rows.qa2.tool_runs).select("id"),
          "QA1 must not delete tool run history",
        ),
        "QA1 must not delete tool run history",
      );

      // The cross-user attempts changed nothing: every table holds its
      // pre-run rows plus exactly the two this spec seeded (QA1 + QA2).
      for (const table of OWNED_TABLES) {
        const { count, error } = await tableCount(service, table);
        expect(error, `service count ${table}: ${error?.message}`).toBeNull();
        expect(count, `cross-user attempts left row count wrong in ${table}`).toBe(
          countsBefore[table] + 2,
        );
      }

      /* ---- Child-table isolation through the parent ---- */
      await expect(
        selectIds(
          qa1.from("document_chunks").select("id").eq("id", s1.chunkId),
          "QA1 reads its own document chunk",
        ),
        "QA1 reads its own document chunk",
      ).resolves.toEqual([s1.chunkId]);
      await expect(
        selectIds(
          qa1.from("document_chunks").select("id").eq("document_id", rows.qa2.documents),
          "QA1 must not read QA2's document chunks",
        ),
        "QA1 must not read QA2's document chunks",
      ).resolves.toEqual([]);
      await expect(
        selectIds(
          qa2.from("document_chunks").select("id").eq("document_id", rows.qa1.documents),
          "QA2 must not read QA1's document chunks",
        ),
        "QA2 must not read QA1's document chunks",
      ).resolves.toEqual([]);

      await expect(
        selectIds(
          qa1.from("messages").select("id").eq("id", s1.messageId),
          "QA1 reads its own message",
        ),
        "QA1 reads its own message",
      ).resolves.toEqual([s1.messageId]);
      await expect(
        selectIds(
          qa1.from("messages").select("id").eq("conversation_id", rows.qa2.conversations),
          "QA1 must not read QA2's messages",
        ),
        "QA1 must not read QA2's messages",
      ).resolves.toEqual([]);
      await expect(
        selectIds(
          qa2.from("messages").select("id").eq("conversation_id", rows.qa1.conversations),
          "QA2 must not read QA1's messages",
        ),
        "QA2 must not read QA1's messages",
      ).resolves.toEqual([]);

      /* ---- Profiles: exactly one visible row each ---- */
      const qa1Profiles = await selectIds(
        qa1.from("profiles").select("id"),
        "QA1 reads profiles",
      );
      const qa2Profiles = await selectIds(
        qa2.from("profiles").select("id"),
        "QA2 reads profiles",
      );
      expect(qa1Profiles).toEqual([ids.qa1]);
      expect(qa2Profiles).toEqual([ids.qa2]);
      await expect(
        selectIds(
          qa1.from("profiles").select("id").eq("id", ids.qa2),
          "QA1 must not read QA2's profile",
        ),
        "QA1 must not read QA2's profile",
      ).resolves.toEqual([]);

      /* ---- 13.10 onboarding isolation: QA1's persisted rows stay private ---- */
      // QA1 completed onboarding in the qa-onboarding project (a dependency of
      // this one), so its `subjects` now hold real rows this spec never seeded.
      // QA2 must not see them — the same owner policy, asserted against the
      // persisted data rather than only the seeded probes above.
      const qa1OwnedSubjectIds = await selectIds(
        service.from("subjects").select("id").eq("user_id", ids.qa1),
        "service reads QA1's subjects",
      );
      expect(
        qa1OwnedSubjectIds.length,
        "QA1 must have persisted onboarding subjects for this assertion",
      ).toBeGreaterThan(0);
      await expect(
        selectIds(
          qa2
            .from("subjects")
            .select("id")
            .in("id", qa1OwnedSubjectIds),
          "QA2 must not read QA1's onboarding subjects",
        ),
        "QA2 must not read QA1's onboarding subjects",
      ).resolves.toEqual([]);

      /* ---- Server-only writes: no client policy, so authenticated denied ---- */
      await expectDenied(
        qa1.from("subscriptions").insert({ user_id: ids.qa1 }),
        "authenticated must not insert subscriptions",
      );
      await expectDenied(
        qa1.from("notifications").insert({ user_id: ids.qa1, kind: "system", title: "client write" }),
        "authenticated must not insert notifications",
      );
      await expectDenied(
        qa1.from("usage_events").insert({ user_id: ids.qa1, kind: "client_write", quantity: 1 }),
        "authenticated must not insert usage events",
      );

      // 13.10's onboarding write is a security-invoker function; its EXECUTE
      // grant is authenticated-only, so an anonymous caller is denied before
      // the auth.uid() guard can even run.
      await expectDenied(
        anon.rpc("complete_onboarding", {
          p_first_name: "anon",
          p_last_name: "anon",
          p_institution: "anon",
          p_course_program: "anon",
          p_academic_year: 1,
          p_semester: 1,
          p_planning_style: "steady",
          p_reminder_lead: "1_day",
          p_subjects: [],
        }),
        "anon must not execute complete_onboarding",
      );

      // The usage ledger is append-only for clients: after the step-0 audit
      // the write grants are gone (permission denied); the row is untouched
      // either way.
      await expectCrossWriteDenied(
        affectedRows(
          qa1
            .from("usage_events")
            .update({ quantity: 999 })
            .eq("id", rows.qa1.usage_events)
            .select("id"),
          "authenticated must not update usage events",
        ),
        "authenticated must not update usage events",
      );
      await expectCrossWriteDenied(
        affectedRows(
          qa1
            .from("usage_events")
            .delete()
            .eq("id", rows.qa1.usage_events)
            .select("id"),
          "authenticated must not delete usage events",
        ),
        "authenticated must not delete usage events",
      );
    } finally {
      await cleanup();
    }

    /* ---- No residue: every table returns to its pre-seed count, and the
       only profile rows are the two trigger-provisioned ones. QA1's persisted
       onboarding subjects count as pre-existing state, not as this spec's
       residue (13.10). ---- */
    for (const table of RESIDUE_TABLES) {
      const { count, error } = await tableCount(service, table);
      expect(error, `residue ${table}: ${error?.message}`).toBeNull();
      expect(
        count,
        `${table} must return to its pre-run count after teardown`,
      ).toBe(countsBefore[table]);
    }
    const profiles = await tableCount(service, "profiles");
    expect(profiles.error, `residue profiles: ${profiles.error?.message}`).toBeNull();
    expect(
      profiles.count,
      "this spec must not add or remove profile rows",
    ).toBe(profilesBefore);
    // ...and both QA profiles (the rows the spec read from) still exist.
    const qaProfiles = await selectIds(
      service.from("profiles").select("id").in("id", [ids.qa1, ids.qa2]),
      "service reads both QA profiles",
    );
    expect([...qaProfiles].sort()).toEqual([ids.qa1, ids.qa2].sort());
  });
});
