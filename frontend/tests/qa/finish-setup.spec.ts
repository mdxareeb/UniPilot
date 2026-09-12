/**
 * tests/qa/finish-setup.spec.ts — Task 14.10's persistent affordance proof.
 *
 * Runs after the qa-onboarding project (a Playwright dependency), which leaves
 * QA1 onboarding-complete and QA2 incomplete. This spec reads those two states
 * through the real UI and proves:
 *
 * - QA2 (incomplete, signed in): the /dashboard setup banner and the rail's
 *   "Set up your workspace" link render, the banner links into /onboarding,
 *   and it is persistent — navigating away and back shows it again.
 * - QA1 (complete, storage state): neither the banner nor the setup link
 *   renders, on the rail or in the mobile drawer.
 * - a guest: `GuestCallout` only, never a setup affordance.
 * - the dashboard's main content does not shift as the page resolves, the
 *   banner is server-rendered in the first response (no flash of the wrong
 *   state), reduced motion shows it with no entrance animation, and the
 *   console stays free of errors/hydration warnings.
 *
 * It never mutates application data and never contacts hosted. Run:
 * `npx playwright test` (dev server + local stack per QA_SESSION.md).
 */
import { test, expect, type Page } from "@playwright/test";

const LOCAL_TARGET = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const qa2Password = process.env.UNIPILOT_QA2_PASSWORD ?? "";

const QA2 = "qa2.unipilot@unipilot.test";

/** Drives the real login form — same path as tests/qa/auth.setup.ts. */
async function signInThroughUi(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Continue with Email" }).click();
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
}

/** Console errors and page errors seen on a page, for the clean-console check. */
function trackConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}

/**
 * Layout-shift total for nodes inside `<main>` since navigation start
 * (Chromium's `layout-shift` PerformanceObserver, buffered entries included).
 * Scoped to main content so the rail's independent streaming skeleton cannot
 * be attributed to the dashboard read.
 */
async function mainContentLayoutShift(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let total = 0;
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            const shift = entry as PerformanceEntry & {
              value: number;
              hadRecentInput: boolean;
              sources?: { node?: Node | null }[];
            };
            if (shift.hadRecentInput || shift.value <= 0.01) continue;
            const inMain = (shift.sources ?? []).some((source) => {
              const node = source.node;
              return node instanceof Element && node.closest("main") !== null;
            });
            if (inMain) total += shift.value;
          }
        });
        observer.observe({ type: "layout-shift", buffered: true });
        window.setTimeout(() => {
          observer.disconnect();
          resolve(total);
        }, 900);
      }),
  );
}

test.describe("finish-setup affordance (14.10)", () => {
  test.beforeAll(() => {
    if (!LOCAL_TARGET.test(url)) {
      throw new Error(
        `finish-setup QA is local-only; refusing target "${url || "(unset)"}"`,
      );
    }
    if (!qa2Password) {
      throw new Error(
        "Missing UNIPILOT_QA2_PASSWORD (frontend/.env.development.local); seed the identities first (`npm run seed:qa` from the repo root)",
      );
    }
  });

  test("incomplete student sees the banner and the setup link; the offer is persistent", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    const errors = trackConsoleErrors(page);

    await signInThroughUi(page, QA2, qa2Password);

    // The banner is in the first response — not a client-side insertion — so
    // a completed student can never flash it and the read cannot shift layout.
    const response = await page.goto("/dashboard");
    const html = await response!.text();
    expect(html).toContain("Setup incomplete");
    expect(html).toContain("Finish setup");

    const shift = await mainContentLayoutShift(page);
    expect(shift, `dashboard main content shifted by ${shift}`).toBeLessThan(0.05);

    await expect(page.getByText("Setup incomplete", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Finish setup" })).toBeVisible();
    // Desktop rail: the same offer lives in the navigation.
    await expect(
      page.getByRole("link", { name: "Set up your workspace" }),
    ).toBeVisible();

    // The banner opens the flow, and it is persistent — not a one-shot.
    // The Next client navigation resolves /onboarding behind the session +
    // completion read, so under the full suite's parallel load it needs the
    // same 20s headroom the fixture gives the same route (auth.setup.ts).
    await page.getByRole("link", { name: "Finish setup" }).click();
    await expect(page).toHaveURL(/\/onboarding/, { timeout: 20_000 });
    await page.goto("/dashboard");
    await expect(page.getByText("Setup incomplete", { exact: true })).toBeVisible();

    // Mobile: no rail; the drawer carries the setup link.
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/dashboard");
    await expect(page.getByText("Setup incomplete", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Open menu" }).click();
    const drawer = page.getByRole("navigation", { name: "Workspace" });
    await expect(drawer).toBeVisible();
    await expect(
      drawer.getByRole("link", { name: "Set up your workspace" }),
    ).toBeVisible();

    expect(errors, errors.join("\n")).toEqual([]);
    await context.close();
  });

  test("completed student sees neither the affordance nor the setup link", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    const errors = trackConsoleErrors(page);

    const response = await page.goto("/dashboard");
    const html = await response!.text();
    expect(html).not.toContain("Setup incomplete");
    expect(html).not.toContain("Finish setup");

    // The rail is visible at this width, and it must not carry the link either.
    await expect(
      page.getByRole("complementary", { name: "Workspace sidebar" }),
    ).toBeVisible();
    await expect(page.getByText("Setup incomplete")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Finish setup" })).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Set up your workspace" }),
    ).toHaveCount(0);

    // Mobile drawer: same absence.
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Open menu" }).click();
    const drawer = page.getByRole("navigation", { name: "Workspace" });
    await expect(drawer).toBeVisible();
    await expect(
      drawer.getByRole("link", { name: "Set up your workspace" }),
    ).toHaveCount(0);
    await expect(drawer.getByText("Setup incomplete")).toHaveCount(0);

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("guest sees GuestCallout only, never a setup affordance", async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    const errors = trackConsoleErrors(page);

    await page.goto("/dashboard");
    await expect(
      page.getByRole("link", { name: /create your workspace/i }).first(),
    ).toBeVisible();
    await expect(page.getByText("Setup incomplete")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Finish setup" })).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Set up your workspace" }),
    ).toHaveCount(0);

    expect(errors, errors.join("\n")).toEqual([]);
    await context.close();
  });

  test("reduced motion: the banner is immediately visible with no entrance animation", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
      reducedMotion: "reduce",
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    await signInThroughUi(page, QA2, qa2Password);

    await page.goto("/dashboard");
    const banner = page
      .locator("[data-enter]")
      .filter({ has: page.getByText("Setup incomplete", { exact: true }) });
    await expect(banner).toBeVisible();
    await expect(page.getByRole("link", { name: "Finish setup" })).toBeVisible();

    const { opacity, animationName } = await banner.evaluate((element) => ({
      opacity: getComputedStyle(element).opacity,
      animationName: getComputedStyle(element).animationName,
    }));
    expect(opacity).toBe("1");
    expect(animationName).toBe("none");

    await context.close();
  });
});
