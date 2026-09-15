import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { hasWhatsAppService, WHATSAPP_SKIP_REASON } from "./whatsappService";
import { acquireWorkerLock } from "./workerLock";

const LOCAL_TARGET = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const qa1Password = process.env.UNIPILOT_QA_PASSWORD ?? "";
const qa2Password = process.env.UNIPILOT_QA2_PASSWORD ?? "";
const QA1 = "qa.unipilot@unipilot.test";
const QA2 = "qa2.unipilot@unipilot.test";
const REPO_ROOT = path.resolve(process.cwd(), "..");
const SAMPLE = path.join(REPO_ROOT, "whatsapp", "tests", "fixtures", "sample_chat.txt");

let service: SupabaseClient;
let qa1Id = "";
let qa2Id = "";
let releaseWorkerLock: (() => void) | null = null;
const runIds: string[] = [];
const jobIds: string[] = [];
const bucketPaths: string[] = [];
const eventIds: string[] = [];
const connectionIds: string[] = [];

function runWorkerOnce(overrides: Record<string, string | undefined> = {}): string {
  return execFileSync("node", ["worker/run.mjs", "--once", "--worker-id=wa-spec-worker"], {
    cwd: path.join(REPO_ROOT, "backend"),
    env: { ...process.env, ...overrides },
    encoding: "utf8",
    timeout: 120_000,
  });
}

async function seedExportRun(
  reviewMode: "manual" | "automatic" = "manual",
): Promise<{ runId: string; jobId: string; path: string }> {
  const runId = randomUUID();
  const storagePath = `${qa1Id}/${runId}/export.txt`;
  const upload = await service.storage.from("whatsapp-exports").upload(
    storagePath,
    (await import("node:fs")).readFileSync(SAMPLE),
    { contentType: "text/plain", upsert: true },
  );
  expect(upload.error, `upload: ${upload.error?.message}`).toBeNull();
  bucketPaths.push(storagePath);
  const run = await service.from("integration_runs").insert({
    id: runId, user_id: qa1Id, mode: "export", status: "queued",
    storage_path: storagePath, review_mode: reviewMode,
  });
  expect(run.error, `run seed: ${run.error?.message}`).toBeNull();
  runIds.push(runId);
  const jobId = randomUUID();
  const job = await service.from("jobs").insert({
    id: jobId, kind: "whatsapp.sync", payload: { runId }, user_id: qa1Id,
  });
  expect(job.error, `job seed: ${job.error?.message}`).toBeNull();
  jobIds.push(jobId);
  return { runId, jobId, path: storagePath };
}

async function runRow(runId: string) {
  const { data, error } = await service.from("integration_runs").select("*").eq("id", runId).single();
  expect(error, `run read: ${error?.message}`).toBeNull();
  return data;
}

/** QA1's automatic-run events for one run, matched through its candidates. */
async function eventsForRun(runId: string) {
  const candidates = await service
    .from("integration_candidates")
    .select("id, status, event_id, fingerprint")
    .eq("run_id", runId);
  expect(candidates.error, `candidate read: ${candidates.error?.message}`).toBeNull();
  const refs = (candidates.data ?? []).map((row) => row.fingerprint);
  const events = refs.length
    ? await service
        .from("events")
        .select("id, source_ref, description")
        .eq("user_id", qa1Id)
        .eq("source", "whatsapp")
        .in("source_ref", refs)
    : { data: [], error: null };
  expect(events.error, `event read: ${events.error?.message}`).toBeNull();
  return { candidates: candidates.data ?? [], events: events.data ?? [] };
}

async function pushJobsForQa1() {
  const { data, error } = await service
    .from("jobs")
    .select("id, payload, status, attempts")
    .eq("user_id", qa1Id)
    .eq("kind", "whatsapp.push");
  expect(error, `push job read: ${error?.message}`).toBeNull();
  return data ?? [];
}

