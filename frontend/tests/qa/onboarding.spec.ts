/**
 * tests/qa/onboarding.spec.ts — Task 13.10's onboarding-persistence proof.
 *
 * Runs against the LOCAL stack with the two sanctioned QA identities
 * (QA_SESSION.md): QA1 drives the real flow through the real UI and ends
 * onboarding-complete; QA2 stays incomplete and proves skip, the redirect gate
 * and two-user isolation. Every database assertion goes through the service
 * role (Node-only) and every user-facing assertion through real browser
 * interactions — no forged sessions, no client storage, no hosted contact.
 *
 * State machine (tests in this file run in order in one worker):
 *   1. reset QA1 → complete through the UI → dashboard renders the facts.
 *   2. QA2 skips → completion stays NULL → a gated route sends QA2 back here.
 *   3. reset QA1 → delete its profile row (forced failure) → sanitized error,
 *      no completion, no subjects → restore the row → retry succeeds.
 *   4. call complete_onboarding twice → no duplicate subjects, no re-stamp.
 *   5. QA1's persisted onboarding is invisible to QA2 and vice versa.
 *
 * This project is a dependency of the workspace specs, so QA1 is left
 * completed: the redirect gate would otherwise bounce /tasks, /calendar,
 * /documents and /assistant into /onboarding for every later test.
 *
 * Run: `npx playwright test` (dev server up, local stack seeded per
 * QA_SESSION.md). The file is local-only by construction: the guard below
 * refuses any non-127.0.0.1/localhost target before creating a client.
 */
import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const LOCAL_TARGET = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const qa1Password = process.env.UNIPILOT_QA_PASSWORD ?? "";
const qa2Password = process.env.UNIPILOT_QA2_PASSWORD ?? "";

const QA1 = "qa.unipilot@unipilot.test";
const QA2 = "qa2.unipilot@unipilot.test";

/** The exact answers the UI test types, and the rows the database must show. */
const ANSWERS = {
  firstName: "QA",
  lastName: "One",
  institution: "UniPilot Test University",
  courseProgram: "Computer Science",
  academicYear: "Year 2",
  semester: "Semester 1",
  planningStyle: "Balanced",
  reminderLead: "1 week before",
  subjects: ["Linear Algebra", "Thermodynamics"],
} as const;

/** The expected persisted profile, mapped to the schema's values. */
const PERSISTED_PROFILE = {
  first_name: "QA",
  last_name: "One",
  institution: "UniPilot Test University",
  course_program: "Computer Science",
  academic_year: 2,
  semester: 1,
  planning_style: "balanced",
  reminder_lead: "1_week",
} as const;

/** Alphabetical: the database orders subjects by name (replace-the-set). */
const SUBJECTS = ["Linear Algebra", "Thermodynamics"];

/** The same answers as arguments to the security-invoker RPC (test 4). */
const RPC_ARGS = {
  p_first_name: "QA",
  p_last_name: "One",
  p_institution: "UniPilot Test University",
  p_course_program: "Computer Science",
  p_academic_year: 2,
  p_semester: 1,
  p_planning_style: "balanced",
  p_reminder_lead: "1_week",
  p_subjects: ["Thermodynamics", "Linear Algebra"],
};

let qa1Id = "";
let qa2Id = "";

