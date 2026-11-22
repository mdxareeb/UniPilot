import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import {
  BRIDGE_HEARTBEAT_STALE_MS,
  BRIDGE_START_GRACE_MS,
  deriveGroupSyncState,
  groupCandidateRowToItem,
  groupRowToItem,
  sortGroups,
  type SessionFacts,
} from "../../lib/data/groupSyncValues";

/**
 * WhatsApp group live sync (Stage 1): the Integrations panel.
 *
 * Two layers, both honest about what they prove:
 *
 * - "pure": the state machine that turns database facts into the one state the
 *   panel shows, including the rule that a link is never "connected" without a
 *   running bridge. No browser.
 * - "rendered": the real page against SEEDED `whatsapp_sessions` /
 *   `monitored_groups` rows (QA1, local stack). The bridge is NOT running in
 *   QA, so these specs prove the UI and the Server Actions, never WhatsApp
 *   itself. The QR in the `qr_ready` spec is a placeholder payload written
 *   through the real RPC to prove the image path; it is not a login QR.
 *
 * The panel is gated by the server flag `UNIPILOT_WHATSAPP_BRIDGE=1`. The
 * committed server has it off, so the flag-on specs skip with the reason and
 * the flag-off spec asserts the honest disabled state. Run the flag-on
 * specs with the flag set in the shell that starts the suite.
 */

const ENABLED = process.env.UNIPILOT_WHATSAPP_BRIDGE === "1";
const LOCAL_TARGET = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;
const NOW = Date.parse("2026-11-18T12:00:00.000Z");
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

function facts(overrides: Partial<SessionFacts> = {}): SessionFacts {
  return {
    status: "disconnected",
    desired_state: "disconnected",
    last_error: null,
    bridge_heartbeat_at: null,
    requested_at: null,
    ...overrides,
  };
}

test.describe("group sync state machine (pure)", () => {
  test("never linked is not linked", () => {
    expect(deriveGroupSyncState(null, NOW)).toBe("disconnected");
    expect(deriveGroupSyncState(facts(), NOW)).toBe("disconnected");
  });

  test("a live bridge reports the link's real status", () => {
    const alive = { bridge_heartbeat_at: iso(-5_000), desired_state: "connected" as const };
    expect(deriveGroupSyncState(facts({ ...alive, status: "qr_ready" }), NOW)).toBe("qr_ready");
    expect(deriveGroupSyncState(facts({ ...alive, status: "connected" }), NOW)).toBe("connected");
    expect(deriveGroupSyncState(facts({ ...alive, status: "disconnected" }), NOW)).toBe("starting");
  });

  test("a fresh request waits for the bridge, then admits it is not running", () => {
    const requested = (agoMs: number) =>
      facts({ desired_state: "connected", requested_at: iso(-agoMs) });
    expect(deriveGroupSyncState(requested(2_000), NOW)).toBe("starting");
    expect(deriveGroupSyncState(requested(BRIDGE_START_GRACE_MS - 1), NOW)).toBe("starting");
    expect(deriveGroupSyncState(requested(BRIDGE_START_GRACE_MS + 1_000), NOW)).toBe(
      "bridge_offline",
    );
  });

  test("a heartbeat from before the request does not end the grace period", () => {
    const state = deriveGroupSyncState(
      facts({
        desired_state: "connected",
        requested_at: iso(-3_000),
        bridge_heartbeat_at: iso(-3_600_000),
      }),
      NOW,
    );
    expect(state).toBe("starting");
  });

  test("a stale heartbeat is never shown as connected", () => {
    for (const status of ["connected", "qr_ready"] as const) {
      expect(
        deriveGroupSyncState(
          facts({
            status,
            desired_state: "connected",
            requested_at: iso(-3_600_000),
            bridge_heartbeat_at: iso(-(BRIDGE_HEARTBEAT_STALE_MS + 5_000)),
          }),
          NOW,
        ),
      ).toBe("bridge_offline");
    }
  });

  test("disconnect settles through disconnecting to disconnected or error", () => {
    expect(
      deriveGroupSyncState(facts({ status: "connected", desired_state: "disconnected" }), NOW),
    ).toBe("disconnecting");
    expect(
      deriveGroupSyncState(facts({ last_error: "WhatsApp unlinked this device." }), NOW),
    ).toBe("error");
  });

  test("groups: active first, then by name; blank names are labelled", () => {
    const rows = [
      { id: "3", group_name: "Zoology", is_active: false, activated_at: null, last_synced_at: null },
      { id: "1", group_name: "Algebra", is_active: false, activated_at: null, last_synced_at: null },
      { id: "2", group_name: "Physics", is_active: true, activated_at: iso(0), last_synced_at: null },
      { id: "4", group_name: "   ", is_active: false, activated_at: null, last_synced_at: null },
    ].map(groupRowToItem);
    expect(sortGroups(rows).map((g) => g.name)).toEqual([
      "Physics",
      "Algebra",
      "Unnamed group",
      "Zoology",
    ]);
  });
});