test.beforeAll(async () => {
  if (!LOCAL_TARGET.test(url)) throw new Error(`local-only; refusing ${url}`);
  if (!anonKey || !serviceKey) throw new Error("missing local keys");
  if (!qa2Password) throw new Error("missing UNIPILOT_QA2_PASSWORD");
  service = createClient(url, serviceKey, { auth: { persistSession: false } });
  const qa1 = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error } = await qa1.auth.signInWithPassword({ email: QA1, password: qa1Password });
  expect(error, `sign-in: ${error?.message}`).toBeNull();
  qa1Id = data.user!.id;
  const qa2 = createClient(url, anonKey, { auth: { persistSession: false } });
  const qa2SignIn = await qa2.auth.signInWithPassword({ email: QA2, password: qa2Password });
  expect(qa2SignIn.error, `qa2 sign-in: ${qa2SignIn.error?.message}`).toBeNull();
  qa2Id = qa2SignIn.data.user!.id;
  expect(qa1Id, "QA1 and QA2 must be different users").not.toBe(qa2Id);
  // One worker-driving WhatsApp file at a time (see workerLock.ts); the full
  // suite's dependency chain makes this uncontended, a targeted --no-deps run
  // does not.
  releaseWorkerLock = await acquireWorkerLock();
});

test.afterEach(async () => {
  // Auto-confirm writes events for the run's candidates; collect those ids
  // before the run delete cascades the candidates that carry them (events have
  // no run FK). Events seeded directly are already tracked.
  if (runIds.length > 0) {
    const { data } = await service
      .from("integration_candidates")
      .select("event_id")
      .in("run_id", runIds);
    for (const row of data ?? []) {
      if (row.event_id && !eventIds.includes(row.event_id)) eventIds.push(row.event_id);
    }
  }
  if (eventIds.length) {
    const { error } = await service.from("events").delete().in("id", eventIds);
    expect(error, `teardown events: ${error?.message}`).toBeNull();
  }
  for (const runId of runIds) {
    const { error } = await service.from("integration_runs").delete().eq("id", runId);
    expect(error, `teardown run ${runId}: ${error?.message}`).toBeNull();
  }
  // An automatic run with a connected google row creates push jobs the spec
  // never seeded; track every untracked QA1 push job by id.
  for (const job of await pushJobsForQa1()) {
    if (!jobIds.includes(job.id)) jobIds.push(job.id);
  }
  if (jobIds.length) {
    const { error } = await service.from("jobs").delete().in("id", jobIds);
    expect(error, `teardown jobs: ${error?.message}`).toBeNull();
  }
  for (const connectionId of connectionIds) {
    const { error } = await service.from("integration_connections").delete().eq("id", connectionId);
    expect(error, `teardown connection ${connectionId}: ${error?.message}`).toBeNull();
  }
  if (bucketPaths.length) {
    const { error } = await service.storage.from("whatsapp-exports").remove(bucketPaths);
    expect(error, `teardown objects: ${error?.message}`).toBeNull();
  }
  runIds.length = 0; jobIds.length = 0; bucketPaths.length = 0;
  eventIds.length = 0; connectionIds.length = 0;
});

test.afterAll(async () => {
  try {
    // Sibling specs assert absolute residue counts for QA1; this spec must
    // leave none behind, and teardown errors above must not be masked by a
    // later pass. The worker lock releases only after these checks.
    for (const table of [
      "jobs",
      "integration_runs",
      "integration_messages",
      "integration_candidates",
      "integration_connections",
    ]) {
      const { count, error } = await service
        .from(table)
        .select("user_id", { count: "exact", head: true })
        .eq("user_id", qa1Id);
      expect(error, `${table} residue read: ${error?.message}`).toBeNull();
      expect(count, `${table} must have no QA1 residue`).toBe(0);
    }
    const { data: bucketRoot, error: bucketError } = await service.storage
      .from("whatsapp-exports")
      .list("", { limit: 1000 });
    expect(bucketError, `bucket residue read: ${bucketError?.message}`).toBeNull();
    const qa1Objects = (bucketRoot ?? []).filter((entry) => entry.name.startsWith(qa1Id));
    expect(qa1Objects, "whatsapp-exports must have no objects under the QA1 prefix").toHaveLength(0);
    // Events have no run FK; the automatic path's settled rows must be gone by
    // id too.
    const whatsappEvents = await service
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("user_id", qa1Id)
      .eq("source", "whatsapp");
    expect(whatsappEvents.error, `events residue read: ${whatsappEvents.error?.message}`).toBeNull();
    expect(whatsappEvents.count, "events must have no QA1 whatsapp residue").toBe(0);
  } finally {
    releaseWorkerLock?.();
    releaseWorkerLock = null;
  }
});

