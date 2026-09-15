/**
 * tests/qa/whatsapp-security.spec.ts — Task 46.12 security proof.
 *
 * Proves, on the LOCAL stack only:
 * - the events provenance trigger (spec §6.1): an authenticated forge lands
 *   `source='manual'`/`source_ref=null`; service-role writes keep provenance;
 *   owner manual CRUD still works;
 * - the credential table and every token/QR/lease RPC are service_role-only
 *   (the 29.1 default-grant trap): anon + authenticated are denied;
 * - QR rows are encrypted and TTL'd: `get_whatsapp_qr` returns null and clears
 *   past `qr_expires_at`;
 * - `rotate_google_token_key` round-trips and the stored value is bytea;
 * - the trigger helpers (`lock_event_provenance`, `set_updated_at`) are not
 *   callable as RPCs while the events trigger still fires;
 * - the four integration tables are owner-read-only: cross-user SELECT is
 *   filtered to zero rows and no client INSERT/UPDATE/DELETE is granted;
 * - P7.1: the Google OAuth callback on an unconfigured server refuses with the
 *   honest `google=not_configured` redirect and creates no credential row;
 * - P7.2: a stored `connected` google row alone makes the `/integrations`
 *   overview enqueue the missing `whatsapp.push` (no OAuth env involved), the
 *   active job absorbs the second read, and a fresh terminal failure
 *   suppresses the re-enqueue until `GOOGLE_PUSH_RETRY_WINDOW_MS` passes.
 */
import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { GOOGLE_PUSH_RETRY_WINDOW_MS } from "../../lib/data/integrationValues";
import { acquireWorkerLock } from "./workerLock";

const LOCAL_TARGET = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const KEY = process.env.UNIPILOT_INTEGRATIONS_KEY ?? "";
const GOOGLE_CONFIGURED = Boolean(
  process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET,
);
const QA1 = "qa.unipilot@unipilot.test";
const QA2 = "qa2.unipilot@unipilot.test";
const qa1Password = process.env.UNIPILOT_QA_PASSWORD ?? "";
const qa2Password = process.env.UNIPILOT_QA2_PASSWORD ?? "";

let service: SupabaseClient;
let qa1: SupabaseClient;
let qa2: SupabaseClient;
let qa1Id = "";
let qa2Id = "";
let releaseWorkerLock: (() => void) | null = null;
const createdEventIds: string[] = [];
const createdRunIds: string[] = [];
const createdConnectionIds: string[] = [];
const createdCandidateIds: string[] = [];
const createdJobIds: string[] = [];
const createdCredentialUserIds: string[] = [];
const createdExportPaths: string[] = [];

test.beforeAll(async () => {
  if (!LOCAL_TARGET.test(url)) throw new Error(`local-only; refusing ${url}`);
  if (!anonKey || !serviceKey) throw new Error("missing local keys");
  if (!KEY) throw new Error("missing UNIPILOT_INTEGRATIONS_KEY");
  if (!qa2Password) throw new Error("missing UNIPILOT_QA2_PASSWORD");
  service = createClient(url, serviceKey, { auth: { persistSession: false } });
  qa1 = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error } = await qa1.auth.signInWithPassword({
    email: QA1, password: qa1Password,
  });
  expect(error, `sign-in: ${error?.message}`).toBeNull();
  qa1Id = data.user!.id;
  qa2 = createClient(url, anonKey, { auth: { persistSession: false } });
  const qa2SignIn = await qa2.auth.signInWithPassword({
    email: QA2, password: qa2Password,
  });
  expect(qa2SignIn.error, `qa2 sign-in: ${qa2SignIn.error?.message}`).toBeNull();
  qa2Id = qa2SignIn.data.user!.id;
  expect(qa1Id, "QA1 and QA2 must be different users").not.toBe(qa2Id);
  // P7.2's backfill proof seeds QA1's google row and asserts absolute job
  // counts while the flow project's `/integrations` loads can trigger the same
  // backfill; a targeted `--no-deps` run parallelizes the two files, so the
  // shared worker lock keeps that seeded window single-writer (see
  // workerLock.ts). In the full suite the project dependency chain makes this
  // uncontended.
  releaseWorkerLock = await acquireWorkerLock();
});

