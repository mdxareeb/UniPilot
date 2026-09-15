/**
 * tests/qa/jobs-runner.spec.ts — Task 29.1's durable job runner proof.
 *
 * The worker itself is a Node process (`backend/worker/run.mjs`), so this
 * spec drives it exactly as an operator would: it inserts jobs through the
 * service role, runs the worker with `--once`, and asserts the database
 * state the loop settled on. What is proven:
 *
 * - claim → handler → `succeeded`;
 * - a retryable handler failure returns the job to `queued` with the
 *   documented backoff, and the next run past the window dead-letters it;
 * - a handler that marks an error non-retryable lands on `failed`;
 * - a stale `running` lock is reclaimed (a stuck worker's lease expires) and
 *   a fresh lock is untouched;
 * - RLS: an owner sees only their own jobs; `anon` sees nothing; no client
 *   role can INSERT/UPDATE/DELETE or execute `claim_jobs`/`finish_job`;
 * - a system job (no owner) runs but is invisible to users.
 *
 * Own Playwright project (`qa-jobs-runner`, after the existing data projects
 * and their UI consumers). Every row this spec creates is tracked and deleted
 * in `afterEach`; `afterAll` asserts the spec returns the jobs table to its
 * pre-run count and none of its own ids survive — other users' jobs are
 * legitimate state (it must not assume an empty table). Local-only by
 * construction; hosted is never contacted.
 */
import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";

const LOCAL_TARGET = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const qa1Password = process.env.UNIPILOT_QA_PASSWORD ?? "";
const qa2Password = process.env.UNIPILOT_QA2_PASSWORD ?? "";

const QA1 = "qa.unipilot@unipilot.test";
const QA2 = "qa2.unipilot@unipilot.test";

/** `process.cwd()` is `frontend/` (playwright.config.ts lives there). */
const REPO_ROOT = path.resolve(process.cwd(), "..");

let qa1Id = "";
let qa2Id = "";
let service: SupabaseClient;
let qa1: SupabaseClient;
let qa2: SupabaseClient;

/** Pre-run jobs-table count; residue is relative to this, not to zero. */
let jobsCountBefore = 0;

/** Ids pending teardown in the current test. */
const createdIds: string[] = [];

/** Every id this spec ever created, kept across teardowns for `afterAll`. */
const everCreatedIds: string[] = [];

async function signIn(
  client: SupabaseClient,
  email: string,
  password: string,
): Promise<string> {
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });
  expect(error, `sign-in failed for ${email}: ${error?.message}`).toBeNull();
  return data.user!.id;
}

/** One claim→process→settle cycle, exactly how the spec should drive it. */
function runWorkerOnce(extraArgs: string[] = []): string {
  return execFileSync(
    "node",
    ["worker/run.mjs", "--once", "--worker-id=spec-worker", ...extraArgs],
    {
      cwd: path.join(REPO_ROOT, "backend"),
      env: process.env,
      encoding: "utf8",
      timeout: 30_000,
    },
  );
}

async function insertJob(
  values: Record<string, unknown>,
): Promise<string> {
  const id = randomUUID();
  const { error } = await service
    .from("jobs")
    .insert({ id, kind: "noop.test", payload: {}, ...values });
  expect(error, `seed job: ${error?.message}`).toBeNull();
  createdIds.push(id);
  everCreatedIds.push(id);
  return id;
}

async function jobRow(id: string) {
  const { data, error } = await service
    .from("jobs")
    .select("status, attempts, locked_by, last_error, run_after, completed_at")
    .eq("id", id)
    .maybeSingle();
  expect(error, `job read: ${error?.message}`).toBeNull();
  return data;
}