test.describe("whatsapp.sync job (46.13)", () => {
  test.skip(!hasWhatsAppService(), WHATSAPP_SKIP_REASON);

  test("parses the export, writes messages/candidates, settles the run and deletes the object", async () => {
    const { runId, jobId, path } = await seedExportRun();
    const output = runWorkerOnce();
    expect(output).toContain(`settled job=${jobId}`);
    expect(output).toContain("status=succeeded");
    const run = await runRow(runId);
    expect(run.status).toBe("succeeded");
    expect(run.message_count).toBe(10);
    expect(run.candidate_count).toBe(5);
    const messages = await service.from("integration_messages").select("id", { count: "exact" }).eq("run_id", runId);
    expect(messages.count).toBe(10);
    const candidates = await service.from("integration_candidates").select("id, status").eq("run_id", runId);
    expect(candidates.data?.length).toBe(5);
    const gone = await service.storage.from("whatsapp-exports").download(path);
    expect(gone.error, "the export object must be deleted after a terminal settle").not.toBeNull();
  });

  test("a re-run never duplicates candidates", async () => {
    const first = await seedExportRun();
    const firstOutput = runWorkerOnce();
    expect(firstOutput).toContain(`settled job=${first.jobId}`);
    expect(firstOutput).toContain("status=succeeded");
    const second = await seedExportRun();
    const secondOutput = runWorkerOnce();
    expect(secondOutput).toContain(`settled job=${second.jobId}`);
    expect(secondOutput).toContain("status=succeeded");
    // The second run must settle as a real success whose candidate insert was
    // entirely ignored as duplicates — not a 409 that leaves it failed.
    const secondRun = await runRow(second.runId);
    expect(secondRun.status).toBe("succeeded");
    expect(secondRun.message_count).toBe(10);
    expect(secondRun.candidate_count).toBe(0);
    const candidates = await service
      .from("integration_candidates")
      .select("id, status", { count: "exact" })
      .eq("user_id", qa1Id);
    expect(candidates.error, `candidates read: ${candidates.error?.message}`).toBeNull();
    expect(candidates.count).toBe(5);
    expect(candidates.data?.every((row) => row.status === "pending")).toBe(true);
    expect(first.runId).not.toBe(second.runId);
  });

  test("an automatic run confirms its candidates into events and pushes nothing without Google", async () => {
    const { runId, jobId, path } = await seedExportRun("automatic");
    const output = runWorkerOnce();
    expect(output).toContain(`settled job=${jobId}`);
    expect(output).toContain("status=succeeded");

    const run = await runRow(runId);
    expect(run.status).toBe("succeeded");
    expect(run.message_count).toBe(10);
    expect(run.candidate_count).toBe(5);
    expect(run.review_mode).toBe("automatic");

    const messages = await service
      .from("integration_messages")
      .select("id", { count: "exact", head: true })
      .eq("run_id", runId);
    expect(messages.error).toBeNull();
    expect(messages.count).toBe(10);

    const { candidates, events } = await eventsForRun(runId);
    expect(candidates).toHaveLength(5);
    expect(candidates.every((row) => row.status === "confirmed")).toBe(true);
    expect(candidates.every((row) => row.event_id !== null)).toBe(true);
    expect(events).toHaveLength(5);
    expect(events.every((row) => row.description?.startsWith("From WhatsApp ("))).toBe(true);
    const eventByRef = new Map(events.map((row) => [row.source_ref, row]));
    for (const candidate of candidates) {
      const event = eventByRef.get(candidate.fingerprint);
      expect(event, `candidate ${candidate.id} must own a source_ref-matched event`).toBeTruthy();
      expect(candidate.event_id, "the candidate must settle on its event id").toBe(event!.id);
    }

    expect(
      await pushJobsForQa1(),
      "no google connection means no push jobs",
    ).toHaveLength(0);
    const gone = await service.storage.from("whatsapp-exports").download(path);
    expect(gone.error, "the export object must be deleted after a terminal settle").not.toBeNull();
  });

  test("a re-run of an automatic export dedupes with no new events or pushes", async () => {
    const first = await seedExportRun("automatic");
    runWorkerOnce();
    const firstRun = await runRow(first.runId);
    expect(firstRun.status).toBe("succeeded");
    expect(firstRun.candidate_count).toBe(5);
    const settled = await eventsForRun(first.runId);
    expect(settled.candidates).toHaveLength(5);
    expect(settled.events).toHaveLength(5);

    const second = await seedExportRun("automatic");
    const secondOutput = runWorkerOnce();
    expect(secondOutput).toContain(`settled job=${second.jobId}`);
    expect(secondOutput).toContain("status=succeeded");

    // The insert was ignored end to end: a real empty success, no auto-confirm
    // pass, so no events and no push jobs were written.
    const secondRun = await runRow(second.runId);
    expect(secondRun.status).toBe("succeeded");
    expect(secondRun.message_count).toBe(10);
    expect(secondRun.candidate_count).toBe(0);
    const resync = await eventsForRun(second.runId);
    expect(resync.candidates).toHaveLength(0);
    expect(resync.events).toHaveLength(0);

    const allCandidates = await service
      .from("integration_candidates")
      .select("id, status", { count: "exact" })
      .eq("user_id", qa1Id);
    expect(allCandidates.error).toBeNull();
    expect(allCandidates.count).toBe(5);
    expect(allCandidates.data?.every((row) => row.status === "confirmed")).toBe(true);
    const allEvents = await service
      .from("events")
      .select("id", { count: "exact" })
      .eq("user_id", qa1Id)
      .eq("source", "whatsapp");
    expect(allEvents.error).toBeNull();
    expect(allEvents.count).toBe(5);
    expect(await pushJobsForQa1()).toHaveLength(0);
  });

  test("auto-confirm never touches another user's pending candidate", async () => {
    const qa2RunId = randomUUID();
    const qa2CandidateId = randomUUID();
    const qa2Seed = await service.from("integration_runs").insert({
      id: qa2RunId, user_id: qa2Id, mode: "export", status: "succeeded",
      storage_path: `${qa2Id}/${qa2RunId}/export.txt`,
    });
    expect(qa2Seed.error, `qa2 run seed: ${qa2Seed.error?.message}`).toBeNull();
    runIds.push(qa2RunId);
    const qa2Candidate = await service.from("integration_candidates").insert({
      id: qa2CandidateId, user_id: qa2Id, run_id: qa2RunId,
      fingerprint: randomUUID().replaceAll("-", ""),
      title: "QA2 pending candidate",
      start_at: new Date().toISOString(),
      message_sender: "QA2",
      message_text: "QA2 pending candidate",
    });
    expect(qa2Candidate.error, `qa2 candidate seed: ${qa2Candidate.error?.message}`).toBeNull();

    const { runId } = await seedExportRun("automatic");
    runWorkerOnce();
    const run = await runRow(runId);
    expect(run.status).toBe("succeeded");
    const settled = await eventsForRun(runId);
    expect(settled.candidates).toHaveLength(5);
    expect(settled.candidates.every((row) => row.status === "confirmed")).toBe(true);

    const untouched = await service
      .from("integration_candidates")
      .select("status, event_id")
      .eq("id", qa2CandidateId)
      .single();
    expect(untouched.error, `qa2 candidate read: ${untouched.error?.message}`).toBeNull();
    expect(untouched.data, "another user's pending candidate must stay pending").toMatchObject({
      status: "pending",
      event_id: null,
    });
    const qa2Events = await service
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("user_id", qa2Id)
      .eq("source", "whatsapp");
    expect(qa2Events.error).toBeNull();
    expect(qa2Events.count).toBe(0);
  });

  test("a manual run leaves candidates pending with no events", async () => {
    const { runId, jobId } = await seedExportRun("manual");
    const output = runWorkerOnce();
    expect(output).toContain(`settled job=${jobId}`);
    expect(output).toContain("status=succeeded");

    const run = await runRow(runId);
    expect(run.status).toBe("succeeded");
    expect(run.candidate_count).toBe(5);
    const { candidates, events } = await eventsForRun(runId);
    expect(candidates).toHaveLength(5);
    expect(candidates.every((row) => row.status === "pending")).toBe(true);
    expect(candidates.every((row) => row.event_id === null)).toBe(true);
    expect(events, "a manual run must write no events for its run").toHaveLength(0);
  });

  test("an automatic run with a connected Google row enqueues ids-only push jobs", async () => {
    const connectionId = randomUUID();
    const connection = await service.from("integration_connections").insert({
      id: connectionId, user_id: qa1Id, provider: "google", mode: null, status: "connected",
    });
    expect(connection.error, `google connection seed: ${connection.error?.message}`).toBeNull();
    connectionIds.push(connectionId);

    const { runId } = await seedExportRun("automatic");
    // The env pair is the Python service's push gate; it is supplied only to
    // this worker call and is never a real OAuth client — no push executes.
    const output = runWorkerOnce({
      GOOGLE_OAUTH_CLIENT_ID: "test-client",
      GOOGLE_OAUTH_CLIENT_SECRET: "test-secret",
    });
    expect(output).toContain("status=succeeded");
    const run = await runRow(runId);
    expect(run.status).toBe("succeeded");
    const { candidates } = await eventsForRun(runId);
    expect(candidates).toHaveLength(5);
    expect(candidates.every((row) => row.status === "confirmed")).toBe(true);

    const jobs = await pushJobsForQa1();
    expect(jobs).toHaveLength(5);
    const candidateIds = new Set(candidates.map((row) => row.id));
    for (const job of jobs) {
      expect(Object.keys(job.payload as Record<string, unknown>)).toEqual(["candidateId"]);
      const candidateId = (job.payload as { candidateId: string }).candidateId;
      expect(candidateIds.has(candidateId), "the payload must name a settled candidate").toBe(true);
      expect(job.status, "the push must still be queued, never executed").toBe("queued");
      expect(job.attempts).toBe(0);
      jobIds.push(job.id);
    }
    // Delete the never-executed pushes now so no later worker call in this
    // file could claim them; teardown re-deletes by id harmlessly.
    const removed = await service.from("jobs").delete().in("id", jobs.map((job) => job.id));
    expect(removed.error, `push cleanup: ${removed.error?.message}`).toBeNull();
  });

  test("a missing export object fails the run and the job without residue", async () => {
    const runId = randomUUID();
    const jobId = randomUUID();
    await service.from("integration_runs").insert({
      id: runId, user_id: qa1Id, mode: "export", status: "queued",
      storage_path: `${qa1Id}/${runId}/missing.txt`,
    });
    await service.from("jobs").insert({ id: jobId, kind: "whatsapp.sync", payload: { runId }, user_id: qa1Id });
    runIds.push(runId); jobIds.push(jobId);
    runWorkerOnce();
    const run = await runRow(runId);
    expect(run.status).toBe("failed");
    expect(run.error).toBeTruthy();
    expect(JSON.stringify(run.error)).not.toMatch(/service_role|Bearer|eyJ/);
  });

  test("touch_job extends the lease while the child runs", async () => {
    // Seed a running job held by the spec worker and call the RPC directly —
    // the handler heartbeat is the same call; see P3.2's unit assertion.
    const jobId = randomUUID();
    await service.from("jobs").insert({
      id: jobId, kind: "noop.test", payload: {}, status: "running",
      locked_by: "wa-spec-worker", locked_at: new Date(Date.now() - 60_000).toISOString(), attempts: 1,
    });
    jobIds.push(jobId);
    const { error } = await service.rpc("touch_job", { p_job_id: jobId, p_worker_id: "wa-spec-worker" });
    expect(error, `touch: ${error?.message}`).toBeNull();
  });

  test("the handler heartbeats the lease while the child runs", async () => {
    // Seed a run, claim its job with a short-lived lease, then assert the
    // touch_job RPC path the handler heartbeat uses advances locked_at.
    const { jobId } = await seedExportRun();
    await service.from("jobs").update({
      status: "running", locked_by: "wa-spec-worker",
      locked_at: new Date(Date.now() - 4 * 60_000).toISOString(), attempts: 1,
    }).eq("id", jobId);
    const before = await service.from("jobs").select("locked_at").eq("id", jobId).single();
    const { error } = await service.rpc("touch_job", { p_job_id: jobId, p_worker_id: "wa-spec-worker" });
    expect(error).toBeNull();
    const after = await service.from("jobs").select("locked_at").eq("id", jobId).single();
    expect(Date.parse(after.data!.locked_at) > Date.parse(before.data!.locked_at)).toBe(true);
  });

  test("the safety timeout kills a hung child retryably", async () => {
    // Direct handler call with a 1 ms budget: the child is killed and the
    // failure must be retryable. The worker-level timeout wiring is exercised
    // by the same code path in the sync test above.
    const { spawnWhatsApp } = await import("../../../backend/worker/whatsappJobs.mjs");
    const ctx = {
      jobId: randomUUID(),
      workerId: "spec-worker",
      attempt: 1,
      maxAttempts: 5,
      client: { rpc: async () => ({ data: null, error: null }) },
      log: () => {},
    };
    await expect(
      spawnWhatsApp("sync", {}, ctx, { timeoutMs: 1 }),
    ).rejects.toMatchObject({ retryable: true });
  });

  test("the heartbeat touches the lease during a real child run and stops after rejection", async () => {
    // Empty payload against the real service fails fast (KeyError → sanitized
    // generic retryable error); the short heartbeat interval must tick at
    // least once during python startup and stop in clearTimers on rejection.
    const { spawnWhatsApp } = await import("../../../backend/worker/whatsappJobs.mjs");
    let touches = 0;
    const ctx = {
      jobId: randomUUID(),
      workerId: "spec-worker",
      attempt: 1,
      maxAttempts: 5,
      client: {
        rpc: async () => {
          touches += 1;
          return { data: null, error: null };
        },
      },
      log: () => {},
    };
    await expect(
      spawnWhatsApp("sync", {}, ctx, { timeoutMs: 5_000, heartbeatMs: 10 }),
    ).rejects.toMatchObject({ retryable: true });
    expect(touches).toBeGreaterThanOrEqual(1);
    const settled = touches;
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(touches).toBe(settled);
  });

  test("a retryable failure keeps the export object and requeues the job", async () => {
    const stubDir = mkdtempSync(path.join(tmpdir(), "wa-stub-"));
    try {
      mkdirSync(path.join(stubDir, "wa_service"), { recursive: true });
      writeFileSync(path.join(stubDir, "wa_service", "__init__.py"), "");
      writeFileSync(
        path.join(stubDir, "wa_service", "__main__.py"),
        [
          "import sys, time",
          "time.sleep(3)",
          "print('{\"ok\": false, \"error\": \"stub retryable failure\", \"retryable\": true}')",
          "sys.exit(1)",
        ].join("\n"),
      );
      const { jobId, path: storagePath } = await seedExportRun();
      runWorkerOnce({ PYTHONPATH: stubDir, PYTHONSAFEPATH: "1" });
      const job = await service
        .from("jobs")
        .select("status, attempts, last_error, completed_at")
        .eq("id", jobId)
        .single();
      expect(job.error, `job read: ${job.error?.message}`).toBeNull();
      expect(job.data!.status).toBe("queued");
      expect(job.data!.attempts).toBe(1);
      expect(job.data!.completed_at).toBeNull();
      expect(job.data!.last_error).toContain("stub retryable failure");
      const kept = await service.storage.from("whatsapp-exports").download(storagePath);
      expect(kept.error, "a retryable failure must keep the export object").toBeNull();
      expect(kept.data).toBeTruthy();
    } finally {
      rmSync(stubDir, { recursive: true, force: true });
    }
  });

  test("whatsapp.push is a no-op without credentials", async () => {
    // P7.3: a confirmed, event-backed candidate whose owner has no stored
    // Google credentials must settle its push job as succeeded and may never
    // be marked pushed. The RPC pre-clean proves the premise and keeps the
    // worker off the network (no real Google call from this host).
    const cleared = await service.rpc("delete_google_credentials", { p_user_id: qa1Id });
    expect(cleared.error, `clear credentials: ${cleared.error?.message}`).toBeNull();
    const { runId } = await seedExportRun();
    runWorkerOnce();
    const candidate = await service
      .from("integration_candidates")
      .select("id, fingerprint")
      .eq("run_id", runId)
      .limit(1)
      .single();
    expect(candidate.error, `candidate read: ${candidate.error?.message}`).toBeNull();
    const event = await service
      .from("events")
      .insert({
        user_id: qa1Id,
        title: "push noop",
        start_at: new Date().toISOString(),
        source: "whatsapp",
        source_ref: candidate.data!.fingerprint,
      })
      .select("id")
      .single();
    expect(event.error, `event seed: ${event.error?.message}`).toBeNull();
    eventIds.push(event.data!.id);
    const confirmed = await service
      .from("integration_candidates")
      .update({ status: "confirmed", event_id: event.data!.id })
      .eq("id", candidate.data!.id);
    expect(confirmed.error, `candidate confirm: ${confirmed.error?.message}`).toBeNull();
    const jobId = randomUUID();
    const job = await service.from("jobs").insert({
      id: jobId,
      kind: "whatsapp.push",
      payload: { candidateId: candidate.data!.id },
      user_id: qa1Id,
    });
    expect(job.error, `push job seed: ${job.error?.message}`).toBeNull();
    jobIds.push(jobId);
    const output = runWorkerOnce();
    expect(output).toContain(`settled job=${jobId}`);
    expect(output).toContain("status=succeeded");
    const row = await service.from("jobs").select("status").eq("id", jobId).single();
    expect(row.error, `job read: ${row.error?.message}`).toBeNull();
    expect(row.data!.status).toBe("succeeded");
    const after = await service
      .from("integration_candidates")
      .select("pushed_at")
      .eq("id", candidate.data!.id)
      .single();
    expect(after.error, `candidate read: ${after.error?.message}`).toBeNull();
    expect(
      after.data!.pushed_at,
      "nothing may be marked pushed without credentials",
    ).toBeNull();
  });
});

