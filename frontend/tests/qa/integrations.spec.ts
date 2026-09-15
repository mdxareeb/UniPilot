/**
 * tests/qa/integrations.spec.ts — the /integrations honesty proof.
 *
 * The page is no longer coming-soon-only: the WhatsApp card is real (P5.1) —
 * the export upload control, the connection state, the live-off line and the
 * Google Calendar panel (P7.2) — while the Gmail card stays honestly planned,
 * with no control and no connected claim. Both official brand marks render
 * inline and undistorted in their icon slots (the sanctioned DESIGN.md §Icon
 * Rule exception in `_components/BrandMarks.tsx`), the old coming-soon copy
 * (the WhatsApp reminder promise and "nothing is wired up yet") is gone, and
 * the page never claims a connection it does not have. For the signed-in,
 * live-off render on a server without the OAuth pair the upload button is the
 * page's only interactive control; the Gmail card offers nothing to click, and
 * the Google-sensitive assertions below are guarded so a configured machine
 * (whose panel may offer Connect/Disconnect) does not falsify them.
 *
 * The page is guest-viewable, so the same render is checked from an empty
 * storage state as well: the guest's upload attempt opens the shared skippable
 * sign-in prompt and touches the database not at all. Both contexts assert a
 * clean console and no uncaught page errors. Local stack only (QA_SESSION.md).
 */
import { test, expect, type Browser, type Locator, type Page } from "@playwright/test";
import { acquireWorkerLock } from "./workerLock";

/** Aspect ratios of the official marks' viewBoxes (see `BrandMarks.tsx`). */
const WHATSAPP_MARK_RATIO = 24 / 24;
const GMAIL_MARK_RATIO = 88 / 66;

/** True only when the suite's server also runs with live WhatsApp enabled. */
const LIVE_ENABLED = process.env.UNIPILOT_WHATSAPP_LIVE === "1";

/**
 * True when this machine has the Google OAuth pair. The Google-sensitive
 * assertions below (no "Connected" claim, a single page control) only hold on
 * the unconfigured render this suite targets; a configured machine's panel may
 * honestly offer its own control.
 */
const GOOGLE_CONFIGURED = Boolean(
  process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET,
);

let releaseWorkerLock: (() => void) | null = null;

test.beforeAll(async () => {
  // The authenticated test reads `/integrations`, which triggers P7.2's
  // connected-overview push backfill; the security spec's backfill proof
  // seeds a connected google row and asserts absolute job counts. The shared
  // worker lock keeps every page reader single-writer whenever a targeted run
  // selects them together (see workerLock.ts); in the full suite this project
  // runs after qa-whatsapp-flow, so the lock is uncontended. The raised hook
  // timeout (P7.2 deferred minor) covers the cross-file lock wait when a
  // targeted --no-deps run parallelizes this file with the flow specs.
  test.setTimeout(240_000);
  releaseWorkerLock = await acquireWorkerLock();
});

test.afterAll(() => {
  releaseWorkerLock?.();
  releaseWorkerLock = null;
});

function guestContext(browser: Browser) {
  return browser.newContext({ storageState: { cookies: [], origins: [] } });
}

/** The one `li` card whose text names the integration. */
function integrationCard(page: Page, name: string): Locator {
  return page.locator("main").locator("li").filter({ hasText: name }).first();
}

/** The official mark is inline and undistorted: its box keeps the viewBox ratio. */
async function expectMarkAspect(card: Locator, ratio: number, name: string) {
  // `span > svg` is the mark's icon slot in both cards; the upload pipeline's
  // own Lucide glyph is a direct child, not inside the slot.
  const mark = card.locator("span > svg");
  await expect(mark, `${name} mark`).toHaveCount(1);
  const box = await mark.boundingBox();
  expect(box, `${name} mark has a box`).not.toBeNull();
  expect(box!.width, `${name} mark width`).toBeGreaterThan(0);
  expect(box!.height, `${name} mark height`).toBeGreaterThan(0);
  expect(
    Math.abs(box!.width / box!.height - ratio),
    `${name} mark must keep its aspect ratio`,
  ).toBeLessThan(0.05);
}

