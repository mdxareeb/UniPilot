/**
 * tests/qa/tasks-ui.spec.ts — Tasks 16.x's UI flows against the real service.
 *
 * Runs authenticated as QA1 (the qa-tasks-ui project's storage state) with
 * `qa-onboarding` and `qa-tasks-data` as project dependencies, so QA1 is
 * onboarded and no other task-mutating spec runs concurrently.
 *
 * Every test seeds the rows it needs through the service role and tears them
 * down in `afterEach` (title-prefixed, id-scoped), so the spec is repeatable
 * and leaves no residue. The flows are the real UI: create (16.2/16.6), edit
 * (16.7), delete (16.8), pointer and keyboard status moves (16.9), the detail
 * modal's ownership check (16.10) and a forced-failure rollback (21.9).
 *
 * Local-only by construction; hosted is never contacted.
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

/** Every row this spec creates carries this prefix, so teardown is exact. */
const PREFIX = "UI 16x";

let qa1Id = "";
let qa2Id = "";
let service: SupabaseClient;

async function signIn(client: SupabaseClient, email: string, password: string) {
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });
  expect(error, `sign-in failed for ${email}: ${error?.message}`).toBeNull();
  return data.user!.id;
}

/** Seeds one task straight through the service role and returns its id. */
async function seedTask(
  userId: string,
  title: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const { data, error } = await service
    .from("tasks")
    .insert({ user_id: userId, title: `${PREFIX} ${title}`, ...extra })
    .select("id")
    .single();
  expect(error, `seed "${title}": ${error?.message}`).toBeNull();
  return (data as { id: string }).id;
}

function card(page: Page, id: string) {
  /* `.filter({ visible: true })` because a shared-layout status move keeps
     Motion's exiting copy of the same card in the DOM for the length of its
     exit; under parallel-suite load that copy can outlive the action. The
     card the user can see is the settled one — a hidden projection clone is
     not a second task, and strict mode must not read it as one. */
  return page.locator(`[data-task-id="${id}"]`).filter({ visible: true });
}

function column(page: Page, label: string) {
  return page.locator(`section[aria-label="${label}"]`);
}

/** The visible card in a column — the same exit-copy rule as `card`. */
function columnCard(page: Page, label: string, id: string) {
  return column(page, label)
    .locator(`[data-task-id="${id}"]`)
    .filter({ visible: true });
}

function trackConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}

