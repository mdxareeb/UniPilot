/**
 * tests/qa/guest-browsing.spec.ts — the guest workspace proof.
 *
 * A visitor without a session can browse /dashboard, /tasks, /calendar,
 * /documents, /assistant, /tools and /integrations: each renders its real
 * shell with an honest empty state, reads no data (the anon role is revoked,
 * so a guest query would fail — the design never issues one), and leaves the
 * console clean. Using any surface opens the one shared skippable sign-in
 * prompt:
 *
 * - every gated control (New task, calendar Add event, document upload,
 *   assistant new conversation, global search, the assistant launcher) opens
 *   the same dialog with its own short reason;
 * - "Continue browsing" and Escape dismiss it and the page stays browsable;
 * - "Sign in" targets `/login?next=<current path>`.
 *
 * Explored as an explicit guest context (empty storage state) inside the
 * authenticated project, the same override `auth-guards.spec.ts` uses — the
 * project's storage state is deliberately discarded here.
 *
 * Run: `npx playwright test` with the dev server + local stack (QA_SESSION.md).
 * It performs no writes and never contacts hosted.
 */
import { test, expect, type Browser, type Page } from "@playwright/test";
import { HAS_LIVE_TOOL } from "../../components/tools/toolCatalog";

const LOCAL_TARGET = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const APP_BASE = process.env.QA_BASE_URL ?? "http://localhost:3000";

/** Every guest-viewable route and the h1 its real shell renders. */
const GUEST_ROUTES: readonly [string, string | null][] = [
  ["/dashboard", null],
  ["/tasks", "Tasks"],
  ["/calendar", "Calendar"],
  ["/documents", "Documents"],
  ["/assistant", "Assistant"],
  ["/tools", "Tools"],
  ["/integrations", "Integrations"],
];

function guestContext(browser: Browser) {
  return browser.newContext({ storageState: { cookies: [], origins: [] } });
}

/**
 * The copy the visitor actually reads. Next's streamed shell can briefly keep
 * a hidden duplicate of a streamed paragraph in the DOM under suite load; the
 * same hidden-projection rule tasks-ui's `card()` documents applies here, so
 * a strict-mode read targets the visible copy, never the shell's clone.
 */
function visibleCopy(page: Page, text: string | RegExp) {
  return page.getByText(text).filter({ visible: true });
}

/**
 * Waits for the streamed guest flag to land. Page-level controls take the
 * server's verdict as a prop and never race it, but the layout chrome
 * (search, launcher) reads the streamed context, so a test must not drive
 * those before the provider knows the visitor is a guest.
 */
async function waitForGuestFlag(page: Page) {
  await expect(page.locator('[data-signed-in="false"]')).toBeAttached();
}

/**
 * Watches a guest page for the three failures this spec exists to catch:
 * console errors, uncaught page errors, and any direct PostgREST query.
 */
function watchGuest(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const dataReads: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => {
    if (/\/rest\/v1\//.test(request.url())) dataReads.push(request.url());
  });

  return {
    dataReads,
    consoleErrors,
    pageErrors,
    expectClean() {
      expect(dataReads, "guest pages must not query the database").toEqual([]);
      expect(pageErrors, "guest pages must not throw").toEqual([]);
      expect(consoleErrors, "guest pages must stay console-clean").toEqual([]);
    },
  };
}

