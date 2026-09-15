/**
 * tests/qa/whatsapp-export.spec.ts — the export upload pipeline's contract
 * (Task P5.2, spec 46.15).
 *
 * The spec drives the real UI path — dropzone → `createExportRunAction` →
 * direct Storage XHR → `finalizeExportRunAction` — then runs the worker
 * itself (`--once`, same shape as `whatsapp-jobs.spec.ts`) and watches the
 * rendered run settle through the workspace's own status poll. Database
 * assertions go through the service client for what the UI deliberately does
 * not show (raw messages, candidate identity) and for the double-confirm
 * idempotency proof: two synchronous confirm clicks must still leave exactly
 * one WhatsApp events row.
 *
 * The rate-limit test sits in its own ungated describe: it needs no Python,
 * because the guard rejects before anything is enqueued.
 */
import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { formatTaskDueDate } from "../../lib/data/taskDates";
import { hasWhatsAppService, WHATSAPP_SKIP_REASON } from "./whatsappService";
import { acquireWorkerLock } from "./workerLock";

const LOCAL_TARGET = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const qa1Password = process.env.UNIPILOT_QA_PASSWORD ?? "";
const QA1 = "qa.unipilot@unipilot.test";
const REPO_ROOT = path.resolve(process.cwd(), "..");
const BACKEND_DIR = path.join(REPO_ROOT, "backend");
const SAMPLE = path.join(
  REPO_ROOT,
  "whatsapp",
  "tests",
  "fixtures",
  "sample_chat.txt",
);
/* C4 — the synthetic MDY-envelope fixture: two explicit text dates plus the
   guarded weekday mentions the relative-dates toggle decides on. */
const MDY_SAMPLE = path.join(
  REPO_ROOT,
  "whatsapp",
  "tests",
  "fixtures",
  "envelope_mdy_chat.txt",
);

let service: SupabaseClient;
let qa1Id = "";
let releaseWorkerLock: (() => void) | null = null;
const runIds: string[] = [];
const jobIds: string[] = [];
const bucketPaths: string[] = [];
const eventIds: string[] = [];
const connectionIds: string[] = [];

function runWorkerOnce(): string {
  return execFileSync(
    "node",
    ["worker/run.mjs", "--once", "--worker-id=wa-export-spec"],
    {
      cwd: BACKEND_DIR,
      env: process.env,
      encoding: "utf8",
      timeout: 120_000,
    },
  );
}

async function findActiveRun(): Promise<{
  id: string;
  storage_path: string | null;
}> {
  const { data, error } = await service
    .from("integration_runs")
    .select("id, storage_path")
    .eq("user_id", qa1Id)
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  expect(error, `active run read: ${error?.message}`).toBeNull();
  expect(
    data,
    "the upload must have reserved exactly one active run",
  ).not.toBeNull();
  return data!;
}

async function findJobForRun(runId: string): Promise<string> {
  const { data, error } = await service
    .from("jobs")
    .select("id")
    .eq("kind", "whatsapp.sync")
    .contains("payload", { runId })
    .maybeSingle();
  expect(error, `job read: ${error?.message}`).toBeNull();
  expect(
    data,
    `finalize must enqueue exactly one whatsapp.sync job for ${runId}`,
  ).not.toBeNull();
  return data!.id;
}

/**
 * `data-signed-in="true"` is written by the session reporter's effect, so
 * waiting for it proves hydration has run and the file input's React change
 * handler is attached before a file is set on it.
 */
async function openIntegrations(page: Page): Promise<void> {
  await page.goto("/integrations");
  await expect(page.locator('[data-signed-in="true"]')).toBeAttached();
}

/**
 * Task B4 — bring QA1's single `(user_id, provider='whatsapp')` row to a known
 * state: patch it when it already exists (the flow test's reservation leaves
 * one), insert otherwise. The returned id is tracked so teardown restores the
 * pre-test state by deleting exactly this row. C4 extends the seed with the
 * detection settings so a saved default can preselect the upload controls.
 */