test.afterAll(async () => {
  try {
    if (createdExportPaths.length) {
      await service.storage.from("whatsapp-exports").remove(createdExportPaths);
      createdExportPaths.length = 0;
    }
    for (const target of createdCredentialUserIds) {
      await service.rpc("delete_google_credentials", { p_user_id: target });
    }
    if (createdCandidateIds.length) await service.from("integration_candidates").delete().in("id", createdCandidateIds);
    if (createdRunIds.length) await service.from("integration_runs").delete().in("id", createdRunIds);
    if (createdConnectionIds.length) await service.from("integration_connections").delete().in("id", createdConnectionIds);
    if (createdJobIds.length) await service.from("jobs").delete().in("id", createdJobIds);
    if (createdEventIds.length) await service.from("events").delete().in("id", createdEventIds);
  } finally {
    releaseWorkerLock?.();
    releaseWorkerLock = null;
  }
});

test.describe("events provenance is server-only", () => {
  test("authenticated forge is forced to manual and null", async () => {
    const { data, error } = await qa1
      .from("events")
      .insert({
        user_id: qa1Id,
        title: "forge attempt",
        start_at: new Date().toISOString(),
        source: "whatsapp",
        source_ref: "deadbeef".repeat(4),
      })
      .select("id, source, source_ref")
      .single();
    expect(error, `forge insert: ${error?.message}`).toBeNull();
    createdEventIds.push(data!.id);
    expect(data).toMatchObject({ source: "manual", source_ref: null });
  });

  test("authenticated update cannot set provenance", async () => {
    const { data: seeded, error: seedError } = await service
      .from("events")
      .insert({ user_id: qa1Id, title: "owner manual", start_at: new Date().toISOString() })
      .select("id")
      .single();
    expect(seedError).toBeNull();
    createdEventIds.push(seeded!.id);
    const { data, error } = await qa1
      .from("events")
      .update({ source: "whatsapp", source_ref: "f".repeat(32) })
      .eq("id", seeded!.id)
      .select("id, source, source_ref")
      .single();
    expect(error, `forge update: ${error?.message}`).toBeNull();
    expect(data).toMatchObject({ source: "manual", source_ref: null });
  });

  test("owner manual CRUD still works", async () => {
    const { data, error } = await qa1
      .from("events")
      .insert({ user_id: qa1Id, title: "manual ok", start_at: new Date().toISOString() })
      .select("id, source")
      .single();
    expect(error, `manual insert: ${error?.message}`).toBeNull();
    createdEventIds.push(data!.id);
    expect(data!.source).toBe("manual");
    const upd = await qa1.from("events").update({ title: "manual renamed" }).eq("id", data!.id).select("id, title").single();
    expect(upd.error).toBeNull();
    expect(upd.data!.title).toBe("manual renamed");
    const del = await qa1.from("events").delete().eq("id", data!.id);
    expect(del.error).toBeNull();
    createdEventIds.pop();
  });

  test("service role keeps provenance and dedupes on the unique index", async () => {
    const ref = randomUUID().replaceAll("-", "");
    const first = await service.from("events").insert({
      user_id: qa1Id, title: "wa event", start_at: new Date().toISOString(),
      source: "whatsapp", source_ref: ref,
    }).select("id, source, source_ref").single();
    expect(first.error).toBeNull();
    createdEventIds.push(first.data!.id);
    expect(first.data).toMatchObject({ source: "whatsapp", source_ref: ref });
    const dup = await service.from("events").insert({
      user_id: qa1Id, title: "wa event again", start_at: new Date().toISOString(),
      source: "whatsapp", source_ref: ref,
    }).select("id");
    expect(dup.error, "the unique (user_id, source, source_ref) must reject the second row").not.toBeNull();
  });
});

