/**
 * Task 20.10 — the reusable authenticated QA session fixture.
 *
 * ONE-LINE USAGE (future task prompts): run `npx playwright test` with the dev
 * server + local stack up, then use storage state at `.playwright/qa-session.json`
 * (or `QA_STORAGE_STATE`) — see QA_SESSION.md.
 *
 * What this file deliberately does NOT do:
 * - It never forges a token or injects a fabricated cookie: the session is
 *   obtained by driving the app's REAL login form and letting `@supabase/ssr`
 *   set its own HTTP-only cookies (§24 of the task).
 * - It never seeds application data or creates tables (§30): the QA identity
 *   is an authenticated user with no application data, by design.
 * - It never touches the hosted (production) Supabase project: the target is
 *   whatever the dev server uses, which must be the local stack per
 *   `.env.development.local` (§12).
 *
 * Behaviour (§23):
 * 1. Missing QA env vars → fails with a clear, actionable message.
 * 2. Existing storage state is validated by loading `/onboarding` — the one
 *    remaining protected route, so a guest is still bounced to /login while a
 *    real session lands on the flow or /dashboard. Expired/revoked sessions are
 *    detected (redirect to /login) and the fixture re-authenticates rather than
 *    failing opaquely. (Before guest browsing, /tasks served this purpose; it is
 *    now guest-viewable and would validate any visitor.)
 * 3. Missing storage state → authenticates once through the real UI and
 *    persists it.
 */
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { test as setup, expect, type Page } from "@playwright/test";

/** Mirrors the seed script's constant (backend/supabase/qa/seed-qa-identity.mjs).
 * RFC 2606 reserved `.test` TLD — deterministic, non-real, dot-bearing so the
 * app's email validation accepts it. */
const QA_EMAIL = "qa.unipilot@unipilot.test";

/** Where the storage state is persisted; configurable via QA_STORAGE_STATE. */
const STORAGE_STATE =
  process.env.QA_STORAGE_STATE ?? ".playwright/qa-session.json";

const QA_PASSWORD = process.env.UNIPILOT_QA_PASSWORD;

if (!QA_PASSWORD) {
  throw new Error(
    [
      "QA fixture: UNIPILOT_QA_PASSWORD is not set.",
      "It lives in frontend/.env.development.local (git-ignored), next to the",
      "local Supabase stack credentials. Copy frontend/.env.development.local.example,",
      "set the password, run `npm run seed:qa` from the repo root, then retry.",
      "Details: QA_SESSION.md",
    ].join("\n"),
  );
}

/** Narrowed after the guard above — the login form needs a real string. */
const QA_PASSWORD_VALUE: string = QA_PASSWORD;

/**
 * Drives the real login UI and returns once the app has accepted the
 * credentials (redirect off /login). The password is typed into the real
 * form; the storage state later holds only the HTTP-only session cookies
 * Supabase itself set — never the password.
 */
async function loginThroughRealUi(page: Page) {
  await page.goto("/login");

  // The email form starts collapsed behind the "Continue with Email"
  // disclosure (app/(auth)/_components/AuthOptions.tsx).
  await page.getByRole("button", { name: "Continue with Email" }).click();
  await page.locator("#email").fill(QA_EMAIL);
  await page.locator("#password").fill(QA_PASSWORD_VALUE);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  // LoginForm redirects to /dashboard (POST_AUTH_REDIRECT) on success. A
  // failed login stays on /login with a sanitized notice — the assertions
  // below make that case fail loudly, not opaquely.
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
}

setup("authenticate QA session through the real login UI", async ({ browser }) => {
  // ── Step 1: validate any existing storage state instead of trusting it ──
  if (existsSync(STORAGE_STATE)) {
    const context = await browser.newContext({ storageState: STORAGE_STATE });
    const page = await context.newPage();
    try {
      // /onboarding is protected: only a real session reaches it (completed
      // students are then bounced to /dashboard by its own gate), so a URL
      // still on /login means the stored session is dead.
      const response = await page.goto("/onboarding");
      const redirectedToLogin = page.url().includes("/login");
      if (response && response.status() < 400 && !redirectedToLogin) {
        // Session still alive — keep the persisted state, done.
        await context.close();
        return;
      }
    } catch {
      // Navigation failed — fall through to re-authentication.
    }
    await context.close();
    // Expired/revoked: discard and re-authenticate below (§23).
  }

  // ── Step 2: authenticate through the real UI ──
  const context = await browser.newContext();
  const page = await context.newPage();
  await loginThroughRealUi(page);

  // Prove the session is real: /onboarding is the one protected route, so a
  // guest lands on /login while an authenticated session either renders the
  // flow (setup not completed) or is bounced by its own gate to /dashboard
  // (setup completed) — both mean an authenticated, app-reachable session.
  // The onboarding project then leaves QA1 completed for the dependent specs.
  await page.goto("/onboarding");
  await expect(page).not.toHaveURL(/\/login/);
  const pathname = new URL(page.url()).pathname;
  expect(["/onboarding", "/dashboard"]).toContain(pathname);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // ── Step 3: persist the storage state for later runs ──
  mkdirSync(dirname(STORAGE_STATE), { recursive: true });
  await context.storageState({ path: STORAGE_STATE });
  await context.close();
});