async function seedWhatsAppConnection(fields: {
  mode?: "export" | "live";
  status?: "disconnected" | "connected" | "pending" | "error";
  review_mode?: "manual" | "automatic";
  date_order?: "DMY" | "MDY";
  detect_relative_dates?: boolean;
}): Promise<string> {
  const existing = await service
    .from("integration_connections")
    .select("id")
    .eq("user_id", qa1Id)
    .eq("provider", "whatsapp")
    .maybeSingle();
  expect(existing.error, `connection read: ${existing.error?.message}`).toBeNull();
  if (existing.data) {
    const { error } = await service
      .from("integration_connections")
      .update(fields)
      .eq("id", existing.data.id);
    expect(error, `connection seed update: ${error?.message}`).toBeNull();
    connectionIds.push(existing.data.id);
    return existing.data.id;
  }
  const id = randomUUID();
  const { error } = await service.from("integration_connections").insert({
    id,
    user_id: qa1Id,
    provider: "whatsapp",
    mode: fields.mode ?? "export",
    status: fields.status ?? "disconnected",
    review_mode: fields.review_mode ?? "manual",
    date_order: fields.date_order ?? "DMY",
    detect_relative_dates: fields.detect_relative_dates ?? false,
  });
  expect(error, `connection seed insert: ${error?.message}`).toBeNull();
  connectionIds.push(id);
  return id;
}

/** The profile zone the worker formats candidate instants in. */
async function profileTimeZone(): Promise<string> {
  const { data, error } = await service
    .from("profiles")
    .select("timezone")
    .eq("id", qa1Id)
    .maybeSingle();
  expect(error, `profile read: ${error?.message}`).toBeNull();
  return (data as { timezone: string } | null)?.timezone ?? "UTC";
}

test.beforeAll(async () => {
  if (!LOCAL_TARGET.test(url)) throw new Error(`local-only; refusing ${url}`);
  if (!anonKey || !serviceKey) throw new Error("missing local keys");
  service = createClient(url, serviceKey, { auth: { persistSession: false } });
  const qa1 = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error } = await qa1.auth.signInWithPassword({
    email: QA1,
    password: qa1Password,
  });
  expect(error, `sign-in: ${error?.message}`).toBeNull();
  qa1Id = data.user!.id;
  // One worker-driving WhatsApp file at a time (see workerLock.ts); the full
  // suite's dependency chain makes this uncontended, a targeted --no-deps run
  // does not.
  releaseWorkerLock = await acquireWorkerLock();
});

test.afterEach(async () => {
  /* Events have no run FK, so collect the settled ids before the run delete
     cascades the candidates that carry them. */
  if (runIds.length > 0) {
    const { data } = await service
      .from("integration_candidates")
      .select("event_id")
      .in("run_id", runIds);
    for (const row of data ?? []) {
      if (row.event_id && !eventIds.includes(row.event_id)) {
        eventIds.push(row.event_id);
      }
    }
  }
  if (eventIds.length > 0) {
    const { error } = await service.from("events").delete().in("id", eventIds);
    expect(error, `teardown events: ${error?.message}`).toBeNull();
  }
  for (const runId of runIds) {
    const { error } = await service
      .from("integration_runs")
      .delete()
      .eq("id", runId);
    expect(error, `teardown run ${runId}: ${error?.message}`).toBeNull();
  }
  // A connected Google Calendar would enqueue `whatsapp.push` jobs from the
  // confirm action; none exist today, but track any by id so teardown stays
  // exact if that changes.
  const pushJobs = await service
    .from("jobs")
    .select("id")
    .eq("user_id", qa1Id)
    .eq("kind", "whatsapp.push");
  expect(pushJobs.error, `push job read: ${pushJobs.error?.message}`).toBeNull();
  for (const row of pushJobs.data ?? []) {
    if (!jobIds.includes(row.id)) jobIds.push(row.id);
  }
  if (jobIds.length > 0) {
    const { error } = await service.from("jobs").delete().in("id", jobIds);
    expect(error, `teardown jobs: ${error?.message}`).toBeNull();
  }
  for (const connectionId of connectionIds) {
    const { error } = await service
      .from("integration_connections")
      .delete()
      .eq("id", connectionId);
    expect(
      error,
      `teardown connection ${connectionId}: ${error?.message}`,
    ).toBeNull();
  }
  if (bucketPaths.length > 0) {
    const { error } = await service.storage
      .from("whatsapp-exports")
      .remove(bucketPaths);
    expect(error, `teardown objects: ${error?.message}`).toBeNull();
  }
  runIds.length = 0;
  jobIds.length = 0;
  bucketPaths.length = 0;
  eventIds.length = 0;
  connectionIds.length = 0;
});

