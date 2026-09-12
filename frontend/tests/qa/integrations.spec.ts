/**
 * tests/qa/integrations.spec.ts — the /integrations honesty proof.
 *
 * The page is a coming-soon surface: WhatsApp and Gmail are named with their
 * official brand marks (the sanctioned DESIGN.md §Icon Rule exception), and
 * nothing is wired — no connected state, no sync, no "Connect" control that
 * does nothing. The marks are inline SVGs (no external asset, CDN or
 * dependency) and must render undistorted in their icon slot at both themes;
 * the page is guest-viewable, so the same honest render is checked from an
 * empty storage state as well.
 *
 * Runs in the authenticated project (default storage state) and opens a guest
 * context inside, asserts a clean console, and performs no writes. Local
 * stack only (QA_SESSION.md).
 */
import { test, expect, type Browser, type Page } from "@playwright/test";

/** The two planned integrations and the aspect ratio of each official mark. */
const INTEGRATIONS = [
  { name: "WhatsApp", aspectRatio: 1 },
  { name: "Gmail", aspectRatio: 88 / 66 },
] as const;

function guestContext(browser: Browser) {
  return browser.newContext({ storageState: { cookies: [], origins: [] } });
}

async function expectHonestCards(page: Page) {
  const main = page.locator("main");

  await expect(
    main.getByRole("heading", { level: 1, name: "Integrations" }),
  ).toBeVisible();
  await expect(main.getByText(/nothing is wired up yet/i)).toBeVisible();

  for (const integration of INTEGRATIONS) {
    // Scope by the card's own text: the name appears in the heading and may
    // appear again in the sentence, both inside the one `li`.
    const card = main.locator("li").filter({ hasText: integration.name }).first();
    await expect(card, `${integration.name} card`).toBeVisible();
    await expect(card.getByText("Coming soon")).toBeVisible();
    await expect(card.getByText("Not connected")).toBeVisible();

    // The official mark is inline and undistorted: its rendered box keeps the
    // viewBox's aspect ratio.
    const mark = card.locator("svg");
    await expect(mark, `${integration.name} mark`).toHaveCount(1);
    const box = await mark.boundingBox();
    expect(box, `${integration.name} mark has a box`).not.toBeNull();
    expect(box!.width, `${integration.name} mark width`).toBeGreaterThan(0);
    expect(box!.height, `${integration.name} mark height`).toBeGreaterThan(0);
    expect(
      Math.abs(box!.width / box!.height - integration.aspectRatio),
      `${integration.name} mark must keep its aspect ratio`,
    ).toBeLessThan(0.05);
  }

  // No control promises a connection and no element claims one.
  await expect(main.getByRole("button", { name: /connect/i })).toHaveCount(0);
  await expect(main.getByRole("link", { name: /connect/i })).toHaveCount(0);
  await expect(main.getByText("Connected", { exact: true })).toHaveCount(0);
  await expect(main.getByText(/sync/i)).toHaveCount(0);
}

test.describe("integrations: honest coming-soon", () => {
  test("authenticated: WhatsApp + Gmail marks, coming-soon state, console clean", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.goto("/integrations");
    await page.waitForLoadState("networkidle");
    await expectHonestCards(page);

    expect(pageErrors, "no uncaught page errors").toEqual([]);
    expect(consoleErrors, "console stays clean").toEqual([]);
  });

  test("guest: the same honest page with nothing connected", async ({
    browser,
  }) => {
    const context = await guestContext(browser);
    const page = await context.newPage();
    await page.goto("/integrations");
    await page.waitForLoadState("networkidle");
    await expectHonestCards(page);
    await context.close();
  });
});
