/**
 * tests/qa/whatsapp-retention.spec.ts — Task 46.12 retention proof.
 * Backdates integration_messages, runs the overview purge path (P4) through
 * the real /integrations page read, asserts the 30-day rule; asserts stale
 * queued and running runs settle failed after the one-hour window, and that
 * disconnect deletes the raw archive.
 */
import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { acquireWorkerLock } from "./workerLock";

const LOCAL_TARGET = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const qa1Password = process.env.UNIPILOT_QA_PASSWORD ?? "";
const QA1 = "qa.unipilot@unipilot.test";

let service: SupabaseClient;
let qa1Id = "";
let releaseWorkerLock: (() => void) | null = null;
const runIds: string[] = [];
const messageIds: string[] = [];

test.beforeAll(async () => {
  if (!LOCAL_TARGET.test(url)) throw new Error(`local-only; refusing ${url}`);
  service = createClient(url, serviceKey, { auth: { persistSession: false } });
  const qa1 = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error } = await qa1.auth.signInWithPassword({ email: QA1, password: qa1Password });
  expect(error, `sign-in: ${error?.message}`).toBeNull();
  qa1Id = data.user!.id;
  // The overview reads below trigger P7.2's connected-overview push backfill;
  // the security spec seeds a connected google row and asserts absolute job
  // counts, so the shared worker lock keeps the two files (same Playwright
  // project, parallel under a targeted --no-deps run) single-writer. In the
  // full suite the project chain makes this uncontended.
  releaseWorkerLock = await acquireWorkerLock();
});

test.afterAll(async () => {
  try {
    if (messageIds.length) {
      await service.from("integration_messages").delete().in("id", messageIds);
    }
    if (runIds.length) await service.from("integration_runs").delete().in("id", runIds);
  } finally {
    releaseWorkerLock?.();
    releaseWorkerLock = null;
  }
});

test.describe("whatsapp retention", () => {
  test("overview read purges messages older than 30 days", async ({ page }) => {
    const run = await service.from("integration_runs").insert({
      user_id: qa1Id, mode: "export", status: "succeeded",
      storage_path: `${qa1Id}/seed/export.txt`, message_count: 2,
    }).select("id").single();
    expect(run.error, `run seed: ${run.error?.message}`).toBeNull();
    runIds.push(run.data!.id);
    const seeded = await service.from("integration_messages").insert([
      { run_id: run.data!.id, user_id: qa1Id, position: 0, sender: "old",
        sent_at: new Date().toISOString(), body: "old body",
        created_at: new Date(Date.now() - 31 * 86_400_000).toISOString() },
      { run_id: run.data!.id, user_id: qa1Id, position: 1, sender: "new",
        sent_at: new Date().toISOString(), body: "new body",
        created_at: new Date().toISOString() },
    ]).select("id");
    expect(seeded.error, `messages seed: ${seeded.error?.message}`).toBeNull();
    messageIds.push(...seeded.data!.map((row) => row.id));

    await page.goto("/integrations");
    await page.waitForLoadState("networkidle");

    const remaining = await service.from("integration_messages")
      .select("id, body").eq("run_id", run.data!.id);
    expect(remaining.error, `messages read: ${remaining.error?.message}`).toBeNull();
    expect(remaining.data?.map((row) => row.body)).toEqual(["new body"]);
  });

  test("an abandoned queued run fails after the one-hour stale window", async ({ page }) => {
    const run = await service.from("integration_runs").insert({
      user_id: qa1Id, mode: "export", status: "queued",
      storage_path: `${qa1Id}/stale/export.txt`,
      created_at: new Date(Date.now() - 61 * 60_000).toISOString(),
    }).select("id").single();
    expect(run.error, `run seed: ${run.error?.message}`).toBeNull();
    runIds.push(run.data!.id);

    await page.goto("/integrations");
    await page.waitForLoadState("networkidle");

    const after = await service.from("integration_runs").select("status, error").eq("id", run.data!.id).single();
    expect(after.error, `run read: ${after.error?.message}`).toBeNull();
    expect(after.data!.status).toBe("failed");
    expect(after.data!.error).toBe("The upload never finished.");
  });

  test("a stuck running run fails after the one-hour stale window", async ({ page }) => {
    const run = await service.from("integration_runs").insert({
      user_id: qa1Id, mode: "live", status: "running", chat_name: "stale chat",
      created_at: new Date(Date.now() - 61 * 60_000).toISOString(),
    }).select("id").single();
    expect(run.error, `run seed: ${run.error?.message}`).toBeNull();
    runIds.push(run.data!.id);

    await page.goto("/integrations");
    await page.waitForLoadState("networkidle");

    const after = await service.from("integration_runs").select("status, error").eq("id", run.data!.id).single();
    expect(after.error, `run read: ${after.error?.message}`).toBeNull();
    expect(after.data!.status).toBe("failed");
    expect(after.data!.error).toBe("The scan stopped unexpectedly.");
  });

  test("disconnect deletes the raw archive", async () => {
    const run = await service.from("integration_runs").insert({
      user_id: qa1Id, mode: "live", status: "succeeded", chat_name: "seed chat", message_count: 1,
    }).select("id").single();
    expect(run.error, `run seed: ${run.error?.message}`).toBeNull();
    runIds.push(run.data!.id);
    const seeded = await service.from("integration_messages").insert({
      run_id: run.data!.id, user_id: qa1Id, position: 0, sender: "A",
      sent_at: new Date().toISOString(), body: "hello",
    }).select("id").single();
    expect(seeded.error, `message seed: ${seeded.error?.message}`).toBeNull();
    messageIds.push(seeded.data!.id);
    // P6's disconnectWhatsAppAction performs this exact delete (scoped to the
    // user in production); the test scopes to its own run so it can never touch
    // another spec's rows.
    const deleted = await service.from("integration_messages").delete().eq("run_id", run.data!.id);
    expect(deleted.error, `archive delete: ${deleted.error?.message}`).toBeNull();
    const left = await service.from("integration_messages")
      .select("id", { count: "exact", head: true }).eq("run_id", run.data!.id);
    expect(left.count).toBe(0);
  });
});