test.describe("tasks UI (16.x)", () => {
  test.beforeAll(async () => {
    if (!LOCAL_TARGET.test(url)) {
      throw new Error(`tasks-ui is local-only; refusing target "${url || "(unset)"}"`);
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
    const qa1 = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const qa2 = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    qa1Id = await signIn(qa1, QA1, qa1Password);
    qa2Id = await signIn(qa2, QA2, qa2Password);
  });

  test.afterEach(async () => {
    await service
      .from("tasks")
      .delete()
      .in("user_id", [qa1Id, qa2Id])
      .like("title", `${PREFIX}%`);
  });

  test("create: card lands in To do, persists, validates, responsive at 375", async ({
    page,
  }) => {
    const errors = trackConsoleErrors(page);
    await page.goto("/tasks");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(400);
    await expect(
      page.getByRole("heading", { level: 1, name: "Tasks" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "New task" }).click();
    const dialog = page.getByRole("dialog", { name: "New task" });
    await expect(dialog).toBeVisible();

    // Validation boundary: an empty title never reaches the service.
    await dialog.getByRole("button", { name: "Add task" }).click();
    await expect(dialog.getByRole("alert")).toContainText(/title/i);

    const title = `${PREFIX} create one`;
    await dialog.getByLabel("Title").fill(title);
    await dialog.getByLabel(/due date/i).fill("2026-09-02");
    await dialog.getByLabel(/priority/i).selectOption("high");
    await dialog.getByRole("button", { name: "Add task" }).click();

    await expect(dialog).not.toBeVisible();

    // The optimistic row is replaced by the settled one; resolve the settled
    // id from the service so the assertion targets exactly that card. Motion
    // can keep the exiting pending copy visible for a moment, so a
    // text-filtered locator is not unique under load.
    let createdId = "";
    await expect
      .poll(async () => {
        const { data } = await service
          .from("tasks")
          .select("id")
          .eq("user_id", qa1Id)
          .eq("title", title)
          .maybeSingle();
        createdId = (data as { id: string } | null)?.id ?? "";
        return createdId;
      })
      .not.toBe("");

    const created = card(page, createdId);
    await expect(created).toBeVisible();
    await expect(created).toContainText("Wed, Sep 2");
    await expect(created).toContainText("High");
    await expect(columnCard(page, "To do", createdId)).toBeVisible();

    // Real persistence: a reload reads it back from the database.
    await page.reload();
    await expect(card(page, createdId)).toBeVisible();

    // 16.13: the real card does not push the board sideways on a phone.
    await page.setViewportSize({ width: 375, height: 812 });
    await page.reload();
    await expect(card(page, createdId)).toBeVisible();
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("edit: fields update and persist, filter stays active", async ({ page }) => {
    const id = await seedTask(qa1Id, "edit seed");
    const errors = trackConsoleErrors(page);

    await page.goto("/tasks");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: "To do", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "To do", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");

    await card(page, id).locator("[data-card-focus]").click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Edit task" })
      .click();

    const dialog = page.getByRole("dialog", { name: "Edit task" });
    await expect(dialog.getByLabel("Title")).toHaveValue(`${PREFIX} edit seed`);
    await dialog.getByLabel("Title").fill(`${PREFIX} edit renamed`);
    await dialog.getByLabel(/priority/i).selectOption("medium");
    await dialog.getByRole("button", { name: "Save changes" }).click();

    await expect(dialog).not.toBeVisible();
    await expect(card(page, id)).toContainText(`${PREFIX} edit renamed`);
    await expect(card(page, id)).toContainText("Medium");
    // The filter is board state and survives the mutation.
    await expect(
      page.getByRole("button", { name: "To do", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");

    await page.reload();
    await expect(card(page, id)).toContainText(`${PREFIX} edit renamed`);
    await expect(card(page, id)).toContainText("Medium");

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("delete: cancel leaves the task, confirm removes it and persists", async ({
    page,
  }) => {
    const keepId = await seedTask(qa1Id, "keep me");
    const removeId = await seedTask(qa1Id, "remove me");
    const errors = trackConsoleErrors(page);
    await page.goto("/tasks");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(400);

    await page.getByRole("button", { name: `Delete ${PREFIX} keep me` }).click();
    const dialog = page.getByRole("dialog", { name: "Delete this task?" });
    await expect(dialog).toContainText(`${PREFIX} keep me`);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).not.toBeVisible();
    await expect(card(page, keepId)).toBeVisible();

    await page
      .getByRole("button", { name: `Delete ${PREFIX} remove me` })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Delete task" })
      .click();
    await expect(card(page, removeId)).toHaveCount(0);

    await page.reload();
    await expect(card(page, removeId)).toHaveCount(0);
    await expect(card(page, keepId)).toBeVisible();

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("drag (pointer): drop on a column changes status and persists", async ({
    page,
  }) => {
    const id = await seedTask(qa1Id, "pointer drag");
    const errors = trackConsoleErrors(page);
    await page.goto("/tasks");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(400);

    /* HTML5 drag is browser-driven: `dragTo()`'s blind gesture can move on
       before Chromium has started the drag under suite load, and the drop
       then no-ops silently. Drive the gesture explicitly and wait on the
       board's own drag state (`data-dragging` on the card, `data-drop-target`
       on the column) before releasing — a start that never happens now fails
       at the drag-state wait instead of as a mysterious no-move. */
    const source = card(page, id).locator("[data-card-focus]");
    const sourceBox = (await source.boundingBox())!;
    const targetBox = (await column(page, "In progress").boundingBox())!;
    const startX = sourceBox.x + sourceBox.width / 2;
    const startY = sourceBox.y + sourceBox.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    for (let step = 1; step <= 6; step += 1) {
      await page.mouse.move(startX + step * 12, startY + step * 8);
    }
    await expect(
      card(page, id).locator('[data-dragging="true"]'),
    ).toBeAttached({ timeout: 5_000 });

    await page.mouse.move(
      targetBox.x + targetBox.width / 2,
      targetBox.y + targetBox.height / 2,
      { steps: 12 },
    );
    await expect(column(page, "In progress")).toHaveAttribute(
      "data-drop-target",
      "true",
      { timeout: 5_000 },
    );
    await page.mouse.up();

    await expect(columnCard(page, "In progress", id)).toBeVisible();

    await page.reload();
    await expect(columnCard(page, "In progress", id)).toBeVisible();

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("drag (keyboard): arrow keys move between columns, focus survives, persists", async ({
    page,
  }) => {
    const id = await seedTask(qa1Id, "keyboard drag");
    const errors = trackConsoleErrors(page);
    await page.goto("/tasks");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(400);

    const persistedStatus = async () =>
      (await service.from("tasks").select("status").eq("id", id).single()).data
        ?.status;

    const cardFocus = card(page, id).locator("[data-card-focus]");
    await expect(cardFocus).toBeVisible();
    await cardFocus.focus();
    await expect(cardFocus).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(columnCard(page, "In progress", id)).toBeVisible();
    await expect(
      columnCard(page, "In progress", id).locator("[data-card-focus]"),
    ).toBeFocused();
    await expect(page.locator('[aria-live="polite"]')).toContainText(
      "In progress",
    );
    // Wait for the write to settle before the next press, so the two moves are
    // sequential interactions rather than two overlapping action fetches.
    await expect.poll(persistedStatus).toBe("in_progress");

    await page.keyboard.press("ArrowRight");
    await expect(columnCard(page, "Done", id)).toBeVisible();
    await expect.poll(persistedStatus).toBe("done");

    await page.reload();
    await expect(columnCard(page, "Done", id)).toBeVisible();

    // The filter stays where it was through a status move as well — and a
    // card moved outside the active filter leaves the visible set.
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Done", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await cardFocus.focus();
    await expect(cardFocus).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect.poll(persistedStatus).toBe("in_progress");
    await expect(
      page.locator(`[data-task-id="${id}"]`).filter({ visible: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Done", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");

    // Clearing the filter shows it in its new column.
    await page.getByRole("button", { name: "Clear" }).click();
    await expect(columnCard(page, "In progress", id)).toBeVisible();

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("detail: opens by id, and a foreign or altered id is not found", async ({
    page,
  }) => {
    const ownId = await seedTask(qa1Id, "detail own");
    const foreignId = await seedTask(qa2Id, "detail foreign");
    const errors = trackConsoleErrors(page);

    await page.goto("/tasks");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(400);
    await card(page, ownId).locator("[data-card-focus]").click();
    await expect(page).toHaveURL(new RegExp(`task=${ownId}`));
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(`${PREFIX} detail own`);
    await expect(dialog).toContainText("To do");
    await dialog.getByRole("button", { name: "Close dialog" }).click();
    await expect(page).not.toHaveURL(/task=/);

    // Another user's real task: ownership is the server's.
    await page.goto(`/tasks?task=${foreignId}`);
    await expect(page.getByRole("dialog")).toContainText("Task not found");

    // A fabricated id: same answer, no crash.
    await page.goto("/tasks?task=not-a-uuid");
    await expect(page.getByRole("dialog")).toContainText("Task not found");

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("forced failure: the optimistic delete rolls back with sanitized copy", async ({
    page,
  }) => {
    const id = await seedTask(qa1Id, "failure rollback");
    await page.goto("/tasks");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(400);

    // Fail only the Server Action POST; page navigations continue normally.
    await page.route("**/tasks", async (route) => {
      if (route.request().method() === "POST") {
        await route.abort();
      } else {
        await route.continue();
      }
    });

    await page.getByRole("button", { name: `Delete ${PREFIX} failure rollback` }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Delete task" })
      .click();

    await expect(
      page.getByRole("dialog").getByRole("alert"),
    ).toContainText("We couldn't delete that task");
    // The card left optimistically and came back.
    await expect(card(page, id)).toBeVisible();

    await page.unroute("**/tasks");
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    await expect(card(page, id)).toBeVisible();
  });

  test("reduced motion: the dialog and board render instantly", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      storageState:
        process.env.QA_STORAGE_STATE ?? ".playwright/qa-session.json",
      reducedMotion: "reduce",
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    const errors = trackConsoleErrors(page);

    await page.goto("/tasks");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: "New task" }).click();
    const dialog = page.getByRole("dialog", { name: "New task" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Title")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Add task" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();

    expect(errors, errors.join("\n")).toEqual([]);
    await context.close();
  });
});
