/**
 * tests/qa/structure.spec.ts — committed, re-runnable structural assertions for
 * the authenticated workspace (/dashboard, /tasks, /calendar, /tools,
 * /integrations).
 *
 * Origin: the 17.13 authenticated sweep was originally a set of one-off scripts
 * under git-ignored `.playwright/`. Per 3.11 §15 those assertions must exist as
 * a committed spec so any future styling repair can prove non-regression. This
 * file is that port.
 *
 * Scope: STRUCTURE and behaviour only — landmarks, headings, aria state,
 * keyboard, overlays, navigation, overflow, motion settle. Token-conformance
 * (fonts/colours/radii/spacing) is what 3.11 measures separately.
 *
 * Run: `npx playwright test` (dev server pointed at the local Supabase stack
 * via .env.development.local; storage state handled by the qa-auth-setup
 * project in playwright.config.ts).
 */
import { test, expect, type Page } from "@playwright/test";

const ROUTES = [
  "/dashboard",
  "/tasks",
  "/calendar",
  "/tools",
  "/integrations",
] as const;
const WIDTHS = [320, 375, 768, 1024, 1280] as const;

async function settle(page: Page, ms = 900) {
  await page.waitForTimeout(ms);
}

async function expectNoHorizOverflow(page: Page, route: string, width: number) {
  // Compare against the layout viewport (`clientWidth`, which excludes the
  // classic scrollbar), not the window width: content that only fits by
  // extending under the scrollbar gutter is still overflow.
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(
    scrollWidth,
    `${route} @ ${width}: horizontal overflow (scrollWidth ${scrollWidth} > clientWidth ${clientWidth})`,
  ).toBeLessThanOrEqual(clientWidth);
}

test.describe("structure: routes render authenticated", () => {
  for (const route of ROUTES) {
    test(`${route} renders with one h1 and no redirect`, async ({ page }) => {
      const resp = await page.goto(route);
      expect(resp?.status()).toBeLessThan(400);
      await expect(page).not.toHaveURL(/\/login/);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    });
  }
});