test.afterAll(async () => {
  try {
    /* Task B3 — reserving an export run persists the review mode as the
       WhatsApp connection default, creating the row for a never-linked owner.
       Clear it first so the residue count below still proves a clean slate. */
    const connectionCleanup = await service
      .from("integration_connections")
      .delete()
      .eq("user_id", qa1Id)
      .eq("provider", "whatsapp");
    expect(
      connectionCleanup.error,
      `connection cleanup: ${connectionCleanup.error?.message}`,
    ).toBeNull();

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
    expect(
      bucketError,
      `bucket residue read: ${bucketError?.message}`,
    ).toBeNull();
    const qa1Objects = (bucketRoot ?? []).filter((entry) =>
      entry.name.startsWith(qa1Id),
    );
    expect(
      qa1Objects,
      "whatsapp-exports must have no objects under the QA1 prefix",
    ).toHaveLength(0);
    // Events have no run FK; confirm's settled rows must be gone by id too.
    const whatsappEvents = await service
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("user_id", qa1Id)
      .eq("source", "whatsapp");
    expect(
      whatsappEvents.error,
      `events residue read: ${whatsappEvents.error?.message}`,
    ).toBeNull();
    expect(
      whatsappEvents.count,
      "events must have no QA1 whatsapp residue",
    ).toBe(0);
  } finally {
    releaseWorkerLock?.();
    releaseWorkerLock = null;
  }
});