function requireLocalEnvironment() {
  if (!LOCAL_TARGET.test(url)) {
    throw new Error(`onboarding QA is local-only; refusing target "${url || "(unset)"}"`);
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
}

function serviceClient(): SupabaseClient {
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signInClient(
  email: string,
  password: string,
): Promise<{ client: SupabaseClient; userId: string }> {
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  expect(error, `sign-in failed for ${email}: ${error?.message}`).toBeNull();
  return { client, userId: data.user!.id };
}

/** Drives the real login form — same path as tests/qa/auth.setup.ts. */
async function signInThroughUi(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Continue with Email" }).click();
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
}

async function resetOnboarding(service: SupabaseClient, userId: string) {
  const subjects = await service.from("subjects").delete().eq("user_id", userId);
  expect(subjects.error, `reset subjects: ${subjects.error?.message}`).toBeNull();

  const profile = await service
    .from("profiles")
    .update({
      first_name: null,
      last_name: null,
      institution: null,
      course_program: null,
      academic_year: null,
      semester: null,
      planning_style: null,
      reminder_lead: null,
      onboarding_completed_at: null,
    })
    .eq("id", userId);
  expect(profile.error, `reset profile: ${profile.error?.message}`).toBeNull();
}

async function readProfile(service: SupabaseClient, userId: string) {
  const { data, error } = await service
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  expect(error, `read profile: ${error?.message}`).toBeNull();
  return data;
}

async function readSubjects(service: SupabaseClient, userId: string) {
  const { data, error } = await service
    .from("subjects")
    .select("name")
    .eq("user_id", userId)
    .order("name");
  expect(error, `read subjects: ${error?.message}`).toBeNull();
  return (data ?? []).map((row) => row.name as string);
}

async function continueStep(page: Page) {
  await page.getByRole("button", { name: "Continue", exact: true }).click();
}

/** Fills every step and submits the final one; does not wait for the result. */
async function fillAndSubmitOnboarding(page: Page) {
  await page.locator("#firstName").fill(ANSWERS.firstName);
  await page.locator("#lastName").fill(ANSWERS.lastName);
  await continueStep(page);

  await page.locator("#institution").fill(ANSWERS.institution);
  await continueStep(page);

  await page.locator("#courseProgram").fill(ANSWERS.courseProgram);
  await continueStep(page);

  await page.locator("#academicYear").click();
  await page
    .getByRole("option", { name: ANSWERS.academicYear, exact: true })
    .click();
  await page.locator("#semester").click();
  await page
    .getByRole("option", { name: ANSWERS.semester, exact: true })
    .click();
  await continueStep(page);

  // The radio itself is `sr-only` and drawn by a sibling span; the label
  // intercepts the pointer, so the visible text is what a real reader clicks.
  const planning = page.getByRole("group", { name: "How do you like to plan?" });
  await planning.getByText(ANSWERS.planningStyle, { exact: true }).click();
  await expect(
    planning.getByRole("radio", { name: ANSWERS.planningStyle }),
  ).toBeChecked();

  const reminder = page.getByRole("group", {
    name: "When should deadlines remind you?",
  });
  await reminder.getByText(ANSWERS.reminderLead, { exact: true }).click();
  await expect(
    reminder.getByRole("radio", { name: ANSWERS.reminderLead }),
  ).toBeChecked();

  await continueStep(page);

  for (const subject of ANSWERS.subjects) {
    await page.locator("#subject-name").fill(subject);
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText(subject, { exact: true })).toBeVisible();
  }

  await continueStep(page);
}

test.describe("onboarding persistence (13.10)", () => {
  test.beforeAll(async () => {
    requireLocalEnvironment();
    const [qa1, qa2] = await Promise.all([
      signInClient(QA1, qa1Password),
      signInClient(QA2, qa2Password),
    ]);
    qa1Id = qa1.userId;
    qa2Id = qa2.userId;
    expect(qa1Id, "QA1 and QA2 must be different users").not.toBe(qa2Id);
  });

  test.afterAll(async () => {
    // Suite stabilisation, not evidence: if the completion test failed before
    // the UI save landed, QA1 must still end completed or every dependent
    // workspace spec would cascade into /onboarding. The assertions above
    // accept only the UI-driven write, so this cannot mask a passing test.
    if (!LOCAL_TARGET.test(url) || !serviceKey || !qa1Id) return;
    const service = serviceClient();
    await service
      .from("profiles")
      .upsert(
        { id: qa1Id, onboarding_completed_at: new Date().toISOString() },
        { onConflict: "id" },
      );
  });

  test("QA1 completes onboarding: profile, subjects and completion persist; dashboard renders them", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const service = serviceClient();

    await resetOnboarding(service, qa1Id);
    expect(await readSubjects(service, qa1Id)).toEqual([]);

    await page.goto("/onboarding");
    await expect(
      page.getByRole("heading", { name: "What should we call you?" }),
    ).toBeVisible();

    await fillAndSubmitOnboarding(page);
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });

    // The database holds exactly what the UI collected, mapped to codes.
    const profile = await readProfile(service, qa1Id);
    expect(profile).not.toBeNull();
    expect(profile!.first_name).toBe(PERSISTED_PROFILE.first_name);
    expect(profile!.last_name).toBe(PERSISTED_PROFILE.last_name);
    expect(profile!.institution).toBe(PERSISTED_PROFILE.institution);
    expect(profile!.course_program).toBe(PERSISTED_PROFILE.course_program);
    expect(profile!.academic_year).toBe(PERSISTED_PROFILE.academic_year);
    expect(profile!.semester).toBe(PERSISTED_PROFILE.semester);
    expect(profile!.planning_style).toBe(PERSISTED_PROFILE.planning_style);
    expect(profile!.reminder_lead).toBe(PERSISTED_PROFILE.reminder_lead);
    expect(profile!.onboarding_completed_at).not.toBeNull();
    expect(await readSubjects(service, qa1Id)).toEqual(SUBJECTS);

    // The dashboard renders the persisted facts, not defaults.
    await expect(
      page.getByRole("heading", { level: 1, name: "Welcome to UniPilot, QA." }),
    ).toBeVisible();
    await expect(
      page.getByText("Computer Science at UniPilot Test University · Year 2 · Semester 1", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText("Your subjects: Linear Algebra, Thermodynamics", { exact: true }),
    ).toBeVisible();

    // 14.10: the offer is gone the moment the marker is stamped — the same
    // client navigation that finished setup already shows a dashboard without
    // the banner or the rail/drawer setup link. No reload, no client state.
    await expect(page.getByText("Setup incomplete")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Finish setup" })).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Set up your workspace" }),
    ).toHaveCount(0);

    // Returning user: /onboarding sends a completed student to the dashboard,
    // and a gated route is open again.
    await page.goto("/onboarding");
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto("/tasks");
    await expect(
      page.getByRole("heading", { level: 1, name: "Tasks" }),
    ).toBeVisible();
  });

  test("skip writes nothing and leaves onboarding incomplete; gated routes redirect back without a loop", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const service = serviceClient();
    await resetOnboarding(service, qa2Id);

    // QA2 has no storage state; the real login form is the only way in.
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();
    await signInThroughUi(page, QA2, qa2Password);

    await page.goto("/onboarding");
    await page.locator("#firstName").fill("Must Not Persist");
    await page.locator("#lastName").fill("QA2");
    await continueStep(page);
    await expect(
      page.getByRole("heading", { name: "Where do you study?" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Skip for now" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Skip for now" }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });

    // Skip persisted nothing: no answers, no subjects, no completion stamp.
    const profile = await readProfile(service, qa2Id);
    expect(profile!.first_name).toBeNull();
    expect(profile!.last_name).toBeNull();
    expect(profile!.institution).toBeNull();
    expect(profile!.onboarding_completed_at).toBeNull();
    expect(await readSubjects(service, qa2Id)).toEqual([]);

    // A gated route sends the unfinished student back into the flow — and the
    // flow renders rather than bouncing elsewhere: one redirect, no loop.
    await page.goto("/tasks");
    await expect(page).toHaveURL(/\/onboarding/);
    await expect(
      page.getByRole("heading", { name: "Let's get your workspace ready." }),
    ).toBeVisible();
    await page.waitForTimeout(800);
    await expect(page).toHaveURL(/\/onboarding/);

    await context.close();
  });

  test("a failed save stamps nothing and shows sanitized copy; the retry succeeds", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const service = serviceClient();

    // Reset, then break the invariant the atomic function depends on: the
    // provisioned profile row is gone, so `complete_onboarding` raises and its
    // whole transaction — profile and subjects — rolls back.
    await resetOnboarding(service, qa1Id);
    const removed = await service
      .from("profiles")
      .delete()
      .eq("id", qa1Id)
      .select("id");
    expect(removed.error, `remove profile: ${removed.error?.message}`).toBeNull();
    expect(removed.data).toEqual([{ id: qa1Id }]);

    await page.goto("/onboarding");
    await fillAndSubmitOnboarding(page);

    // The flow stays put and shows the sanitized failure — never provider text.
    await expect(page).toHaveURL(/\/onboarding/);
    await expect(
      page.getByRole("alert").filter({
        hasText: "We couldn't save your setup. Please try again.",
      }),
    ).toBeVisible();

    // Nothing was written by the failed attempt: no profile row reappeared, no
    // subjects, so completion cannot have been stamped.
    expect(await readProfile(service, qa1Id)).toBeNull();
    expect(await readSubjects(service, qa1Id)).toEqual([]);

    // Restore the row and retry on the same step: the save succeeds now.
    const restored = await service
      .from("profiles")
      .insert({ id: qa1Id })
      .select("id");
    expect(restored.error, `restore profile: ${restored.error?.message}`).toBeNull();

    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });

    const profile = await readProfile(service, qa1Id);
    expect(profile!.onboarding_completed_at).not.toBeNull();
    expect(await readSubjects(service, qa1Id)).toEqual(SUBJECTS);
  });

  test("repeated submissions create no duplicate subjects and do not re-stamp completion", async () => {
    test.setTimeout(120_000);
    const service = serviceClient();
    const { client: qa1 } = await signInClient(QA1, qa1Password);

    const before = await readProfile(service, qa1Id);
    expect(before!.onboarding_completed_at).not.toBeNull();

    const first = await qa1.rpc("complete_onboarding", RPC_ARGS);
    expect(first.error, `first rpc: ${first.error?.message}`).toBeNull();
    const second = await qa1.rpc("complete_onboarding", RPC_ARGS);
    expect(second.error, `second rpc: ${second.error?.message}`).toBeNull();

    // Same completion time — the second call did not move the stamp.
    expect(first.data).toBe(before!.onboarding_completed_at);
    const after = await readProfile(service, qa1Id);
    expect(after!.onboarding_completed_at).toBe(before!.onboarding_completed_at);

    // Replace-the-set, not append: still exactly two rows, no duplicates.
    expect(await readSubjects(service, qa1Id)).toEqual(SUBJECTS);
  });

  test("QA2's onboarding state is isolated from QA1's", async () => {
    test.setTimeout(120_000);
    const service = serviceClient();

    const qa1Profile = await readProfile(service, qa1Id);
    expect(qa1Profile!.onboarding_completed_at).not.toBeNull();
    expect(await readSubjects(service, qa1Id)).toEqual(SUBJECTS);

    const qa2Profile = await readProfile(service, qa2Id);
    expect(qa2Profile!.onboarding_completed_at).toBeNull();
    expect(qa2Profile!.first_name).toBeNull();
    expect(await readSubjects(service, qa2Id)).toEqual([]);

    // Authenticated QA2 cannot read QA1's persisted subjects or profile row.
    const { client: qa2 } = await signInClient(QA2, qa2Password);

    const visibleSubjects = await qa2.from("subjects").select("name");
    expect(visibleSubjects.error, visibleSubjects.error?.message).toBeNull();
    expect(visibleSubjects.data).toEqual([]);

    const visibleQa1Profile = await qa2
      .from("profiles")
      .select("id")
      .eq("id", qa1Id);
    expect(visibleQa1Profile.error, visibleQa1Profile.error?.message).toBeNull();
    expect(visibleQa1Profile.data).toEqual([]);

    // ...while QA1 sees its own rows.
    const { client: qa1 } = await signInClient(QA1, qa1Password);
    const ownSubjects = await qa1.from("subjects").select("name").order("name");
    expect(ownSubjects.error, ownSubjects.error?.message).toBeNull();
    expect((ownSubjects.data ?? []).map((row) => row.name)).toEqual(SUBJECTS);
  });
});