test.describe("structure: /tasks semantics + keyboard", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/tasks");
    await page.waitForLoadState("networkidle");
    await settle(page);
  });

  test("Tasks PageHeader, group landmark and aria-pressed filters", async ({
    page,
  }) => {
    await expect(
      page.getByRole("heading", { level: 1, name: "Tasks" }),
    ).toBeVisible();
    const group = page.getByRole("group", { name: "Filter tasks by status" });
    await expect(group).toBeVisible();
    await expect(
      group.getByRole("button", { name: "All" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      group.getByRole("button", { name: "Done" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  test("Enter activates a filter and Clear restores", async ({ page }) => {
    const group = page.getByRole("group", { name: "Filter tasks by status" });
    await group.getByRole("button", { name: "In progress" }).focus();
    await page.keyboard.press("Enter");
    await expect(
      group.getByRole("button", { name: "In progress" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      group.getByRole("button", { name: "Clear" }),
    ).toBeVisible();
    await group.getByRole("button", { name: "Clear" }).click();
    await expect(
      group.getByRole("button", { name: "All" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("Quick Add dialog: opens, validates, real fields, Escape + focus return", async ({
    page,
  }) => {
    // Saving is real since 16.x; this stays a structural test and does not
    // write (the create flow is exercised by tests/qa/tasks-ui.spec.ts).
    await page.getByRole("button", { name: "New task" }).click();
    const dialog = page.getByRole("dialog", { name: "New task" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("New task");

    await dialog.getByRole("button", { name: "Add task" }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: /title/i }),
    ).toBeVisible();

    // The dialog collects the real model's fields, including 21.7's priority.
    await expect(dialog.getByLabel(/title/i)).toBeVisible();
    await expect(dialog.getByLabel(/due date/i)).toBeVisible();
    await expect(dialog.getByRole("combobox", { name: /priority/i })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: "New task" }),
    ).toBeFocused();
  });
});

test.describe("structure: /calendar semantics", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/calendar");
    await page.waitForLoadState("networkidle");
    await settle(page);
  });

  test("Calendar PageHeader + view control", async ({ page }) => {
    await expect(
      page.getByRole("heading", { level: 1, name: "Calendar" }),
    ).toBeVisible();
    const group = page.getByRole("group", { name: "Calendar view" });
    await expect(group).toBeVisible();
    await expect(group.getByRole("button", { name: "Month" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("month grid semantics: table, 7 cols, Monday-first, today marked", async ({
    page,
  }) => {
    const table = page.locator("table").first();
    await expect(table.locator("caption")).toContainText(/20\d\d/);
    await expect(table.locator("thead th")).toHaveCount(7);
    await expect(table.locator("thead th").first()).toContainText(/mon/i);
    const rows = await table.locator("tbody tr").count();
    expect(rows).toBeGreaterThanOrEqual(4);
    expect(rows).toBeLessThanOrEqual(6);
    await expect(table.locator('[aria-current="date"]')).toHaveCount(1);
  });

  test("week view: 24 hour rows, today column, scope=row", async ({
    page,
  }) => {
    await page
      .getByRole("group", { name: "Calendar view" })
      .getByRole("button", { name: "Week" })
      .click();
    await settle(page, 500);
    const table = page.locator("table").first();
    await expect(table.locator("caption")).toContainText(/week/i);
    expect(await table.locator("tbody tr").count()).toBe(24);
    await expect(table.locator('tbody th[scope="row"]')).toHaveCount(24);
    await expect(
      table.locator('thead th[aria-current="date"]'),
    ).toHaveCount(1);
  });
});

test.describe("structure: shared shell + navigation", () => {
  test("sidebar landmark + nav links at 1280", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    await settle(page);
    await expect(
      page.getByRole("complementary", { name: "Workspace sidebar" }),
    ).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Workspace" });
    for (const label of [
      "Dashboard",
      "Tasks",
      "Calendar",
      "Documents",
      "Assistant",
      "Tools",
      "Integrations",
    ]) {
      await expect(nav.getByRole("link", { name: label })).toBeVisible();
    }
  });

  test("mobile: top bar + drawer opens, Escape closes, focus returns", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    await settle(page);
    await expect(
      page.getByRole("complementary", { name: "Workspace sidebar" }),
    ).toBeHidden();
    const toggle = page.getByRole("button", { name: /open menu/i });
    await expect(toggle).toBeVisible();
    await toggle.click();
    const drawer = page.getByRole("navigation", { name: "Workspace" });
    await expect(drawer).toBeVisible();
    // The two new rails read from the same `WORKSPACE_NAV` list, so the
    // drawer must expose them too (the mobile-only navigation).
    for (const label of ["Tools", "Integrations"]) {
      await expect(drawer.getByRole("link", { name: label })).toBeVisible();
    }
    await page.keyboard.press("Escape");
    await expect(drawer).not.toBeVisible();
    await expect(page.getByRole("button", { name: /open menu/i })).toBeFocused();
  });

  test("navigation loop + back/forward + refresh keep structure", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/dashboard");
    const nav = page.getByRole("navigation", { name: "Workspace" });
    await nav.getByRole("link", { name: "Tasks" }).click();
    await page.waitForURL(/\/tasks$/);
    await nav.getByRole("link", { name: "Calendar" }).click();
    await page.waitForURL(/\/calendar$/);
    await page.goBack();
    await page.waitForURL(/\/tasks$/);
    await page.goForward();
    await page.waitForURL(/\/calendar$/);
    await page.reload({ waitUntil: "networkidle" });
    await settle(page);
    await expect(page).not.toHaveURL(/\/login/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Calendar" }),
    ).toBeVisible();
  });
});

test.describe("structure: no horizontal overflow across widths", () => {
  for (const route of ROUTES) {
    for (const width of WIDTHS) {
      test(`${route} @ ${width}px has no horizontal overflow`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: width === 375 ? 812 : 720 });
        await page.goto(route);
        await page.waitForLoadState("networkidle");
        await settle(page, 700);
        await expectNoHorizOverflow(page, route, width);
      });
    }
  }
});

test.describe("structure: motion settle + reduced motion", () => {
  test("entrances settle at opacity 1 (nothing stuck hidden)", async ({
    page,
  }) => {
    for (const route of ROUTES) {
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      await settle(page, 1400);
      const stuck = await page.evaluate(() => {
        const main = document.querySelector("main");
        if (!main) return null;
        return Array.from(main.querySelectorAll("*")).filter((el) => {
          const s = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return false;
          return (
            parseFloat(s.opacity) === 0 &&
            (el.textContent || "").trim().length > 3 &&
            s.position !== "fixed" &&
            s.position !== "absolute" &&
            !el.getAttribute("aria-hidden")
          );
        }).length;
      });
      expect(stuck, `${route}: content stuck at opacity 0`).toBe(0);
    }
  });

  test("reduced-motion: content appears immediately on all three routes", async ({
    browser,
  }) => {
    const ctx = await browser.newContext({ reducedMotion: "reduce" });
    const page = await ctx.newPage();
    for (const route of ROUTES) {
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      await settle(page, 150);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    }
    await ctx.close();
  });
});