async function expectHonestPage(page: Page) {
  const main = page.locator("main");

  await expect(
    main.getByRole("heading", { level: 1, name: "Integrations" }),
  ).toBeVisible();
  // The coming-soon-only lead is gone.
  await expect(main.getByText(/nothing is wired up yet/i)).toHaveCount(0);

  const whatsapp = integrationCard(page, "WhatsApp");
  await expect(whatsapp, "WhatsApp card").toBeVisible();
  await expect(
    whatsapp.getByRole("heading", { level: 2, name: "WhatsApp" }),
  ).toBeVisible();
  await expectMarkAspect(whatsapp, WHATSAPP_MARK_RATIO, "WhatsApp");

  // The real export control exists; the old card's "Coming soon" badge and
  // its outgoing-reminder promise do not.
  await expect(
    whatsapp.getByRole("button", { name: "Upload a WhatsApp export" }),
  ).toBeVisible();
  await expect(whatsapp.getByText("Coming soon")).toHaveCount(0);
  await expect(whatsapp.getByText(/reminder/i)).toHaveCount(0);

  // QA1 has no linked WhatsApp connection at rest: the card says so and no
  // element on it claims a connection. A configured machine may add the
  // Google panel's own honest "Connected", so that half only holds without the
  // OAuth pair.
  await expect(whatsapp.locator("[data-whatsapp-connection]")).toHaveText(
    "Not connected",
  );
  if (!GOOGLE_CONFIGURED) {
    await expect(whatsapp.getByText("Connected", { exact: true })).toHaveCount(0);
  }

  // With the server flag off, the live line is the honest state. If this
  // server runs live instead, the line is absent by design.
  if (!LIVE_ENABLED) {
    await expect(whatsapp.getByText(/self-hosted worker/i)).toBeVisible();
  }

  const gmail = integrationCard(page, "Gmail");
  await expect(gmail, "Gmail card").toBeVisible();
  await expect(
    gmail.getByRole("heading", { level: 2, name: "Gmail" }),
  ).toBeVisible();
  await expect(gmail.getByText("Coming soon")).toBeVisible();
  await expect(gmail.getByText("Not connected")).toBeVisible();
  await expectMarkAspect(gmail, GMAIL_MARK_RATIO, "Gmail");

  // Gmail is still non-interactive: the card contains no control at all.
  await expect(
    gmail.locator(
      "a, button, input, select, textarea, [role='button'], [role='link']",
    ),
  ).toHaveCount(0);

  // The upload button is the page's only interactive control on the
  // unconfigured server (the hidden file input is aria-hidden, so the role
  // query skips it). A configured machine's Google panel may add Connect or
  // Disconnect, so the exact count only holds here.
  if (!GOOGLE_CONFIGURED) {
    await expect(main.getByRole("button")).toHaveCount(1);
  }
  await expect(main.getByRole("link")).toHaveCount(0);
}

test.describe("integrations: honest states", () => {
  test("authenticated: real WhatsApp card, Gmail coming soon, console clean", async ({
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
    await expectHonestPage(page);

    expect(pageErrors, "no uncaught page errors").toEqual([]);
    expect(consoleErrors, "console stays clean").toEqual([]);
  });

  test("guest: the same page renders and the upload control prompts, writing nothing", async ({
    browser,
  }) => {
    const context = await guestContext(browser);
    const page = await context.newPage();
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const supabaseRequests: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("request", (request) => {
      if (/\/(rest|storage)\/v1\//.test(request.url())) {
        supabaseRequests.push(`${request.method()} ${request.url()}`);
      }
    });

    await page.goto("/integrations");
    await page.waitForLoadState("networkidle");
    await expect(page.locator('[data-signed-in="false"]')).toBeAttached();
    await expectHonestPage(page);

    // The upload control is the guest gate: it opens the shared skippable
    // prompt instead of a file dialog, and dismissing it is a real answer.
    await page
      .getByRole("button", { name: "Upload a WhatsApp export" })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Sign in to continue");
    await expect(dialog).toContainText("Sign in to connect WhatsApp.");
    await expect(dialog).toContainText("Continue browsing");
    await page.getByRole("button", { name: "Continue browsing" }).click();
    await expect(dialog).not.toBeVisible();

    expect(supabaseRequests, "guest actions must not touch the database").toEqual(
      [],
    );
    expect(pageErrors, "no uncaught page errors").toEqual([]);
    expect(consoleErrors, "console stays clean").toEqual([]);
    await context.close();
  });
});