test.describe("group sync review items (pure)", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: "c1",
    title: "Assignment 3",
    kind: "task",
    task_type: "assignment",
    event_type: null,
    start_at: "2026-11-19T18:30:00.000Z",
    all_day: true,
    message_sender: "Prof Rao",
    message_text: "CS301 assignment 3 due Friday",
    confidence: 0.724,
    proposed_subject_name: null,
    group_name: "CS 2026",
    subject: { name: "Data Structures" },
    ...over,
  });
  const map = (over?: Record<string, unknown>) =>
    groupCandidateRowToItem(
      row(over) as unknown as Parameters<typeof groupCandidateRowToItem>[0],
      "Asia/Kolkata",
    );

  test("a dated task is labelled in the profile zone, with a whole-percent score", () => {
    const item = map();
    expect(item).toMatchObject({
      kind: "task",
      typeLabel: "Assignment",
      subjectName: "Data Structures",
      confidencePercent: 72,
      proposedSubjectName: null,
    });
    expect(item.whenLabel).toMatch(/Nov 20/);
  });

  test("an undated task has no date and an exam shows its time", () => {
    expect(map({ start_at: null }).whenLabel).toBeNull();
    const exam = map({
      kind: "event",
      event_type: "exam",
      task_type: null,
      all_day: false,
      start_at: "2026-12-05T04:30:00.000Z",
    });
    expect(exam.typeLabel).toBe("Exam");
    expect(exam.whenLabel).toMatch(/Dec 5.*10:00/);
  });

  test("an unsorted item and a proposed course are told apart; an unscored one has no percent", () => {
    const item = map({
      subject: null,
      proposed_subject_name: "Computer Networks",
      confidence: null,
    });
    expect(item.subjectName).toBeNull();
    expect(item.proposedSubjectName).toBe("Computer Networks");
    expect(item.confidencePercent).toBeNull();
  });
});

test.describe("group sync panel (rendered, flag off)", () => {
  test.skip(ENABLED, "UNIPILOT_WHATSAPP_BRIDGE=1: the disabled state is not reachable.");

  test("says plainly that it is not enabled and offers no control", async ({ page }) => {
    await page.goto("/integrations");
    await page.waitForLoadState("networkidle");

    const panel = page.locator('[data-groups-status]');
    await expect(panel).toHaveAttribute("data-groups-status", "not_enabled");
    await expect(panel).toContainText("Live group sync isn't enabled on this server.");
    await expect(panel.getByRole("button", { name: "Link WhatsApp" })).toHaveCount(0);
    await expect(panel.getByRole("switch")).toHaveCount(0);
  });
});

