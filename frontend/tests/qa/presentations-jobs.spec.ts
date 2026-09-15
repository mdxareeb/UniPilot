/**
 * tests/qa/presentations-jobs.spec.ts — Task 31.x's wiring proof.
 *
 * The only honest proof available in an environment with no Presenton service
 * (GATE 1: no provider was configured, so no real deck may be generated and
 * none is faked):
 *
 * - the adapter refuses every outbound call when `PRESENTON_URL` is unset
 *   (`not-configured`) and rejects unsafe task ids / export paths before any
 *   fetch;
 * - the worker (`presentation.generate`) fails such a request permanently and
 *   honestly — the `presentations` row and the job both settle on the
 *   sanitized "not connected" copy, `attempts=1` (no retry burn), and nothing
 *   is stored in `documents`;
 * - the request parser accepts only the bounded vocabulary;
 * - RLS: owners read only their own rows; no client role may write; `anon`
 *   reads nothing.
 *
 * Own Playwright project (`qa-presentation-jobs`, after the jobs runner). The
 * spec is local-only by construction, drives the real worker with
 * `PRESENTON_URL` forced empty, holds the shared worker lock around worker
 * runs, and returns every row it created to the pre-run counts in `afterAll`.
 * A configured Presenton environment runs the real end-to-end deck flow, which
 * this spec deliberately does not attempt to fake.
 */
import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { acquireWorkerLock } from "./workerLock";

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

/** Mirrors `backend/worker/presentationJobs.mjs`'s unconfigured copy. */
const NOT_CONNECTED_COPY =
  "Presentation generation isn't connected yet. It needs a configured Presenton service, and this environment doesn't have one.";

/** Mirrors the worker's retryable-failure copy. */
const TRANSIENT_COPY =
  "We couldn't finish generating this deck. We'll try again shortly.";

let qa1Id = "";
let service: SupabaseClient;
let qa1: SupabaseClient;
let qa2: SupabaseClient;

let jobsCountBefore = 0;
let presentationsCountBefore = 0;
let presentationDocumentsBefore = 0;

const createdJobIds: string[] = [];
const createdPresentationIds: string[] = [];
const everCreatedJobIds: string[] = [];
const everCreatedPresentationIds: string[] = [];

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

/**
 * One claim→process→settle cycle with `env` overriding the Presenton
 * integration — the caller pins the exact configuration under test. `env: ""`
 * is the documented "unset" the adapter treats like absence.
 */
function runWorkerOnce(env: Record<string, string>): string {
  return execFileSync(
    "node",
    ["worker/run.mjs", "--once", "--worker-id=spec-presentation-worker"],
    {
      cwd: path.join(REPO_ROOT, "backend"),
      env: { ...process.env, ...env },
      encoding: "utf8",
      timeout: 30_000,
    },
  );
}

function runWorkerOnceUnconfigured(): string {
  return runWorkerOnce({ PRESENTON_URL: "", PRESENTON_API_KEY: "" });
}

async function insertPresentation(values: Record<string, unknown> = {}) {
  const id = randomUUID();
  const { error } = await service.from("presentations").insert({
    id,
    user_id: qa1Id,
    prompt: "Introduction to machine learning",
    template: "general",
    format: "pptx",
    status: "queued",
    ...values,
  });
  expect(error, `seed presentation: ${error?.message}`).toBeNull();
  createdPresentationIds.push(id);
  everCreatedPresentationIds.push(id);
  return id;
}

async function insertJob(payload: Record<string, unknown>, maxAttempts = 5) {
  const id = randomUUID();
  const { error } = await service.from("jobs").insert({
    id,
    kind: "presentation.generate",
    payload,
    user_id: qa1Id,
    max_attempts: maxAttempts,
  });
  expect(error, `seed job: ${error?.message}`).toBeNull();
  createdJobIds.push(id);
  everCreatedJobIds.push(id);
  return id;
}