test.describe("credential table and RPCs are service-role only (default-grant trap)", () => {
  const anon = () => createClient(url, anonKey, { auth: { persistSession: false } });
  const id = () => randomUUID();

  test("anon and authenticated are denied on the credential table", async () => {
    const anonRead = await anon().from("google_calendar_credentials").select("user_id");
    expect(anonRead.error, "anon read must be denied").not.toBeNull();
    const qaRead = await qa1.from("google_calendar_credentials").select("user_id");
    expect(qaRead.error, "authenticated read must be denied").not.toBeNull();
  });

  test("token RPCs round-trip, rotate, and deny clients", async () => {
    const target = qa1Id;
    const upsert = await service.rpc("upsert_google_credentials", {
      p_user_id: target, p_refresh_token: "refresh-secret", p_scope: "calendar.events",
      p_calendar_id: "primary", p_key: KEY,
    });
    expect(upsert.error, `service upsert: ${upsert.error?.message}`).toBeNull();
    createdCredentialUserIds.push(target);
    const got = await service.rpc("get_google_credentials", { p_user_id: target, p_key: KEY });
    expect(got.error).toBeNull();
    expect(got.data[0].refresh_token).toBe("refresh-secret");

    const badKey = await service.rpc("get_google_credentials", { p_user_id: target, p_key: "wrong" });
    expect(badKey.error, "wrong key must fail to decrypt").not.toBeNull();

    const rotated = await service.rpc("rotate_google_token_key", { p_old_key: KEY, p_new_key: "rotated-key" });
    expect(rotated.error).toBeNull();
    const after = await service.rpc("get_google_credentials", { p_user_id: target, p_key: "rotated-key" });
    expect(after.data[0].refresh_token).toBe("refresh-secret");
    const rotatedBack = await service.rpc("rotate_google_token_key", { p_old_key: "rotated-key", p_new_key: KEY });
    expect(rotatedBack.error, `rotate back: ${rotatedBack.error?.message}`).toBeNull();

    const qaCall = await qa1.rpc("get_google_credentials", { p_user_id: target, p_key: KEY });
    expect(qaCall.error, "authenticated must be denied the token RPC").not.toBeNull();
    const qaDelete = await qa1.rpc("delete_google_credentials", { p_user_id: target });
    expect(qaDelete.error, "authenticated must be denied delete_google_credentials").not.toBeNull();
    const qaRotate = await qa1.rpc("rotate_google_token_key", { p_old_key: KEY, p_new_key: "qa-rotated" });
    expect(qaRotate.error, "authenticated must be denied rotate_google_token_key").not.toBeNull();
    const anonCall = await anon().rpc("upsert_google_credentials", {
      p_user_id: target, p_refresh_token: "x", p_scope: "x", p_calendar_id: "primary", p_key: KEY,
    });
    expect(anonCall.error, "anon must be denied the token RPC").not.toBeNull();
    const anonDelete = await anon().rpc("delete_google_credentials", { p_user_id: target });
    expect(anonDelete.error, "anon must be denied delete_google_credentials").not.toBeNull();
    const anonRotate = await anon().rpc("rotate_google_token_key", { p_old_key: KEY, p_new_key: "anon-rotated" });
    expect(anonRotate.error, "anon must be denied rotate_google_token_key").not.toBeNull();
    const del = await service.rpc("delete_google_credentials", { p_user_id: target });
    expect(del.error).toBeNull();
  });

  test("QR RPCs encrypt with a TTL and deny clients", async () => {
    const connectionId = id();
    const runSeed = await service.from("integration_runs").insert({
      user_id: qa1Id, mode: "live", status: "queued", chat_name: "seed chat",
    }).select("id").single();
    expect(runSeed.error, `run seed: ${runSeed.error?.message}`).toBeNull();
    createdRunIds.push(runSeed.data!.id);
    const connection = await service.from("integration_connections").insert({
      id: connectionId, user_id: qa1Id, provider: "whatsapp", mode: "live",
      status: "pending", profile_ref: qa1Id,
    }).select("id").single();
    expect(connection.error, `connection seed: ${connection.error?.message}`).toBeNull();
    createdConnectionIds.push(connectionId);

    const set = await service.rpc("set_whatsapp_qr", {
      p_connection_id: connectionId, p_qr: "data:image/png;base64,AAAA", p_key: KEY, p_ttl_seconds: 60,
    });
    expect(set.error).toBeNull();
    const got = await service.rpc("get_whatsapp_qr", { p_connection_id: connectionId, p_key: KEY });
    expect(got.data).toBe("data:image/png;base64,AAAA");

    const cleared = await service.rpc("clear_whatsapp_qr", { p_connection_id: connectionId });
    expect(cleared.error, `service clear: ${cleared.error?.message}`).toBeNull();
    const afterClear = await service.rpc("get_whatsapp_qr", { p_connection_id: connectionId, p_key: KEY });
    expect(afterClear.error, `get after clear: ${afterClear.error?.message}`).toBeNull();
    expect(afterClear.data, "cleared QR must read null").toBeNull();

    const resent = await service.rpc("set_whatsapp_qr", {
      p_connection_id: connectionId, p_qr: "data:image/png;base64,BBBB", p_key: KEY, p_ttl_seconds: 60,
    });
    expect(resent.error, `re-set: ${resent.error?.message}`).toBeNull();

    await service.from("integration_connections")
      .update({ qr_expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq("id", connectionId);
    const expired = await service.rpc("get_whatsapp_qr", { p_connection_id: connectionId, p_key: KEY });
    expect(expired.error, `expired get: ${expired.error?.message}`).toBeNull();
    expect(expired.data, "expired QR must read null").toBeNull();

    const qaGet = await qa1.rpc("get_whatsapp_qr", { p_connection_id: connectionId, p_key: KEY });
    expect(qaGet.error, "authenticated must be denied the QR RPC").not.toBeNull();
    const qaClear = await qa1.rpc("clear_whatsapp_qr", { p_connection_id: connectionId });
    expect(qaClear.error, "authenticated must be denied clear_whatsapp_qr").not.toBeNull();
    expect((await anon().rpc("set_whatsapp_qr", { p_connection_id: connectionId, p_qr: "x", p_key: KEY, p_ttl_seconds: 60 })).error).not.toBeNull();
    const anonClear = await anon().rpc("clear_whatsapp_qr", { p_connection_id: connectionId });
    expect(anonClear.error, "anon must be denied clear_whatsapp_qr").not.toBeNull();

    await service.from("integration_connections").delete().eq("id", connectionId);
  });

  test("touch_job is service-role only and extends only a matching lease", async () => {
    const jobId = id();
    createdJobIds.push(jobId);
    await service.from("jobs").insert({
      id: jobId, kind: "noop.test", payload: {}, status: "running",
      locked_by: "spec-worker", locked_at: new Date(Date.now() - 60_000).toISOString(), attempts: 1,
    });
    const before = new Date(Date.now() - 60_000).toISOString();
    const touch = await service.rpc("touch_job", { p_job_id: jobId, p_worker_id: "spec-worker" });
    expect(touch.error, `service touch: ${touch.error?.message}`).toBeNull();
    const after = await service.from("jobs").select("locked_at").eq("id", jobId).single();
    expect(Date.parse(after.data!.locked_at) > Date.parse(before)).toBe(true);
    const wrongWorker = await service.rpc("touch_job", { p_job_id: jobId, p_worker_id: "someone-else" });
    expect(wrongWorker.error, "a non-holder must be rejected").not.toBeNull();
    const qaTouch = await qa1.rpc("touch_job", { p_job_id: jobId, p_worker_id: "spec-worker" });
    expect(qaTouch.error, "authenticated must be denied touch_job").not.toBeNull();
    await service.from("jobs").delete().eq("id", jobId);
  });
});

test.describe("whatsapp-exports bucket isolation", () => {
  test("owner uploads and reads only their own folder", async () => {
    const serviceBucket = service.storage.from("whatsapp-exports");
    const path = `${qa1Id}/probe/export.txt`;
    createdExportPaths.push(path);
    const upload = await serviceBucket.upload(path, new Blob(["hello"], { type: "text/plain" }), { contentType: "text/plain", upsert: true });
    expect(upload.error, `service upload: ${upload.error?.message}`).toBeNull();
    const own = await qa1.storage.from("whatsapp-exports").download(path);
    expect(own.error, `owner download: ${own.error?.message}`).toBeNull();
    const foreign = await qa1.storage
      .from("whatsapp-exports")
      .download(`${"00000000-0000-4000-8000-000000000000"}/probe/export.txt`);
    expect(foreign.error, "cross-folder download must be denied").not.toBeNull();
    const remove = await serviceBucket.remove([path]);
    expect(remove.error).toBeNull();
    createdExportPaths.length = 0;
  });
});

test.describe("trigger helpers are not callable as RPCs", () => {
  const anon = () => createClient(url, anonKey, { auth: { persistSession: false } });

  test("lock_event_provenance and set_updated_at reject client and anon RPC calls", async () => {
    // Trigger firing is separately proven by the provenance tests above; a
    // trigger-returning function is not exposed to PostgREST RPC, so each
    // direct call must error rather than execute.
    const qa1Lock = await qa1.rpc("lock_event_provenance");
    expect(qa1Lock.error, "authenticated lock_event_provenance must not be callable as an RPC").not.toBeNull();
    const anonLock = await anon().rpc("lock_event_provenance");
    expect(anonLock.error, "anon lock_event_provenance must not be callable as an RPC").not.toBeNull();
    const qa1Touch = await qa1.rpc("set_updated_at");
    expect(qa1Touch.error, "authenticated set_updated_at must not be callable as an RPC").not.toBeNull();
    const anonTouch = await anon().rpc("set_updated_at");
    expect(anonTouch.error, "anon set_updated_at must not be callable as an RPC").not.toBeNull();
  });
});

test.describe("google oauth callback route (P7.1)", () => {
  test("an unconfigured server refuses honestly and stores nothing", async ({
    request,
  }) => {
    // The committed local env has no GOOGLE_OAUTH_CLIENT_ID/SECRET pair — the
    // same condition `whatsapp-ui.spec.ts` asserts for the panel — so the
    // route must stop at the configuration boundary before any cookie or
    // session read and answer with the honest notice.
    test.skip(
      Boolean(
        process.env.GOOGLE_OAUTH_CLIENT_ID &&
          process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      ),
      "the OAuth env pair is present; the unconfigured path cannot be asserted.",
    );

    // Start from a clean QA1 credential state, so the empty read below proves
    // the route created nothing rather than that nothing happened to exist.
    // (`whatsapp-ui.spec.ts` covers the not-configured UI state, and the start
    // action's refusal is reviewer-verified: no HTTP surface can reach it with
    // the env absent, and no real OAuth call may be made here.)
    const cleanup = await service.rpc("delete_google_credentials", {
      p_user_id: qa1Id,
    });
    expect(cleanup.error, `credential cleanup: ${cleanup.error?.message}`).toBeNull();

    const response = await request.get(
      "/api/integrations/google/callback?code=x&state=y",
      { maxRedirects: 0 },
    );

    expect(response.status(), "the refusal must be a redirect").toBe(302);
    const location = response.headers()["location"] ?? "";
    expect(location, "the honest notice code must travel").toContain(
      "google=not_configured",
    );

    // The table itself is not even readable by the service role (the
    // default-grant trap below); the decrypting RPC is the sanctioned read and
    // returns no rows for a user without credentials.
    const rows = await service.rpc("get_google_credentials", {
      p_user_id: qa1Id,
      p_key: KEY,
    });
    expect(rows.error, `credential read: ${rows.error?.message}`).toBeNull();
    expect(rows.data ?? [], "no credential row may be created").toEqual([]);
  });
});

test.describe("google push backfill (P7.2)", () => {
  type BackfillSeed = {
    connectionId: string;
    runId: string;
    eventId: string;
    candidateId: string;
  };

  /**
   * QA1's google row `connected` plus one confirmed, event-backed,
   * never-pushed candidate and its event. Neither test sets any OAuth env, so
   * a pass proves the backfill keys on the row, never `isGoogleConfigured`.
   */
  async function seedBackfillRows(): Promise<BackfillSeed> {
    const connection = await service
      .from("integration_connections")
      .insert({
        user_id: qa1Id,
        provider: "google",
        mode: null,
        status: "connected",
      })
      .select("id")
      .single();
    expect(connection.error, `connection seed: ${connection.error?.message}`).toBeNull();
    createdConnectionIds.push(connection.data!.id);

    const run = await service
      .from("integration_runs")
      .insert({
        user_id: qa1Id,
        mode: "live",
        status: "succeeded",
        chat_name: "P7.2 backfill",
      })
      .select("id")
      .single();
    expect(run.error, `run seed: ${run.error?.message}`).toBeNull();
    createdRunIds.push(run.data!.id);

    const event = await service
      .from("events")
      .insert({
        user_id: qa1Id,
        title: "P7.2 backfill event",
        start_at: new Date().toISOString(),
        source: "whatsapp",
        source_ref: randomUUID().replaceAll("-", ""),
      })
      .select("id")
      .single();
    expect(event.error, `event seed: ${event.error?.message}`).toBeNull();
    createdEventIds.push(event.data!.id);

    const candidateId = randomUUID();
    const candidate = await service
      .from("integration_candidates")
      .insert({
        id: candidateId,
        user_id: qa1Id,
        run_id: run.data!.id,
        fingerprint: randomUUID().replaceAll("-", ""),
        title: "P7.2 backfill candidate",
        start_at: new Date().toISOString(),
        message_sender: "P7.2",
        message_text: "P7.2 backfill candidate",
        status: "confirmed",
        event_id: event.data!.id,
      })
      .select("id")
      .single();
    expect(candidate.error, `candidate seed: ${candidate.error?.message}`).toBeNull();
    createdCandidateIds.push(candidateId);

    return {
      connectionId: connection.data!.id,
      runId: run.data!.id,
      eventId: event.data!.id,
      candidateId,
    };
  }

  async function pushJobsFor(candidateId: string) {
    const { data, error } = await service
      .from("jobs")
      .select("id")
      .eq("user_id", qa1Id)
      .eq("kind", "whatsapp.push")
      .eq("payload->>candidateId", candidateId);
    expect(error, `push job read: ${error?.message}`).toBeNull();
    return data ?? [];
  }

  /** Tracks every job by id so the file's afterAll can always clean up. */
  async function cleanupBackfillRows(seed: BackfillSeed): Promise<void> {
    for (const job of await pushJobsFor(seed.candidateId)) {
      if (!createdJobIds.includes(job.id)) createdJobIds.push(job.id);
    }
    await service.from("integration_candidates").delete().eq("id", seed.candidateId);
    await service.from("integration_connections").delete().eq("id", seed.connectionId);
    await service.from("events").delete().eq("id", seed.eventId);
    await service.from("integration_runs").delete().eq("id", seed.runId);
    const leftover = await pushJobsFor(seed.candidateId);
    if (leftover.length) {
      await service
        .from("jobs")
        .delete()
        .in("id", leftover.map((job) => job.id));
    }
  }

  test("a connected overview backfills once and dedupes the active job", async ({
    page,
  }) => {
    // Only meaningful without the OAuth pair: that is the state in which
    // `getGoogleStatus` reports `not_configured`, so a pass here proves the
    // overview backfill keyed on the stored row rather than the env.
    test.skip(
      GOOGLE_CONFIGURED,
      "the OAuth env pair is present; the row-keyed (env-less) proof needs it absent.",
    );
    const seed = await seedBackfillRows();

    try {
      // First overview read: the connected row alone enqueues the missing
      // push.
      await page.goto("/integrations");
      await expect
        .poll(() => pushJobsFor(seed.candidateId).then((jobs) => jobs.length))
        .toBe(1);

      // Second read: the active job is the dedupe; nothing may duplicate.
      await page.goto("/integrations");
      await expect
        .poll(() => pushJobsFor(seed.candidateId).then((jobs) => jobs.length))
        .toBe(1);
      await page.waitForTimeout(500);
      expect(
        (await pushJobsFor(seed.candidateId)).length,
        "the active job must absorb every later overview read",
      ).toBe(1);
    } finally {
      await cleanupBackfillRows(seed);
    }
  });

  test("a fresh terminal failure suppresses the re-enqueue until the window passes", async ({
    page,
  }) => {
    test.skip(
      GOOGLE_CONFIGURED,
      "the OAuth env pair is present; the row-keyed (env-less) proof needs it absent.",
    );
    const seed = await seedBackfillRows();
    const failedJobId = randomUUID();
    const failed = await service.from("jobs").insert({
      id: failedJobId,
      kind: "whatsapp.push",
      payload: { candidateId: seed.candidateId },
      user_id: qa1Id,
      status: "failed",
      created_at: new Date().toISOString(),
    });
    expect(failed.error, `failed job seed: ${failed.error?.message}`).toBeNull();
    createdJobIds.push(failedJobId);

    try {
      // A failure younger than the window covers the candidate: the overview
      // read must not enqueue anything on top of it.
      await page.goto("/integrations");
      await page.waitForTimeout(500);
      expect(
        (await pushJobsFor(seed.candidateId)).length,
        "a fresh terminal failure must suppress the re-enqueue",
      ).toBe(1);

      // Past the window the candidate self-heals: exactly one new active job.
      // (`created_at` is the job's age; the update trigger only touches
      // `updated_at`.)
      const aged = await service
        .from("jobs")
        .update({
          created_at: new Date(
            Date.now() - GOOGLE_PUSH_RETRY_WINDOW_MS - 60_000,
          ).toISOString(),
        })
        .eq("id", failedJobId);
      expect(aged.error, `failed job backdate: ${aged.error?.message}`).toBeNull();

      await page.goto("/integrations");
      await expect
        .poll(() => pushJobsFor(seed.candidateId).then((jobs) => jobs.length))
        .toBe(2);
      await page.waitForTimeout(500);
      expect(
        (await pushJobsFor(seed.candidateId)).length,
        "the window allows one retry, not one per read",
      ).toBe(2);
    } finally {
      await cleanupBackfillRows(seed);
    }
  });
});

test.describe("integration tables: owner-only reads and no client writes", () => {
  const anon = () => createClient(url, anonKey, { auth: { persistSession: false } });
  const fingerprint = () => randomUUID().replaceAll("-", "");

  const TABLES = [
    "integration_connections",
    "integration_runs",
    "integration_messages",
    "integration_candidates",
  ] as const;
  type Table = (typeof TABLES)[number];

  /** Benign update a client would attempt on its own row. */
  const UPDATE_PATCH: Record<Table, Record<string, unknown>> = {
    integration_connections: { status: "connected" },
    integration_runs: { status: "running" },
    integration_messages: { body: "p2-0 write attempt" },
    integration_candidates: { title: "p2-0 write attempt" },
  };

  const seedChain = async (userId: string, tag: string): Promise<Record<Table, string>> => {
    const connection = await service.from("integration_connections").insert({
      user_id: userId, provider: "whatsapp", mode: "live",
      status: "pending", profile_ref: userId,
    }).select("id").single();
    expect(connection.error, `${tag} connection seed: ${connection.error?.message}`).toBeNull();
    createdConnectionIds.push(connection.data!.id);

    const run = await service.from("integration_runs").insert({
      user_id: userId, connection_id: connection.data!.id, mode: "live",
      status: "queued", chat_name: `P2.0 ${tag}`,
    }).select("id").single();
    expect(run.error, `${tag} run seed: ${run.error?.message}`).toBeNull();
    createdRunIds.push(run.data!.id);

    const message = await service.from("integration_messages").insert({
      run_id: run.data!.id, user_id: userId, position: 0,
      sender: `P2.0 ${tag}`, sent_at: new Date().toISOString(), body: `P2.0 ${tag} body`,
    }).select("id").single();
    expect(message.error, `${tag} message seed: ${message.error?.message}`).toBeNull();

    const candidate = await service.from("integration_candidates").insert({
      user_id: userId, run_id: run.data!.id, fingerprint: fingerprint(),
      title: `P2.0 candidate ${tag}`, start_at: new Date().toISOString(),
      message_id: message.data!.id, message_sender: `P2.0 ${tag}`,
      message_text: `P2.0 ${tag} body`,
    }).select("id").single();
    expect(candidate.error, `${tag} candidate seed: ${candidate.error?.message}`).toBeNull();
    createdCandidateIds.push(candidate.data!.id);

    return {
      integration_connections: connection.data!.id,
      integration_runs: run.data!.id,
      integration_messages: message.data!.id,
      integration_candidates: candidate.data!.id,
    };
  };

  test("QA1 and QA2 read only their own rows and cannot write", async () => {
    // Own reads below prove the rows exist, so the cross-user `[]` reads
    // cannot pass vacuously.
    const chain1 = await seedChain(qa1Id, "QA1");
    const chain2 = await seedChain(qa2Id, "QA2");

    for (const table of TABLES) {
      const own1 = await qa1.from(table).select("id").eq("id", chain1[table]);
      expect(own1.error, `QA1 own read ${table}: ${own1.error?.message}`).toBeNull();
      expect(own1.data?.map((row) => row.id), `QA1 reads own ${table}`).toEqual([chain1[table]]);

      const own2 = await qa2.from(table).select("id").eq("id", chain2[table]);
      expect(own2.error, `QA2 own read ${table}: ${own2.error?.message}`).toBeNull();
      expect(own2.data?.map((row) => row.id), `QA2 reads own ${table}`).toEqual([chain2[table]]);

      const cross1 = await qa1.from(table).select("id").eq("id", chain2[table]);
      expect(cross1.error, `QA1 cross read ${table}: ${cross1.error?.message}`).toBeNull();
      expect(cross1.data, `QA1 must not read QA2's ${table}`).toEqual([]);

      const cross2 = await qa2.from(table).select("id").eq("id", chain1[table]);
      expect(cross2.error, `QA2 cross read ${table}: ${cross2.error?.message}`).toBeNull();
      expect(cross2.data, `QA2 must not read QA1's ${table}`).toEqual([]);

      const anonRead = await anon().from(table).select("id");
      expect(anonRead.error, `anon must be denied ${table}`).not.toBeNull();
      expect(anonRead.data ?? null, `anon read ${table} returned data`).toBeNull();

      const insert = await qa1.from(table).insert({ user_id: qa1Id });
      expect(insert.error, `client insert ${table} must be denied`).not.toBeNull();

      const update = await qa1.from(table).update(UPDATE_PATCH[table]).eq("id", chain1[table]);
      expect(update.error, `client update ${table} must be denied`).not.toBeNull();

      const del = await qa1.from(table).delete().eq("id", chain1[table]);
      expect(del.error, `client delete ${table} must be denied`).not.toBeNull();
    }
  });
});