test.describe("whatsapp export flow (46.15)", () => {
  test.skip(!hasWhatsAppService(), WHATSAPP_SKIP_REASON);

  test("upload → scan → review → confirm → calendar → reject → re-sync dedupe", async ({
    page,
  }) => {
    await openIntegrations(page);
    await page.setInputFiles('input[type="file"]', SAMPLE);

    // The reservation's optimistic row appears, then the worker runs and the
    // 3 s poll settles it to Done.
    await expect(page.getByText("Queued", { exact: true }).first()).toBeVisible();
    const first = await findActiveRun();
    runIds.push(first.id);
    if (first.storage_path !== null) bucketPaths.push(first.storage_path);
    const firstJobId = await findJobForRun(first.id);
    jobIds.push(firstJobId);

    const firstWorkerOutput = runWorkerOnce();
    expect(firstWorkerOutput).toContain(`settled job=${firstJobId}`);
    expect(firstWorkerOutput).toContain("status=succeeded");

    await expect(page.getByText("Done", { exact: true }).first()).toBeVisible({
      timeout: 90_000,
    });

    // The five detections are listed.
    for (const title of [
      /Birthday party/i,
      /Team meeting/i,
      /Football match/i,
      /Webinar/i,
      /picnic/i,
    ]) {
      await expect(page.getByRole("heading", { name: title })).toBeVisible();
    }

    // The worker's writes are the DB's truth (the UI shows candidates only).
    const firstRun = await service
      .from("integration_runs")
      .select("status, message_count, candidate_count, review_mode")
      .eq("id", first.id)
      .single();
    expect(firstRun.error, `run read: ${firstRun.error?.message}`).toBeNull();
    expect(firstRun.data).toMatchObject({
      status: "succeeded",
      message_count: 10,
      candidate_count: 5,
      // Task B3 — a default (untouched radio) upload records the manual mode.
      review_mode: "manual",
    });

    /* Task B3/C4 — the reservation also persisted the choices as the WhatsApp
       connection default: a never-linked owner gains a `disconnected` export
       row carrying the review mode and the detection settings, and its
       transport state is untouched (there was none to touch). The afterAll
       clears the row as residue. */
    const connectionDefault = await service
      .from("integration_connections")
      .select("mode, status, review_mode, date_order, detect_relative_dates")
      .eq("user_id", qa1Id)
      .eq("provider", "whatsapp")
      .single();
    expect(
      connectionDefault.error,
      `connection default read: ${connectionDefault.error?.message}`,
    ).toBeNull();
    expect(connectionDefault.data).toMatchObject({
      mode: "export",
      status: "disconnected",
      review_mode: "manual",
      date_order: "DMY",
      detect_relative_dates: false,
    });
    const messageCount = await service
      .from("integration_messages")
      .select("id", { count: "exact", head: true })
      .eq("run_id", first.id);
    expect(messageCount.error).toBeNull();
    expect(messageCount.count).toBe(10);
    const candidateRows = await service
      .from("integration_candidates")
      .select("id, title, status, fingerprint, event_id")
      .eq("run_id", first.id);
    expect(candidateRows.error).toBeNull();
    expect(candidateRows.data?.length).toBe(5);
    const birthdayCandidate = (candidateRows.data ?? []).find((row) =>
      /Birthday party/i.test(row.title),
    );
    expect(birthdayCandidate, "the Birthday party candidate").toBeTruthy();

    /* Founder-required double-confirm: two synchronous clicks race the two
       confirm actions. The fingerprint unique index upsert and the
       `status = pending` settle must leave exactly one event. */
    await page.evaluate(() => {
      const row = [...document.querySelectorAll("li[data-candidate-id]")].find(
        (element) => /Birthday party/i.test(element.textContent ?? ""),
      );
      const button = row?.querySelector<HTMLButtonElement>(
        '[data-candidate-action="add"]',
      );
      button?.click();
      button?.click();
    });

    await expect(page.getByText("Added to your calendar.")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Birthday party/i }),
    ).toHaveCount(0);

    // Both actions have settled once the page has no in-flight requests.
    await page.waitForLoadState("networkidle");

    const countWhatsAppEvents = async (): Promise<number> => {
      const { count, error } = await service
        .from("events")
        .select("id", { count: "exact", head: true })
        .eq("user_id", qa1Id)
        .eq("source", "whatsapp")
        .eq("source_ref", birthdayCandidate!.fingerprint);
      expect(error, `event count: ${error?.message}`).toBeNull();
      return count ?? -1;
    };
    await expect.poll(countWhatsAppEvents, { timeout: 15_000 }).toBe(1);
    const settledCandidate = await service
      .from("integration_candidates")
      .select("status")
      .eq("id", birthdayCandidate!.id)
      .single();
    expect(settledCandidate.data?.status).toBe("confirmed");
    await page.waitForTimeout(1_000);
    expect(
      await countWhatsAppEvents(),
      "a duplicate event must not exist after the second click settles",
    ).toBe(1);
    const settledEvent = await service
      .from("events")
      .select("id")
      .eq("user_id", qa1Id)
      .eq("source", "whatsapp")
      .eq("source_ref", birthdayCandidate!.fingerprint)
      .single();
    expect(settledEvent.error).toBeNull();
    eventIds.push(settledEvent.data!.id);

    // The confirmed event is a real calendar marker: the block/chip root
    // carries `data-source`, the neutral glyph carries the screen-reader
    // words, and the `?event=` detail states the provenance.
    await page.goto("/calendar");
    const marker = page.locator('[data-source="whatsapp"]').first();
    await expect(marker).toBeVisible();
    await expect(marker).toContainText("From WhatsApp");
    // The provenance must be reachable by role+name too, not just DOM text:
    // the button's aria-label is the name AT actually hears.
    await expect(
      page.getByRole("button", { name: /From WhatsApp/ }).first(),
    ).toBeVisible();
    await marker.click();
    const detail = page.getByRole("dialog");
    await expect(detail).toContainText("via WhatsApp");
    await page.keyboard.press("Escape");
    await expect(detail).not.toBeVisible();

    // Reject one via the modal → notice, pending row gone.
    await openIntegrations(page);
    const meeting = page
      .locator("li[data-candidate-id]")
      .filter({ hasText: /Team meeting/i })
      .first();
    await meeting.getByRole("button", { name: "Dismiss" }).click();
    await expect(page.getByRole("dialog")).toContainText(
      "don't come back on re-scan",
    );
    await page.getByRole("button", { name: "Dismiss event" }).click();
    await expect(page.getByText(/Dismissed\. It won't come back/)).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Team meeting/i }),
    ).toHaveCount(0);

    // Re-sync: the second worker run must not resurrect a reviewed candidate
    // or duplicate the settled event.
    await page.setInputFiles('input[type="file"]', SAMPLE);
    await expect(page.getByText("Queued", { exact: true }).first()).toBeVisible();
    const second = await findActiveRun();
    runIds.push(second.id);
    if (second.storage_path !== null) bucketPaths.push(second.storage_path);
    const secondJobId = await findJobForRun(second.id);
    jobIds.push(secondJobId);

    const secondWorkerOutput = runWorkerOnce();
    expect(secondWorkerOutput).toContain(`settled job=${secondJobId}`);
    expect(secondWorkerOutput).toContain("status=succeeded");

    await expect(page.getByText("Done", { exact: true })).toHaveCount(2, {
      timeout: 90_000,
    });
    await expect(
      page.getByRole("heading", { name: /Birthday party/i }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: /Team meeting/i }),
    ).toHaveCount(0);

    const candidatesTotal = await service
      .from("integration_candidates")
      .select("id", { count: "exact", head: true })
      .eq("user_id", qa1Id);
    expect(candidatesTotal.error).toBeNull();
    expect(candidatesTotal.count).toBe(5);
    expect(await countWhatsAppEvents()).toBe(1);
  });

  test("automatic upload settles to added events with no pending review", async ({
    page,
  }) => {
    /* Task B4 — seed the saved default so the radio starts on automatic; the
       reservation then persists the same mode and records it on the run. */
    const connectionId = await seedWhatsAppConnection({
      review_mode: "automatic",
    });
    await openIntegrations(page);
    await expect(
      page.getByRole("radio", { name: "Add automatically" }),
    ).toBeChecked();

    await page.setInputFiles('input[type="file"]', SAMPLE);
    await expect(page.getByText("Queued", { exact: true }).first()).toBeVisible();
    const run = await findActiveRun();
    runIds.push(run.id);
    if (run.storage_path !== null) bucketPaths.push(run.storage_path);
    const jobId = await findJobForRun(run.id);
    jobIds.push(jobId);

    const workerOutput = runWorkerOnce();
    expect(workerOutput).toContain(`settled job=${jobId}`);
    expect(workerOutput).toContain("status=succeeded");

    await expect(page.getByText("Done", { exact: true }).first()).toBeVisible({
      timeout: 90_000,
    });

    const runRow = await service
      .from("integration_runs")
      .select("status, message_count, candidate_count, review_mode")
      .eq("id", run.id)
      .single();
    expect(runRow.error, `run read: ${runRow.error?.message}`).toBeNull();
    expect(runRow.data).toMatchObject({
      status: "succeeded",
      message_count: 10,
      candidate_count: 5,
      review_mode: "automatic",
    });

    const candidates = await service
      .from("integration_candidates")
      .select("id, status, event_id, fingerprint")
      .eq("run_id", run.id);
    expect(candidates.error, `candidate read: ${candidates.error?.message}`).toBeNull();
    expect(candidates.data?.length).toBe(5);
    expect(
      candidates.data?.every(
        (row) => row.status === "confirmed" && row.event_id !== null,
      ),
    ).toBe(true);
    const events = await service
      .from("events")
      .select("id, source_ref")
      .eq("user_id", qa1Id)
      .eq("source", "whatsapp");
    expect(events.error, `event read: ${events.error?.message}`).toBeNull();
    expect(events.data?.length).toBe(5);
    const refs = new Set((candidates.data ?? []).map((row) => row.fingerprint));
    expect(
      events.data?.every((row) => refs.has(row.source_ref)),
      "every event must match a candidate fingerprint",
    ).toBe(true);

    // The poll settles the automatic run's candidates out of review: the
    // confirmed rows render and no "Add to calendar" action exists at all.
    await expect(page.locator("[data-confirmed-candidate-id]")).toHaveCount(5, {
      timeout: 30_000,
    });
    await expect(
      page.locator("main").getByRole("button", { name: "Add to calendar" }),
    ).toHaveCount(0);

    // The auto-added events are real calendar markers.
    await page.goto("/calendar");
    const marker = page.locator('[data-source="whatsapp"]').first();
    await expect(marker).toBeVisible();
    await expect(marker).toContainText("From WhatsApp");

    // Only the saved default mode changed on the transport row.
    const connection = await service
      .from("integration_connections")
      .select("mode, status, review_mode")
      .eq("id", connectionId)
      .single();
    expect(connection.error, `connection read: ${connection.error?.message}`).toBeNull();
    expect(connection.data).toMatchObject({
      mode: "export",
      status: "disconnected",
      review_mode: "automatic",
    });
  });

  test("the saved connection default preselects the review mode radio", async ({
    page,
  }) => {
    const connectionId = await seedWhatsAppConnection({
      review_mode: "automatic",
    });
    await openIntegrations(page);
    const manual = page.getByRole("radio", { name: "Review each event" });
    const automatic = page.getByRole("radio", { name: "Add automatically" });

    await expect(automatic).toBeChecked();
    await expect(manual).not.toBeChecked();
    await expect(
      page.getByText(
        "Detected events are added to your calendar when the scan finishes.",
      ),
    ).toBeVisible();

    const patched = await service
      .from("integration_connections")
      .update({ review_mode: "manual" })
      .eq("id", connectionId);
    expect(patched.error, `manual default write: ${patched.error?.message}`).toBeNull();

    await openIntegrations(page);
    await expect(manual).toBeChecked();
    await expect(automatic).not.toBeChecked();
    await expect(
      page.getByText("Detected events wait for your review."),
    ).toBeVisible();
  });

  test("an upload patches only the saved settings on a live connected row", async ({
    page,
  }) => {
    /* Task B3/C4 carry — a live-linked row must survive an export whose
       settings are changed: `reserveExportRun` may write the saved defaults
       and nothing else (mode/status keep their transport meaning). */
    const connectionId = await seedWhatsAppConnection({
      mode: "live",
      status: "connected",
      review_mode: "manual",
    });
    await openIntegrations(page);
    await expect(
      page.getByRole("radio", { name: "Review each event" }),
    ).toBeChecked();

    await page.getByText("Add automatically", { exact: true }).click();
    await expect(
      page.getByRole("radio", { name: "Add automatically" }),
    ).toBeChecked();

    await page.setInputFiles('input[type="file"]', SAMPLE);
    await expect(page.getByText("Queued", { exact: true }).first()).toBeVisible();
    const run = await findActiveRun();
    runIds.push(run.id);
    if (run.storage_path !== null) bucketPaths.push(run.storage_path);
    const jobId = await findJobForRun(run.id);
    jobIds.push(jobId);

    const connection = await service
      .from("integration_connections")
      .select("mode, status, review_mode, date_order, detect_relative_dates")
      .eq("id", connectionId)
      .single();
    expect(connection.error, `connection read: ${connection.error?.message}`).toBeNull();
    expect(connection.data).toMatchObject({
      mode: "live",
      status: "connected",
      review_mode: "automatic",
      date_order: "DMY",
      detect_relative_dates: false,
    });
  });

  test("the saved detection defaults preselect the controls and travel with the upload", async ({
    page,
  }) => {
    /* C4 — the connection's saved date order / relative toggle preselect both
       controls. Every server-action POST is aborted (and its body kept) so
       the changed choices can be proven in the upload payload without
       reserving anything. */
    await seedWhatsAppConnection({
      review_mode: "manual",
      date_order: "MDY",
      detect_relative_dates: true,
    });
    const actionBodies: string[] = [];
    await page.route(/\/integrations(\?|$)/, async (route) => {
      const request = route.request();
      if (request.method() === "POST" && request.headers()["next-action"]) {
        actionBodies.push(request.postData() ?? "");
        await route.abort();
        return;
      }
      await route.continue();
    });

    await openIntegrations(page);
    await expect(
      page.getByRole("radiogroup", {
        name: "Date order for ambiguous dates (9/10)",
      }),
    ).toBeVisible();
    const dayFirst = page.getByRole("radio", { name: "Day first (31/12)" });
    const monthFirst = page.getByRole("radio", { name: "Month first (12/31)" });
    const relative = page.getByRole("checkbox", {
      name: "Also detect weekday and relative dates",
    });

    await expect(monthFirst).toBeChecked();
    await expect(dayFirst).not.toBeChecked();
    await expect(relative).toBeChecked();
    await expect(
      page.getByText(
        "Only when the message also has a time or an academic keyword (submission, exam, deadline…).",
      ),
    ).toBeVisible();

    /* The visible pill toggles the hidden radio; the label toggles the box. */
    await page.getByText("Day first (31/12)", { exact: true }).click();
    await expect(dayFirst).toBeChecked();
    await relative.click();
    await expect(relative).not.toBeChecked();

    actionBodies.length = 0;
    await page.setInputFiles('input[type="file"]', SAMPLE);
    await expect
      .poll(() =>
        actionBodies.some(
          (body) =>
            body.includes('"dateOrder":"DMY"') &&
            body.includes('"detectRelativeDates":false'),
        ),
      )
      .toBe(true);
  });

  test("an MDY export with the default settings detects only the two dated events", async ({
    page,
  }) => {
    /* C4 — the synthetic MDY-envelope fixture with relative detection off:
       exactly the two explicit text dates survive. */
    await seedWhatsAppConnection({
      review_mode: "manual",
      date_order: "DMY",
      detect_relative_dates: false,
    });
    await openIntegrations(page);
    await page.setInputFiles('input[type="file"]', MDY_SAMPLE);
    await expect(page.getByText("Queued", { exact: true }).first()).toBeVisible();
    const run = await findActiveRun();
    runIds.push(run.id);
    if (run.storage_path !== null) bucketPaths.push(run.storage_path);
    const jobId = await findJobForRun(run.id);
    jobIds.push(jobId);

    const workerOutput = runWorkerOnce();
    expect(workerOutput).toContain(`settled job=${jobId}`);
    expect(workerOutput).toContain("status=succeeded");
    await expect(page.getByText("Done", { exact: true }).first()).toBeVisible({
      timeout: 90_000,
    });

    const runRow = await service
      .from("integration_runs")
      .select("status, message_count, candidate_count")
      .eq("id", run.id)
      .single();
    expect(runRow.error, `run read: ${runRow.error?.message}`).toBeNull();
    expect(runRow.data).toMatchObject({
      status: "succeeded",
      message_count: 9,
      candidate_count: 2,
    });

    const timeZone = await profileTimeZone();
    const candidates = await service
      .from("integration_candidates")
      .select("status, start_at")
      .eq("run_id", run.id);
    expect(candidates.error, `candidate read: ${candidates.error?.message}`).toBeNull();
    expect(candidates.data?.length).toBe(2);
    expect(candidates.data?.every((row) => row.status === "pending")).toBe(true);
    const localDates = (candidates.data ?? [])
      .map((row) => formatTaskDueDate(row.start_at, timeZone))
      .sort();
    expect(localDates).toEqual(["Sat, Sep 12", "Sun, Sep 20"]);
  });

  test("enabling relative dates adds the three guarded weekday detections", async ({
    page,
  }) => {
    /* C4 — flipping the saved default via the UI persists it with the
       reservation, so the worker's extraction finds the three weekday
       mentions that pair an academic keyword with the relative phrase. */
    const connectionId = await seedWhatsAppConnection({
      review_mode: "manual",
      date_order: "DMY",
      detect_relative_dates: false,
    });
    await openIntegrations(page);
    const relative = page.getByRole("checkbox", {
      name: "Also detect weekday and relative dates",
    });
    await expect(relative).not.toBeChecked();
    await relative.click();
    await expect(relative).toBeChecked();

    await page.setInputFiles('input[type="file"]', MDY_SAMPLE);
    await expect(page.getByText("Queued", { exact: true }).first()).toBeVisible();
    const run = await findActiveRun();
    runIds.push(run.id);
    if (run.storage_path !== null) bucketPaths.push(run.storage_path);
    const jobId = await findJobForRun(run.id);
    jobIds.push(jobId);

    const workerOutput = runWorkerOnce();
    expect(workerOutput).toContain(`settled job=${jobId}`);
    expect(workerOutput).toContain("status=succeeded");
    await expect(page.getByText("Done", { exact: true }).first()).toBeVisible({
      timeout: 90_000,
    });

    const saved = await service
      .from("integration_connections")
      .select("date_order, detect_relative_dates")
      .eq("id", connectionId)
      .single();
    expect(saved.error, `connection read: ${saved.error?.message}`).toBeNull();
    expect(saved.data).toMatchObject({
      date_order: "DMY",
      detect_relative_dates: true,
    });

    const runRow = await service
      .from("integration_runs")
      .select("status, message_count, candidate_count")
      .eq("id", run.id)
      .single();
    expect(runRow.error, `run read: ${runRow.error?.message}`).toBeNull();
    expect(runRow.data).toMatchObject({
      status: "succeeded",
      message_count: 9,
      candidate_count: 5,
    });

    const timeZone = await profileTimeZone();
    const candidates = await service
      .from("integration_candidates")
      .select("status, start_at")
      .eq("run_id", run.id);
    expect(candidates.error, `candidate read: ${candidates.error?.message}`).toBeNull();
    expect(candidates.data?.length).toBe(5);
    expect(candidates.data?.every((row) => row.status === "pending")).toBe(true);
    const localDates = (candidates.data ?? [])
      .map((row) => formatTaskDueDate(row.start_at, timeZone))
      .sort();
    expect(localDates).toEqual([
      "Fri, Sep 18",
      "Mon, Sep 14",
      "Sat, Sep 12",
      "Sun, Sep 20",
      "Tue, Sep 15",
    ]);
  });
});

// Deliberately outside the Python-skipped describe: the guard rejects the
// upload before anything reaches the queue, so this needs no Python at all.
test.describe("whatsapp export rate limit (46.15)", () => {
  test("the 20-runs-per-day limit returns sanitized server copy", async ({
    page,
  }) => {
    const seedIds: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      const id = randomUUID();
      const { error } = await service.from("integration_runs").insert({
        id,
        user_id: qa1Id,
        mode: "export",
        status: "failed",
        storage_path: `${qa1Id}/${id}/export.txt`,
        created_at: new Date().toISOString(),
      });
      expect(error, `seed run ${i}: ${error?.message}`).toBeNull();
      seedIds.push(id);
    }
    runIds.push(...seedIds);
    await openIntegrations(page);
    await page.setInputFiles('input[type="file"]', SAMPLE);
    await expect(
      page.getByText(/20 scans in the last 24 hours/),
    ).toBeVisible();
  });
});