test.beforeAll(async () => {
  if (!LOCAL_TARGET.test(url)) {
    throw new Error(
      `jobs-runner is local-only; refusing target "${url || "(unset)"}"`,
    );
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

  service = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Snapshot the table before any test writes: other users' jobs (e.g. a real
  // founder scan) are legitimate state, so residue is asserted relative to
  // this count rather than against an assumed-empty table.
  const { count, error } = await service
    .from("jobs")
    .select("id", { count: "exact", head: true });
  expect(error, `pre-run jobs count: ${error?.message}`).toBeNull();
  jobsCountBefore = count ?? 0;

  qa1 = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  qa2 = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  qa1Id = await signIn(qa1, QA1, qa1Password);
  qa2Id = await signIn(qa2, QA2, qa2Password);
});

test.afterEach(async () => {
  if (createdIds.length > 0) {
    const { error } = await service.from("jobs").delete().in("id", createdIds);
    expect(error, `teardown: ${error?.message}`).toBeNull();
    createdIds.length = 0;
  }
});

test.afterAll(async () => {
  const { count, error } = await service
    .from("jobs")
    .select("id", { count: "exact", head: true });
  expect(error, `residue count: ${error?.message}`).toBeNull();
  expect(
    count,
    "the spec must return the jobs table to its pre-run count",
  ).toBe(jobsCountBefore);

  // `afterEach` cleared `createdIds`, so the independent proof that no id this
  // spec ever created survives reads the snapshot of every id it did create.
  const createdIdsSnapshot = [...everCreatedIds];
  if (createdIdsSnapshot.length > 0) {
    const { data, error: ownError } = await service
      .from("jobs")
      .select("id")
      .in("id", createdIdsSnapshot);
    expect(ownError, `own-id residue read: ${ownError?.message}`).toBeNull();
    expect(
      data ?? [],
      "no id created by this spec may survive the run",
    ).toHaveLength(0);
  }
});

test.describe("jobs runner (29.1)", () => {
  test("claim → handler → succeeded, and the log names the settled row", async () => {
    const id = await insertJob({ payload: { source: "spec" } });

    const output = runWorkerOnce();
    expect(output).toContain(`settled job=${id}`);
    expect(output).toContain("status=succeeded");

    const row = await jobRow(id);
    expect(row).toMatchObject({
      status: "succeeded",
      attempts: 1,
      locked_by: null,
      last_error: null,
    });
    expect(row!.completed_at).not.toBeNull();
  });

  test("retryable failure backs off, exhausts attempts, then dead-letters", async () => {
    const id = await insertJob({
      payload: { fail: true },
      max_attempts: 2,
    });

    const before = Date.now();
    runWorkerOnce();

    const retrying = await jobRow(id);
    expect(retrying!.status).toBe("queued");
    expect(retrying!.attempts).toBe(1);
    expect(retrying!.last_error).toContain("instructed to fail");
    // The documented first backoff is 30s: 2^(attempts-1) * 30s. Assert the
    // window rather than an exact instant so the suite is not clock-flaky.
    const backoffMs = Date.parse(retrying!.run_after) - before;
    expect(backoffMs).toBeGreaterThan(20_000);
    expect(backoffMs).toBeLessThan(45_000);

    // Fast-forward past the backoff: the next claim exhausts max_attempts.
    await service
      .from("jobs")
      .update({ run_after: new Date().toISOString() })
      .eq("id", id);
    runWorkerOnce();

    const dead = await jobRow(id);
    expect(dead!.status).toBe("dead_letter");
    expect(dead!.attempts).toBe(2);
    expect(dead!.last_error).toContain("instructed to fail");
    expect(dead!.completed_at).not.toBeNull();
  });

  test("a non-retryable handler failure lands on failed without burning retries", async () => {
    const id = await insertJob({
      payload: { fail: true, retryable: false },
      max_attempts: 5,
    });

    runWorkerOnce();

    const row = await jobRow(id);
    expect(row!.status).toBe("failed");
    expect(row!.attempts).toBe(1);
    expect(row!.last_error).toContain("instructed to fail");
    expect(row!.completed_at).not.toBeNull();
  });

  test("a stale lock is reclaimed; a fresh lock is left alone", async () => {
    const staleId = await insertJob({
      status: "running",
      locked_by: "dead-worker",
      locked_at: new Date(Date.now() - 10 * 60_000).toISOString(),
      attempts: 1,
    });
    const freshId = await insertJob({
      status: "running",
      locked_by: "live-worker",
      locked_at: new Date().toISOString(),
      attempts: 1,
    });

    runWorkerOnce();

    const stale = await jobRow(staleId);
    expect(stale!.status).toBe("succeeded");
    expect(stale!.attempts).toBe(2);

    const fresh = await jobRow(freshId);
    expect(fresh!.status).toBe("running");
    expect(fresh!.locked_by).toBe("live-worker");
  });

  test("a system job runs but is invisible to users", async () => {
    const id = await insertJob({ user_id: null, payload: {} });

    runWorkerOnce();

    const row = await jobRow(id);
    expect(row!.status).toBe("succeeded");

    const visible = await qa1.from("jobs").select("id").eq("id", id);
    expect(visible.error).toBeNull();
    expect(visible.data ?? []).toHaveLength(0);
  });

  test("access control: owners read only their own rows; clients cannot write or claim", async () => {
    const qa1Job = await insertJob({ user_id: qa1Id, payload: {} });
    const qa2Job = await insertJob({ user_id: qa2Id, payload: {} });

    // RLS read: each owner sees exactly their own row.
    const own = await qa1.from("jobs").select("id").eq("id", qa1Job);
    expect(own.error).toBeNull();
    expect(own.data ?? []).toHaveLength(1);

    const foreign = await qa1.from("jobs").select("id").eq("id", qa2Job);
    expect(foreign.error).toBeNull();
    expect(foreign.data ?? []).toHaveLength(0);

    // No client writes: insert/update/delete grants were revoked outright.
    const insert = await qa1
      .from("jobs")
      .insert({ kind: "noop.test", payload: {}, user_id: qa1Id });
    expect(insert.error, "authenticated insert must be denied").not.toBeNull();

    const update = await qa1
      .from("jobs")
      .update({ status: "succeeded" })
      .eq("id", qa1Job);
    expect(update.error, "authenticated update must be denied").not.toBeNull();

    const remove = await qa1.from("jobs").delete().eq("id", qa1Job);
    expect(remove.error, "authenticated delete must be denied").not.toBeNull();

    // The claim/finish protocol is service-role only: even the owner's
    // session cannot execute it.
    const claimAsQa1 = await qa1.rpc("claim_jobs", {
      p_worker_id: "intruder",
      p_limit: 10,
    });
    expect(claimAsQa1.error, "authenticated claim must be denied").not.toBeNull();

    const finishAsQa1 = await qa1.rpc("finish_job", {
      p_job_id: qa1Job,
      p_worker_id: "intruder",
      p_error: null,
      p_retryable: true,
    });
    expect(finishAsQa1.error, "authenticated finish must be denied").not.toBeNull();

    // Anon (no session) is denied the read too.
    const anon = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const anonRead = await anon.from("jobs").select("id").eq("id", qa1Job);
    expect(
      anonRead.error !== null || (anonRead.data ?? []).length === 0,
      "anon read must resolve to nothing",
    ).toBe(true);

    // The jobs survived the client attempts; the owner still sees their row.
    const stillThere = await qa1.from("jobs").select("id").eq("id", qa1Job);
    expect(stillThere.data ?? []).toHaveLength(1);
  });
});