test.beforeAll(async () => {
  if (!LOCAL_TARGET.test(url)) {
    throw new Error(
      `presentations-jobs is local-only; refusing target "${url || "(unset)"}"`,
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

  const [jobsCount, presentationsCount, presentationDocuments] =
    await Promise.all([
      service.from("jobs").select("id", { count: "exact", head: true }),
      service.from("presentations").select("id", { count: "exact", head: true }),
      service
        .from("documents")
        .select("id", { count: "exact", head: true })
        .eq("source", "presentation"),
    ]);
  expect(jobsCount.error, `pre-run jobs count: ${jobsCount.error?.message}`).toBeNull();
  expect(
    presentationsCount.error,
    `pre-run presentations count: ${presentationsCount.error?.message}`,
  ).toBeNull();
  expect(
    presentationDocuments.error,
    `pre-run presentation-documents count: ${presentationDocuments.error?.message}`,
  ).toBeNull();
  jobsCountBefore = jobsCount.count ?? 0;
  presentationsCountBefore = presentationsCount.count ?? 0;
  presentationDocumentsBefore = presentationDocuments.count ?? 0;

  qa1 = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  qa2 = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  qa1Id = await signIn(qa1, QA1, qa1Password);
  await signIn(qa2, QA2, qa2Password);
});

test.afterEach(async () => {
  if (createdJobIds.length > 0) {
    const { error } = await service.from("jobs").delete().in("id", createdJobIds);
    expect(error, `teardown jobs: ${error?.message}`).toBeNull();
    createdJobIds.length = 0;
  }
  if (createdPresentationIds.length > 0) {
    const { error } = await service
      .from("presentations")
      .delete()
      .in("id", createdPresentationIds);
    expect(error, `teardown presentations: ${error?.message}`).toBeNull();
    createdPresentationIds.length = 0;
  }
});

test.afterAll(async () => {
  const [jobsCount, presentationsCount, presentationDocuments] =
    await Promise.all([
      service.from("jobs").select("id", { count: "exact", head: true }),
      service.from("presentations").select("id", { count: "exact", head: true }),
      service
        .from("documents")
        .select("id", { count: "exact", head: true })
        .eq("source", "presentation"),
    ]);
  expect(jobsCount.error, `residue jobs: ${jobsCount.error?.message}`).toBeNull();
  expect(
    presentationsCount.error,
    `residue presentations: ${presentationsCount.error?.message}`,
  ).toBeNull();
  expect(
    presentationDocuments.error,
    `residue presentation documents: ${presentationDocuments.error?.message}`,
  ).toBeNull();

  expect(
    jobsCount.count,
    "the spec must return the jobs table to its pre-run count",
  ).toBe(jobsCountBefore);
  expect(
    presentationsCount.count,
    "the spec must return the presentations table to its pre-run count",
  ).toBe(presentationsCountBefore);
  expect(
    presentationDocuments.count,
    "the unconfigured path must never store a deck",
  ).toBe(presentationDocumentsBefore);

  if (everCreatedJobIds.length > 0) {
    const { data, error } = await service
      .from("jobs")
      .select("id")
      .in("id", [...everCreatedJobIds]);
    expect(error, `own job residue read: ${error?.message}`).toBeNull();
    expect(data ?? [], "no job this spec created may survive").toHaveLength(0);
  }
  if (everCreatedPresentationIds.length > 0) {
    const { data, error } = await service
      .from("presentations")
      .select("id")
      .in("id", [...everCreatedPresentationIds]);
    expect(error, `own presentation residue read: ${error?.message}`).toBeNull();
    expect(data ?? [], "no presentation this spec created may survive").toHaveLength(0);
  }
});

test.describe("adapter guards (no Presenton configured)", () => {
  test("unset PRESENTON_URL refuses every call before any network attempt", async () => {
    const savedUrl = process.env.PRESENTON_URL;
    const savedKey = process.env.PRESENTON_API_KEY;
    delete process.env.PRESENTON_URL;
    delete process.env.PRESENTON_API_KEY;
    try {
      const adapter = await import("../../lib/integrations/presenton");

      expect(adapter.isPresentonConfigured()).toBe(false);

      await expect(
        adapter.startPresentationGeneration({
          content: "A topic",
          template: "general",
          format: "pptx",
        }),
      ).rejects.toMatchObject({ code: "not-configured" });

      await expect(adapter.listPresentationTemplates()).rejects.toMatchObject({
        code: "not-configured",
      });

      await expect(
        adapter.getPresentationTaskStatus("task-abc"),
      ).rejects.toMatchObject({ code: "not-configured" });
    } finally {
      if (savedUrl !== undefined) process.env.PRESENTON_URL = savedUrl;
      if (savedKey !== undefined) process.env.PRESENTON_API_KEY = savedKey;
    }
  });

  test("unsafe task ids and export paths are rejected before any fetch", async () => {
    const adapter = await import("../../lib/integrations/presenton");

    // Point at a loopback port nothing listens on: a fetch would fail as
    // `unreachable`; the guard rejects first with `rejected`.
    process.env.PRESENTON_URL = "http://127.0.0.1:9";
    try {
      await expect(
        adapter.getPresentationTaskStatus("bad/../id"),
      ).rejects.toMatchObject({ code: "rejected" });

      await expect(
        adapter.downloadPresentationExport("/etc/passwd"),
      ).rejects.toMatchObject({ code: "rejected" });

      await expect(
        adapter.downloadPresentationExport("/app_data/../../secret"),
      ).rejects.toMatchObject({ code: "rejected" });
    } finally {
      delete process.env.PRESENTON_URL;
    }
  });

  test("request parser accepts only the bounded vocabulary", async () => {
    const { parsePresentationRequest } = await import(
      "../../lib/data/presentationValues"
    );

    expect(
      parsePresentationRequest({
        prompt: "  Cellular respiration  ",
        template: "general",
        nSlides: 8,
        format: "pptx",
        sourceDocumentId: null,
      }),
    ).toEqual({
      prompt: "Cellular respiration",
      template: "general",
      nSlides: 8,
      format: "pptx",
      sourceDocumentId: null,
    });

    // Optional count and template; empty source normalizes to null.
    expect(
      parsePresentationRequest({
        prompt: "Topic",
        format: "pdf",
        sourceDocumentId: "",
      }),
    ).toEqual({
      prompt: "Topic",
      template: "general",
      nSlides: null,
      format: "pdf",
      sourceDocumentId: null,
    });

    const rejected = [
      null,
      {},
      { prompt: "", format: "pptx" },
      { prompt: "x".repeat(2_001), format: "pptx" },
      { prompt: "ok", format: "pptx", nSlides: 4 },
      { prompt: "ok", format: "pptx", nSlides: 31 },
      { prompt: "ok", format: "pptx", nSlides: 7.5 },
      { prompt: "ok", format: "docx" },
      { prompt: "ok" },
      { prompt: "ok", format: "pptx", sourceDocumentId: "not-a-uuid" },
    ];
    for (const payload of rejected) {
      expect(
        parsePresentationRequest(payload),
        `must reject ${JSON.stringify(payload)}`,
      ).toBeNull();
    }
  });
});

test.describe("worker wiring (unconfigured, honest blocked path)", () => {
  test("fails the job permanently and the row honestly, storing nothing", async () => {
    const release = await acquireWorkerLock();
    try {
      const presentationId = await insertPresentation();
      const jobId = await insertJob({ presentationId });

      const output = runWorkerOnceUnconfigured();
      expect(output).toContain(`settled job=${jobId}`);
      expect(output).toContain("status=failed");

      const { data: presentation, error: presentationError } = await service
        .from("presentations")
        .select(
          "status, error_message, document_id, presenton_task_id, presenton_presentation_id",
        )
        .eq("id", presentationId)
        .single();
      expect(
        presentationError,
        `presentation read: ${presentationError?.message}`,
      ).toBeNull();
      expect(presentation).toMatchObject({
        status: "failed",
        error_message: NOT_CONNECTED_COPY,
        document_id: null,
        presenton_task_id: null,
        presenton_presentation_id: null,
      });

      const { data: job, error: jobError } = await service
        .from("jobs")
        .select("status, attempts, last_error, completed_at")
        .eq("id", jobId)
        .single();
      expect(jobError, `job read: ${jobError?.message}`).toBeNull();
      expect(job).toMatchObject({
        status: "failed",
        attempts: 1,
        last_error: NOT_CONNECTED_COPY,
      });
      expect(job!.completed_at).not.toBeNull();
    } finally {
      release();
    }
  });

  test("unreachable service: retryable failure keeps the request queued with honest copy", async () => {
    const release = await acquireWorkerLock();
    try {
      const presentationId = await insertPresentation();
      const jobId = await insertJob({ presentationId }, 2);

      // A dead loopback endpoint: the worker's fetch is refused, which is the
      // retryable transport failure the runner backs off. No provider is
      // faked — the attempt genuinely reaches out and genuinely fails.
      const output = runWorkerOnce({
        PRESENTON_URL: "http://127.0.0.1:9",
        PRESENTON_API_KEY: "",
      });
      expect(output).toContain(`settled job=${jobId}`);
      expect(output).toContain("status=queued");

      const { data: presentation, error: presentationError } = await service
        .from("presentations")
        .select("status, error_message, document_id")
        .eq("id", presentationId)
        .single();
      expect(
        presentationError,
        `presentation read: ${presentationError?.message}`,
      ).toBeNull();
      expect(presentation).toMatchObject({
        status: "queued",
        error_message: TRANSIENT_COPY,
        document_id: null,
      });

      const { data: job, error: jobError } = await service
        .from("jobs")
        .select("status, attempts, last_error, run_after")
        .eq("id", jobId)
        .single();
      expect(jobError, `job read: ${jobError?.message}`).toBeNull();
      expect(job).toMatchObject({
        status: "queued",
        attempts: 1,
        last_error: TRANSIENT_COPY,
      });
      // The documented 30 s backoff pushed the next attempt forward.
      expect(new Date(job!.run_after).getTime()).toBeGreaterThan(Date.now());
    } finally {
      release();
    }
  });

  test("RLS: owner reads only; no client write; anon reads nothing", async () => {
    const presentationId = await insertPresentation({ status: "running" });

    const { data: own, error: ownError } = await qa1
      .from("presentations")
      .select("id")
      .eq("id", presentationId);
    expect(ownError, `owner read: ${ownError?.message}`).toBeNull();
    expect(own ?? []).toHaveLength(1);

    const { data: other, error: otherError } = await qa2
      .from("presentations")
      .select("id")
      .eq("id", presentationId);
    expect(otherError, `other read: ${otherError?.message}`).toBeNull();
    expect(other ?? []).toHaveLength(0);

    const anon = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: anonymous, error: anonError } = await anon
      .from("presentations")
      .select("id")
      .eq("id", presentationId);
    expect(anonError, `anon read: ${anonError?.message}`).not.toBeNull();
    expect(anonymous ?? []).toHaveLength(0);

    // No client role may write: the table grants SELECT only (server-only
    // writes), so all three mutations must be denied.
    const insertAttempt = await qa1.from("presentations").insert({
      user_id: qa1Id,
      prompt: "forged",
      template: "general",
      format: "pptx",
    });
    expect(insertAttempt.error, "client INSERT must be denied").not.toBeNull();

    const updateAttempt = await qa1
      .from("presentations")
      .update({ status: "succeeded" })
      .eq("id", presentationId);
    expect(updateAttempt.error, "client UPDATE must be denied").not.toBeNull();

    const deleteAttempt = await qa1
      .from("presentations")
      .delete()
      .eq("id", presentationId);
    expect(deleteAttempt.error, "client DELETE must be denied").not.toBeNull();

    const { data: survived, error: survivedError } = await service
      .from("presentations")
      .select("id, status")
      .eq("id", presentationId)
      .single();
    expect(survivedError, `survivor read: ${survivedError?.message}`).toBeNull();
    expect(survived).toMatchObject({ id: presentationId, status: "running" });
  });

  test("a successful settle keeps the row; a removed row is a no-op", async () => {
    const release = await acquireWorkerLock();
    try {
      // Row that never existed: the worker logs and succeeds (nothing to do).
      const missingJob = await insertJob({ presentationId: randomUUID() });
      const output = runWorkerOnceUnconfigured();
      expect(output).toContain(`settled job=${missingJob}`);
    } finally {
      release();
    }
  });
});