test.describe("guest browsing", () => {
  test.beforeAll(() => {
    if (!LOCAL_TARGET.test(url)) {
      throw new Error(
        `guest-browsing QA is local-only; refusing target "${url || "(unset)"}"`,
      );
    }
  });

  test("every workspace route renders its guest state with no data read", async ({
    browser,
  }) => {
    // Seven navigations plus a settle wait; the default 60s is too tight when
    // the whole suite is running in parallel against one dev server.
    test.slow();
    const context = await guestContext(browser);
    const page = await context.newPage();
    const signals = watchGuest(page);

    for (const [route, heading] of GUEST_ROUTES) {
      const response = await page.goto(route);
      expect(response?.status(), `${route} status`).toBe(200);
      await expect(page, `${route} must not redirect`).not.toHaveURL(/\/login/);

      const h1 = page.getByRole("heading", { level: 1 });
      await expect(h1, `${route} renders its real header`).toBeVisible();
      if (heading) {
        await expect(h1, `${route} heading`).toHaveText(heading);
      }
    }

    // Honest guest copy on every surface — never fabricated rows.
    await page.goto("/tasks");
    await expect(
      visibleCopy(
        page,
        "Sign in to add your first task and track it through the board.",
      ),
    ).toBeVisible();
    await page.goto("/calendar");
    await expect(
      visibleCopy(
        page,
        "Sign in to add classes, exams and deadlines to your calendar.",
      ),
    ).toBeVisible();
    await page.goto("/documents");
    await expect(
      visibleCopy(
        page,
        "Sign in to upload and keep your documents in one place.",
      ),
    ).toBeVisible();
    await page.goto("/assistant");
    await expect(
      visibleCopy(
        page,
        "Sign in to start a conversation with the assistant.",
      ),
    ).toBeVisible();
    // /tools states the aggregate honestly while nothing in the registry is
    // live (`HAS_LIVE_TOOL` gates the note on the page itself).
    if (!HAS_LIVE_TOOL) {
      await page.goto("/tools");
      await expect(
        visibleCopy(page, "None of these are built yet"),
      ).toBeVisible();
    }
    await page.goto("/integrations");
    await expect(
      visibleCopy(page, /connect the services you already use/i),
    ).toBeVisible();

    // The URL-driven task detail never resolves for a guest: no Server Action
    // runs, so the page stays put and no dialog appears.
    await page.goto(
      "/tasks?task=00000000-0000-0000-0000-000000000000",
    );
    await page.waitForTimeout(1_000);
    await expect(page).toHaveURL(/\/tasks/);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      visibleCopy(
        page,
        "Sign in to add your first task and track it through the board.",
      ),
    ).toBeVisible();

    signals.expectClean();
    await context.close();
  });

  test("a guest task action opens the shared skippable prompt", async ({
    browser,
  }) => {
    const context = await guestContext(browser);
    const page = await context.newPage();
    const signals = watchGuest(page);

    await page.goto("/tasks");
    await waitForGuestFlag(page);
    await page.getByRole("button", { name: "New task" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("heading", { name: "Sign in to continue" }),
    ).toBeVisible();
    await expect(
      dialog.getByText("Sign in to add tasks to your board."),
    ).toBeVisible();

    // The primary control carries the current path through ?next.
    const href = await dialog
      .getByRole("link", { name: "Sign in" })
      .getAttribute("href");
    expect(href, "Sign in must link to /login").toBeTruthy();
    const target = new URL(href!, APP_BASE);
    expect(target.origin).toBe(new URL(APP_BASE).origin);
    expect(target.pathname).toBe("/login");
    expect(target.searchParams.get("next")).toBe("/tasks");

    // Continue browsing dismisses and the board stays browsable.
    await dialog.getByRole("button", { name: "Continue browsing" }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page).toHaveURL(/\/tasks/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Tasks" }),
    ).toBeVisible();
    await expect(
      visibleCopy(
        page,
        "Sign in to add your first task and track it through the board.",
      ),
    ).toBeVisible();

    // Escape dismisses too — no persistence, no redirect.
    await page.getByRole("button", { name: "New task" }).click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(page).toHaveURL(/\/tasks/);

    signals.expectClean();
    await context.close();
  });

  test("every guest surface control opens the same prompt with its own reason", async ({
    browser,
  }) => {
    // Six route loads and six dialogs; slow under the parallel suite.
    test.slow();
    const context = await guestContext(browser);
    const page = await context.newPage();
    const signals = watchGuest(page);

    const cases: readonly [string, () => ReturnType<Page["locator"]>, string][] =
      [
        [
          "/calendar",
          () => page.getByRole("button", { name: "Add event" }),
          "Sign in to add events to your calendar.",
        ],
        [
          "/documents",
          () => page.getByRole("button", { name: "Upload document" }),
          "Sign in to upload documents.",
        ],
        [
          "/assistant",
          () => page.getByRole("button", { name: "New conversation" }),
          "Sign in to start a conversation with the assistant.",
        ],
        [
          "/tasks",
          () =>
            page.getByRole("button", {
              name: "Ask UniPilot anything — opens search and the assistant",
            }),
          "Sign in to ask the assistant about your workspace.",
        ],
        [
          "/tasks",
          () => page.locator('button[aria-label="Search"]:visible'),
          "Sign in to search your workspace.",
        ],
      ];

    for (const [route, control, reason] of cases) {
      await page.goto(route);
      await waitForGuestFlag(page);
      await control().click();

      const dialog = page.getByRole("dialog");
      await expect(dialog, `${route} — prompt opens`).toBeVisible();
      await expect(dialog.getByText(reason), `${route} — reason`).toBeVisible();

      const href = await dialog
        .getByRole("link", { name: "Sign in" })
        .getAttribute("href");
      const target = new URL(href!, APP_BASE);
      expect(target.pathname, `${route} — login target`).toBe("/login");
      expect(target.searchParams.get("next"), `${route} — next`).toBe(route);

      await dialog.getByRole("button", { name: "Continue browsing" }).click();
      await expect(dialog).not.toBeVisible();
      await expect(page, `${route} — still browsable`).toHaveURL(
        new RegExp(route.replace("/", "\\/")),
      );
    }

    signals.expectClean();
    await context.close();
  });

  test("Sign in lands on /login with the current path preserved", async ({
    browser,
  }) => {
    const context = await guestContext(browser);
    const page = await context.newPage();

    await page.goto("/documents");
    await waitForGuestFlag(page);
    await page.getByRole("button", { name: "Upload document" }).click();
    await page
      .getByRole("dialog")
      .getByRole("link", { name: "Sign in" })
      .click();

    await expect(page).toHaveURL(
      (target) => {
        return (
          target.pathname === "/login" &&
          target.searchParams.get("next") === "/documents"
        );
      },
      // The client-side navigation renders /login behind the shared session
      // read; under the full suite's parallel load it can take longer than the
      // default 5s.
      { timeout: 20_000 },
    );
    await expect(
      page.getByRole("heading", { level: 1, name: /welcome back/i }),
    ).toBeVisible();

    await context.close();
  });
});