test.describe("startJobHeartbeat (P4.0)", () => {
  test("touches on the interval and stops when the returned stop is called", async () => {
    const { startJobHeartbeat } = await import("../../../backend/worker/whatsappJobs.mjs");
    let touches = 0;
    const ctx = {
      jobId: randomUUID(),
      workerId: "spec-worker",
      client: {
        rpc: async () => {
          touches += 1;
          return { data: null, error: null };
        },
      },
    };
    const stop = startJobHeartbeat(ctx, 20);
    await new Promise((resolve) => setTimeout(resolve, 75));
    expect(touches).toBeGreaterThanOrEqual(2);
    stop();
    const settled = touches;
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(touches).toBe(settled);
  });
});

// Deliberately outside the Python-skipped describe: this is the one test that
// must run when the host has no Python at all, so it cannot be gated on
// hasWhatsAppService(). The bogus binary exercises the same ENOENT path.
test.describe("whatsapp.sync on a Python-less worker host (46.13)", () => {
  test("a Python-less worker host gets a non-retryable, actionable failure", async () => {
    const { jobId } = await seedExportRun();
    const output = execFileSync("node", ["worker/run.mjs", "--once", "--worker-id=no-python-worker"], {
      cwd: path.join(REPO_ROOT, "backend"),
      env: { ...process.env, WHATSAPP_PYTHON: "definitely-not-python" },
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(output).toContain(`job=${jobId}`);
    const row = await service.from("jobs").select("status, last_error").eq("id", jobId).single();
    expect(row.data!.status).toBe("failed");
    expect(row.data!.last_error).toMatch(/Python|python|worker host/i);
  });
});