test.describe("group sync panel (rendered, flag on)", () => {
  test.skip(!ENABLED, "needs UNIPILOT_WHATSAPP_BRIDGE=1 on the server under test.");
  // Every test seeds and clears QA1's single `whatsapp_sessions` row, so they
  // must not run in parallel workers (one test's reset would wipe another's).
  test.describe.configure({ mode: "serial" });

  let service: SupabaseClient;
  let qa1Id = "";
  const integrationsKey = process.env.UNIPILOT_INTEGRATIONS_KEY ?? "";

  test.beforeAll(async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
    const password = process.env.UNIPILOT_QA_PASSWORD ?? "";
    if (!LOCAL_TARGET.test(url)) throw new Error("Refusing a non-local Supabase URL.");
    if (!anonKey || !serviceKey || !password || !integrationsKey) {
      throw new Error("Missing QA environment (see QA_SESSION.md).");
    }
    service = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const anon = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const signedIn = await anon.auth.signInWithPassword({
      email: "qa.unipilot@unipilot.test",
      password,
    });
    if (signedIn.error || !signedIn.data.user) throw new Error("QA1 sign-in failed.");
    qa1Id = signedIn.data.user.id;
  });

  async function reset() {
    await service.rpc("clear_whatsapp_session", { p_user_id: qa1Id });
    await service.from("monitored_groups").delete().eq("user_id", qa1Id);
    await service.from("whatsapp_sessions").delete().eq("user_id", qa1Id);
    // Only rows this spec can have created: group-sync provenance, the live
    // group queue, and the spec's own subjects.
    await service
      .from("integration_candidates")
      .delete()
      .eq("user_id", qa1Id)
      .eq("origin", "live_group");
    await service.from("tasks").delete().eq("user_id", qa1Id).eq("source", "whatsapp_group");
    await service.from("events").delete().eq("user_id", qa1Id).eq("source", "whatsapp_group");
    await service
      .from("documents")
      .delete()
      .eq("user_id", qa1Id)
      .eq("source", "whatsapp_group");
    await service.from("subjects").delete().eq("user_id", qa1Id).like("name", "Groups Spec %");
  }

  async function seedSubject(name: string) {
    const { data, error } = await service
      .from("subjects")
      .insert({ user_id: qa1Id, name })
      .select("id")
      .single();
    expect(error).toBeNull();
    return data!.id as string;
  }

  async function seedCandidate(over: Record<string, unknown> = {}) {
    const fingerprint = `wg-spec-${randomUUID()}`;
    const { data, error } = await service
      .from("integration_candidates")
      .insert({
        user_id: qa1Id,
        run_id: null,
        fingerprint,
        title: "Spec assignment",
        start_at: new Date(Date.now() + 3 * 86_400_000).toISOString(),
        all_day: true,
        message_sender: "Prof Rao",
        message_text: "Spec assignment due soon",
        status: "pending",
        origin: "live_group",
        kind: "task",
        task_type: "assignment",
        confidence: 0.7,
        group_name: "Spec group",
        ...over,
      })
      .select("id, fingerprint")
      .single();
    expect(error).toBeNull();
    return data!;
  }

  test.beforeEach(reset);
  test.afterEach(reset);

  async function seedSession(row: {
    status?: string;
    desired_state?: string;
    last_error?: string | null;
    heartbeatAgoMs?: number | null;
    requestedAgoMs?: number | null;
  }) {
    const { error } = await service.from("whatsapp_sessions").insert({
      user_id: qa1Id,
      status: row.status ?? "disconnected",
      desired_state: row.desired_state ?? "disconnected",
      last_error: row.last_error ?? null,
      bridge_heartbeat_at:
        row.heartbeatAgoMs == null ? null : new Date(Date.now() - row.heartbeatAgoMs).toISOString(),
      requested_at:
        row.requestedAgoMs == null ? null : new Date(Date.now() - row.requestedAgoMs).toISOString(),
    });
    expect(error).toBeNull();
  }

  async function seedGroups(groups: Array<{ jid: string; name: string; active?: boolean }>) {
    const { error } = await service.from("monitored_groups").insert(
      groups.map((g) => ({
        user_id: qa1Id,
        group_jid: g.jid,
        group_name: g.name,
        is_active: g.active ?? false,
      })),
    );
    expect(error).toBeNull();
  }

  async function open(page: Page) {
    await page.goto("/integrations");
    await page.waitForLoadState("networkidle");
    return page.locator("[data-groups-status]");
  }

  test("not linked: offers the link and states the risk", async ({ page }) => {
    const panel = await open(page);
    await expect(panel).toHaveAttribute("data-groups-status", "disconnected");
    await expect(panel.getByRole("button", { name: "Link WhatsApp" })).toBeVisible();
    await expect(panel).toContainText("unofficial linked-device connection");
    await expect(panel.getByRole("switch")).toHaveCount(0);
  });

  test("link request writes the intent and then admits the bridge is not running", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const panel = await open(page);
    await panel.getByRole("button", { name: "Link WhatsApp" }).click();

    // First prove the intent reached the database, then the UI's reaction.
    await expect
      .poll(
        async () =>
          (
            await service
              .from("whatsapp_sessions")
              .select("desired_state")
              .eq("user_id", qa1Id)
              .maybeSingle()
          ).data?.desired_state ?? null,
        { message: `the link request never reached the database (page errors: ${pageErrors.join(" | ")})` },
      )
      .toBe("connected");
    await expect(panel).toHaveAttribute("data-groups-status", "starting");

    const row = await service
      .from("whatsapp_sessions")
      .select("desired_state, last_error")
      .eq("user_id", qa1Id)
      .single();
    expect(row.data?.desired_state).toBe("connected");
    expect(row.data?.last_error).toBeNull();

    // No bridge is running in QA: once the grace window passes the panel must
    // say so instead of waiting forever or inventing a QR.
    await service
      .from("whatsapp_sessions")
      .update({ requested_at: new Date(Date.now() - 120_000).toISOString() })
      .eq("user_id", qa1Id);
    const reloaded = await open(page);
    await expect(reloaded).toHaveAttribute("data-groups-status", "bridge_offline");
    await expect(reloaded).toContainText("The WhatsApp bridge isn't running");
    await expect(reloaded.locator("[data-groups-qr]")).toHaveCount(0);
  });

  test("qr_ready: renders the QR image only while the bridge reports it", async ({ page }) => {
    await seedSession({
      status: "qr_ready",
      desired_state: "connected",
      heartbeatAgoMs: 2_000,
      requestedAgoMs: 30_000,
    });
    // A placeholder payload through the real RPC: proves the image path only.
    const stored = await service.rpc("set_whatsapp_session_qr", {
      p_user_id: qa1Id,
      p_qr: "unipilot-qa-placeholder-not-a-login-qr",
      p_key: integrationsKey,
      p_ttl_seconds: 60,
    });
    expect(stored.error).toBeNull();

    const panel = await open(page);
    await expect(panel).toHaveAttribute("data-groups-status", "qr_ready");
    const qr = panel.locator("[data-groups-qr]");
    await expect(qr).toBeVisible();
    expect(await qr.getAttribute("src")).toMatch(/^data:image\/png;base64,/);
    await expect(panel).toContainText("Linked devices");
  });

  test("qr_ready with an expired/absent QR does not fake one", async ({ page }) => {
    await seedSession({
      status: "qr_ready",
      desired_state: "connected",
      heartbeatAgoMs: 2_000,
      requestedAgoMs: 30_000,
    });
    const panel = await open(page);
    await expect(panel).toHaveAttribute("data-groups-status", "qr_ready");
    await expect(panel.locator("[data-groups-qr]")).toHaveCount(0);
    await expect(panel).toContainText("Preparing the QR code");
  });

  test("connected: lists groups, defaults off, and says when capture starts", async ({ page }) => {
    await seedSession({ status: "connected", desired_state: "connected", heartbeatAgoMs: 3_000 });
    await seedGroups([
      { jid: "111@g.us", name: "CS301 Data Structures", active: true },
      { jid: "222@g.us", name: "Family chat" },
    ]);
    const panel = await open(page);

    await expect(panel).toHaveAttribute("data-groups-status", "connected");
    await expect(panel.getByRole("switch")).toHaveCount(2);
    await expect(panel.getByRole("switch", { name: "Read CS301 Data Structures" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    const family = panel.getByRole("switch", { name: "Read Family chat" });
    await expect(family).toHaveAttribute("aria-checked", "false");
    await expect(panel.locator('[data-group-id]').filter({ hasText: "Family chat" })).toContainText(
      "Turning this on captures messages from that moment forward.",
    );
    await expect(panel).toContainText("1 of 2 on");
  });

  test("toggling a group persists, stamps activated_at, and can be undone", async ({ page }) => {
    await seedSession({ status: "connected", desired_state: "connected", heartbeatAgoMs: 3_000 });
    await seedGroups([{ jid: "222@g.us", name: "Family chat" }]);
    const panel = await open(page);
    const sw = panel.getByRole("switch", { name: "Read Family chat" });

    await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", "true");
    await expect
      .poll(async () => {
        const r = await service
          .from("monitored_groups")
          .select("is_active, activated_at")
          .eq("user_id", qa1Id)
          .single();
        return r.data?.is_active === true && r.data?.activated_at !== null;
      })
      .toBe(true);

    await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", "false");
    await expect
      .poll(async () => {
        const r = await service
          .from("monitored_groups")
          .select("is_active")
          .eq("user_id", qa1Id)
          .single();
        return r.data?.is_active;
      })
      .toBe(false);
  });

  test("a stale heartbeat is shown as 'bridge not running', never as linked", async ({ page }) => {
    await seedSession({
      status: "connected",
      desired_state: "connected",
      heartbeatAgoMs: BRIDGE_HEARTBEAT_STALE_MS + 60_000,
      requestedAgoMs: 3_600_000,
    });
    await seedGroups([{ jid: "111@g.us", name: "CS301" }]);
    const panel = await open(page);

    await expect(panel).toHaveAttribute("data-groups-status", "bridge_offline");
    await expect(panel).toContainText("Bridge not running");
    await expect(panel).not.toContainText("Linked");
    await expect(panel).toContainText("Your link and your group choices are kept.");
    // Choices stay editable: they are plain settings, kept for when it returns.
    await expect(panel.getByRole("switch")).toHaveCount(1);
  });

  test("a failed link shows the sanitized reason and offers a retry", async ({ page }) => {
    await seedSession({
      status: "disconnected",
      desired_state: "disconnected",
      last_error: "The QR code expired before it was scanned. Request a new one.",
    });
    const panel = await open(page);
    await expect(panel).toHaveAttribute("data-groups-status", "error");
    await expect(panel.getByRole("alert")).toContainText("QR code expired");
    await expect(panel.getByRole("button", { name: "Try linking again" })).toBeVisible();
  });

  test("disconnect with no bridge forgets locally and says to unlink on the phone", async ({ page }) => {
    await seedSession({
      status: "connected",
      desired_state: "connected",
      heartbeatAgoMs: BRIDGE_HEARTBEAT_STALE_MS + 60_000,
      requestedAgoMs: 3_600_000,
    });
    await service.rpc("set_whatsapp_creds", {
      p_user_id: qa1Id,
      p_creds: "{}",
      p_key: integrationsKey,
    });
    const panel = await open(page);

    await panel.getByRole("button", { name: "Disconnect" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Disconnect" }).click();

    await expect(panel).toHaveAttribute("data-groups-status", "disconnected");
    await expect(panel).toContainText("also remove UniPilot from WhatsApp");
    const creds = await service.rpc("get_whatsapp_creds", {
      p_user_id: qa1Id,
      p_key: integrationsKey,
    });
    expect(creds.data).toBeNull();
  });

  test("reduced motion: the switch still changes state instantly", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await seedSession({ status: "connected", desired_state: "connected", heartbeatAgoMs: 3_000 });
    await seedGroups([{ jid: "222@g.us", name: "Family chat" }]);
    const panel = await open(page);
    const sw = panel.getByRole("switch", { name: "Read Family chat" });

    await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", "true");
    const duration = await sw.evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(duration.split(",").every((d) => parseFloat(d) === 0)).toBe(true);
  });

  test("review: lists a pending suggestion even with nothing linked, then adds it as a task", async ({ page }) => {
    const subjectId = await seedSubject("Groups Spec Algorithms");
    const candidate = await seedCandidate({ subject_id: subjectId });

    const panel = await open(page);
    await expect(panel).toHaveAttribute("data-groups-status", "disconnected");
    const row = panel.locator(`[data-candidate-id="${candidate.id}"]`);
    await expect(row).toContainText("Spec assignment");
    await expect(row).toContainText("Groups Spec Algorithms");
    await expect(row).toContainText("70% sure");

    await row.getByRole("button", { name: "Add to tasks" }).click();
    await expect(row).toHaveCount(0);

    const task = await service
      .from("tasks")
      .select("title, subject_id, source_ref, task_type, status")
      .eq("user_id", qa1Id)
      .eq("source", "whatsapp_group")
      .single();
    expect(task.data).toMatchObject({
      title: "Spec assignment",
      subject_id: subjectId,
      source_ref: candidate.fingerprint,
      task_type: "assignment",
      status: "todo",
    });
    const settled = await service
      .from("integration_candidates")
      .select("status")
      .eq("id", candidate.id)
      .single();
    expect(settled.data?.status).toBe("confirmed");
  });

  test("review: a proposed new course is created only when the student adds the item", async ({ page }) => {
    const candidate = await seedCandidate({
      proposed_subject_name: "Groups Spec Networks",
      title: "Networks quiz",
      task_type: "quiz",
    });

    const panel = await open(page);
    const row = panel.locator(`[data-candidate-id="${candidate.id}"]`);
    await expect(row).toContainText("New course: Groups Spec Networks");
    const before = await service
      .from("subjects")
      .select("id")
      .eq("user_id", qa1Id)
      .eq("name", "Groups Spec Networks");
    expect(before.data).toHaveLength(0);

    await row
      .getByRole("button", { name: "Add and create Groups Spec Networks" })
      .click();
    await expect(row).toHaveCount(0);

    const subject = await service
      .from("subjects")
      .select("id")
      .eq("user_id", qa1Id)
      .eq("name", "Groups Spec Networks")
      .single();
    const task = await service
      .from("tasks")
      .select("subject_id, task_type")
      .eq("user_id", qa1Id)
      .eq("source", "whatsapp_group")
      .single();
    expect(task.data).toMatchObject({ subject_id: subject.data?.id, task_type: "quiz" });
  });

  test("review: an event suggestion is added to the calendar with its type and times", async ({ page }) => {
    const start = new Date(Date.now() + 5 * 86_400_000);
    start.setUTCHours(4, 30, 0, 0);
    const end = new Date(start.getTime() + 2 * 3_600_000);
    const candidate = await seedCandidate({
      kind: "event",
      title: "Spec midterm",
      task_type: null,
      event_type: "exam",
      all_day: false,
      start_at: start.toISOString(),
      end_at: end.toISOString(),
    });

    const panel = await open(page);
    const row = panel.locator(`[data-candidate-id="${candidate.id}"]`);
    await expect(row).toHaveAttribute("data-candidate-kind", "event");
    await row.getByRole("button", { name: "Add to calendar" }).click();
    await expect(row).toHaveCount(0);

    const event = await service
      .from("events")
      .select("title, type, all_day, start_at, end_at, source_ref")
      .eq("user_id", qa1Id)
      .eq("source", "whatsapp_group")
      .single();
    expect(event.data).toMatchObject({
      title: "Spec midterm",
      type: "exam",
      all_day: false,
      source_ref: candidate.fingerprint,
    });
    expect(new Date(event.data!.start_at).toISOString()).toBe(start.toISOString());
    expect(new Date(event.data!.end_at!).toISOString()).toBe(end.toISOString());
  });

  test("review: dismissing asks first, is final, and writes nothing", async ({ page }) => {
    const candidate = await seedCandidate();
    const panel = await open(page);
    const row = panel.locator(`[data-candidate-id="${candidate.id}"]`);

    await row.getByRole("button", { name: "Dismiss" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Keep it" }).click();
    await expect(row).toBeVisible();

    await row.getByRole("button", { name: "Dismiss" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Dismiss" }).click();
    await expect(row).toHaveCount(0);

    const settled = await service
      .from("integration_candidates")
      .select("status")
      .eq("id", candidate.id)
      .single();
    expect(settled.data?.status).toBe("rejected");
    const tasks = await service
      .from("tasks")
      .select("id")
      .eq("user_id", qa1Id)
      .eq("source", "whatsapp_group");
    expect(tasks.data).toHaveLength(0);
  });

  test("review: an already-decided suggestion cannot be added twice", async ({ page }) => {
    const candidate = await seedCandidate();
    const panel = await open(page);
    const row = panel.locator(`[data-candidate-id="${candidate.id}"]`);
    // Decided elsewhere (another tab) after this page loaded.
    await service
      .from("integration_candidates")
      .update({ status: "rejected" })
      .eq("id", candidate.id);
    await row.getByRole("button", { name: "Add to tasks" }).click();
    await expect(panel.getByRole("alert")).toContainText("already reviewed");
    const tasks = await service
      .from("tasks")
      .select("id")
      .eq("user_id", qa1Id)
      .eq("source", "whatsapp_group");
    expect(tasks.data).toHaveLength(0);
  });

  test("a group-sync task shows its course and where it came from on /tasks", async ({ page }) => {
    const subjectId = await seedSubject("Groups Spec Databases");
    const { error } = await service.from("tasks").insert({
      user_id: qa1Id,
      title: "Spec group task",
      status: "todo",
      subject_id: subjectId,
      source: "whatsapp_group",
      source_ref: `wg-spec-${randomUUID()}`,
      task_type: "assignment",
      confidence_score: 0.9,
    });
    expect(error).toBeNull();

    await page.goto("/tasks");
    await page.waitForLoadState("networkidle");
    const meta = page
      .locator("main")
      .getByText("Groups Spec Databases", { exact: false })
      .first();
    await expect(meta).toBeVisible();
    // Each metadata value is its own span inside one line: the parent holds all.
    await expect(meta.locator("xpath=..")).toContainText("From WhatsApp");
  });

  test("a synced file shows its summary, topics, course and origin on /documents", async ({ page }) => {
    const subjectId = await seedSubject("Groups Spec Compilers");
    const { error } = await service.from("documents").insert({
      user_id: qa1Id,
      name: "spec-week3-notes.pdf",
      storage_path: `${qa1Id}/spec/${randomUUID()}.pdf`,
      mime_type: "application/pdf",
      size_bytes: 1234,
      status: "uploaded",
      source: "whatsapp_group",
      file_sha256: randomUUID().replace(/-/g, "").padEnd(64, "0"),
      subject_id: subjectId,
      ai_summary: "Week 3: parsing and grammars.",
      topic_tags: ["parsing", "grammars"],
    });
    expect(error).toBeNull();

    await page.goto("/documents");
    await page.waitForLoadState("networkidle");
    const card = page
      .locator("[data-document-id]")
      .filter({ hasText: "spec-week3-notes.pdf" });
    await expect(card.locator('[data-document-source="whatsapp_group"]')).toHaveText(
      "From WhatsApp",
    );
    await expect(card.locator("[data-document-subject]")).toHaveText("Groups Spec Compilers");
    await expect(card.locator("[data-document-summary]")).toHaveText(
      "Week 3: parsing and grammars.",
    );
    await expect(card.locator("[data-document-tags]")).toContainText("parsing");
    await expect(card.locator("[data-document-tags]")).toContainText("grammars");
  });

  test("guests see the card and are routed to sign in, with no data read", async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    const restReads: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/rest/v1/")) restReads.push(req.url());
    });
    await page.goto("/integrations");
    await page.waitForLoadState("networkidle");

    const panel = page.locator("[data-groups-status]");
    await expect(panel).toHaveAttribute("data-groups-status", "disconnected");
    await expect(panel.getByRole("switch")).toHaveCount(0);
    expect(restReads.filter((u) => /whatsapp_sessions|monitored_groups/.test(u))).toEqual([]);
    await context.close();
  });
});
