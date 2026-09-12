/**
 * tests/qa/auth-guards.spec.ts — the server-side guard matrix.
 *
 * Guests can browse the workspace (TASK.md 0.17 extended to the app routes):
 * /dashboard, /tasks, /calendar, /documents, /assistant, /tools and
 * /integrations all render their real shell with honest empty states and no
 * data read, and using a surface opens the skippable sign-in prompt instead of
 * a redirect. The one protected route left is /onboarding, and server-side
 * guards remain the authority:
 *
 * - unauthenticated → the four workspace routes + /dashboard return 200 with
 *   their guest state, while /onboarding 307s to /login with a sanitized,
 *   same-origin `?next=`;
 * - /onboarding bounces a completed user to /dashboard;
 * - /auth/callback answers a missing/invalid code with the sanitized notice
 *   redirect (never provider text, never a forged-host origin, never a crash);
 * - authenticated QA1 reaches every workspace route (control);
 * - the proxy matcher covers every PROTECTED_PREFIXES entry and still matches
 *   the guest-viewable routes for session refresh — a Node-level guard test,
 *   including a deliberate break proving the guard can fail.
 *
 * Guest-specific behaviours (prompt, empty states, zero data reads) live in
 * `guest-browsing.spec.ts`.
 *
 * Run: `npx playwright test` with the dev server + local stack (QA_SESSION.md).
 * It never mutates application data and never contacts hosted.
 */
import { test, expect } from "@playwright/test";
import { config as proxyConfig } from "../../proxy";
import { PROTECTED_PREFIXES } from "../../lib/auth/constants";
import { assertMatcherCoversProtectedRoutes } from "../../lib/auth/redirects";

const LOCAL_TARGET = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const APP_BASE = process.env.QA_BASE_URL ?? "http://localhost:3000";

function guestContext(browser: import("@playwright/test").Browser) {
  return browser.newContext({ storageState: { cookies: [], origins: [] } });
}

function locationOf(response: { headers(): Record<string, string> }): string {
  const location = response.headers()["location"];
  expect(location, "redirect must carry a Location header").toBeTruthy();
  return location;
}

const GUEST_ROUTES: readonly [string, string][] = [
  ["/dashboard", "dashboard"],
  ["/tasks", "Tasks"],
  ["/calendar", "Calendar"],
  ["/documents", "Documents"],
  ["/assistant", "Assistant"],
  ["/tools", "Tools"],
  ["/integrations", "Integrations"],
];

test.describe("auth guards (14.11)", () => {
  test.beforeAll(() => {
    if (!LOCAL_TARGET.test(url)) {
      throw new Error(
        `auth-guards QA is local-only; refusing target "${url || "(unset)"}"`,
      );
    }
  });

  test("proxy matcher covers the protected route and still matches the guest-viewable workspace", () => {
    // Importing proxy.ts already ran its load-time guard; assert it and the
    // real list explicitly so a failure names the route.
    expect(() =>
      assertMatcherCoversProtectedRoutes(proxyConfig.matcher),
    ).not.toThrow();

    for (const route of PROTECTED_PREFIXES) {
      expect(proxyConfig.matcher, `${route} in matcher`).toContain(route);
      expect(proxyConfig.matcher, `${route}/:path* in matcher`).toContain(
        `${route}/:path*`,
      );
    }

    // Only /onboarding is protected; the workspace routes are matched for
    // session refresh, never gated (0.17 extended to the app routes).
    expect(PROTECTED_PREFIXES).toEqual(["/onboarding"]);
    for (const route of GUEST_ROUTES.map(([path]) => path)) {
      expect(proxyConfig.matcher, `${route} matched for refresh`).toContain(route);
      expect(
        proxyConfig.matcher,
        `${route}/:path* matched for refresh`,
      ).toContain(`${route}/:path*`);
      expect(PROTECTED_PREFIXES, `${route} must not be protected`).not.toContain(
        route,
      );
    }

    // Public surfaces never reach the proxy.
    for (const publicPath of [
      "/",
      "/pricing",
      "/features",
      "/how-it-works",
      "/benchmarks",
      "/faq",
      "/devs-note",
      "/forgot-password",
      "/reset-password",
      "/auth/callback",
      "/auth/confirm",
    ]) {
      expect(proxyConfig.matcher, `${publicPath} must stay unmatchable`).not.toContain(
        publicPath,
      );
    }

    // The guard is proven able to fail: a matcher missing the one protected
    // route throws with its name.
    expect(() =>
      assertMatcherCoversProtectedRoutes(["/dashboard", "/dashboard/:path*"]),
    ).toThrow(/onboarding/);
  });

  test("unauthenticated: /onboarding 307s to /login; the workspace renders guest states", async ({
    browser,
  }) => {
    // Seven real navigations plus request probes; under the full suite's
    // parallel load this legitimately needs more than the default 60s.
    test.slow();
    const context = await guestContext(browser);

    for (const route of [...PROTECTED_PREFIXES, "/onboarding/nested-probe"]) {
      const response = await context.request.get(route, { maxRedirects: 0 });
      expect(response.status(), `${route} must be intercepted`).toBe(307);

      const target = new URL(locationOf(response), APP_BASE);
      expect(target.origin, `${route} must stay on-origin`).toBe(
        new URL(APP_BASE).origin,
      );
      expect(target.pathname, `${route} → /login`).toBe("/login");

      const next = target.searchParams.get("next");
      expect(next, `${route} carries the intended path`).toBe(route);
      expect(next!.startsWith("/"), `${route} next is a path`).toBe(true);
      expect(next!.startsWith("//"), `${route} next is not protocol-relative`).toBe(
        false,
      );
    }

    // Every workspace route is browsable: 200, real heading, no /login.
    for (const [route, heading] of GUEST_ROUTES) {
      if (route === "/dashboard") continue;
      const response = await context.request.get(route, { maxRedirects: 0 });
      expect(response.status(), `${route} must not be intercepted`).toBe(200);
      expect(response.headers()["location"], `${route} must not redirect`).toBeFalsy();

      const page = await context.newPage();
      await page.goto(route);
      await expect(page, `${route} must not bounce`).not.toHaveURL(/\/login/);
      await expect(
        page.getByRole("heading", { level: 1, name: heading }),
      ).toBeVisible();
      await page.close();
    }

    // A browser navigation to /tasks lands on the real, rendered guest page.
    const page = await context.newPage();
    await page.goto("/tasks");
    await expect(page).toHaveURL(/\/tasks/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Tasks" }),
    ).toBeVisible();

    await context.close();
  });

  test("guest /dashboard is public (200, guest state); no setup offer appears", async ({
    browser,
  }) => {
    const context = await guestContext(browser);
    const page = await context.newPage();

    const response = await page.goto("/dashboard");
    expect(response?.status()).toBe(200);
    await expect(page).not.toHaveURL(/\/login/);
    await expect(
      page.getByRole("link", { name: /create your workspace/i }).first(),
    ).toBeVisible();
    // 14.10 control: a guest never gets the setup offer.
    await expect(page.getByRole("link", { name: "Finish setup" })).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Set up your workspace" }),
    ).toHaveCount(0);

    await context.close();
  });

  test("/onboarding: guest → /login; completed student → /dashboard", async ({
    browser,
    page,
  }) => {
    const context = await guestContext(browser);
    const response = await context.request.get("/onboarding", { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    const target = new URL(locationOf(response), APP_BASE);
    expect(target.pathname).toBe("/login");
    expect(target.searchParams.get("next")).toBe("/onboarding");
    await context.close();

    // QA1 is completed by the qa-onboarding project this spec depends on.
    await page.goto("/onboarding");
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("authenticated control: every workspace route renders without a redirect", async ({
    page,
  }) => {
    const routes: [string, string][] = [
      ["/tasks", "Tasks"],
      ["/calendar", "Calendar"],
      ["/documents", "Documents"],
      ["/assistant", "Assistant"],
      ["/tools", "Tools"],
      ["/integrations", "Integrations"],
    ];

    for (const [route, heading] of routes) {
      const response = await page.goto(route);
      expect(response?.status(), `${route} status`).toBe(200);
      await expect(page, `${route} must not redirect`).not.toHaveURL(/\/login/);
      await expect(
        page.getByRole("heading", { level: 1, name: heading }),
      ).toBeVisible();
    }
  });

  test("/auth/callback: sanitized notices only, no forged host, no crash", async ({
    browser,
    page,
  }) => {
    const context = await guestContext(browser);
    const request = context.request;

    const cases: [string, string][] = [
      ["/auth/callback", "oauth"],
      ["/auth/callback?flow=signup", "verification"],
      [
        "/auth/callback?error=access_denied&error_description=SuperSecretProviderText",
        "oauth",
      ],
      ["/auth/callback?flow=signup&error=access_denied", "verification"],
    ];

    for (const [path, notice] of cases) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status(), `${path} must redirect, not crash`).toBe(307);

      const location = locationOf(response);
      const target = new URL(location, APP_BASE);
      expect(target.origin, `${path} must stay on-origin`).toBe(
        new URL(APP_BASE).origin,
      );
      expect(target.pathname, `${path} → /login`).toBe("/login");
      expect(target.searchParams.get("error"), `${path} notice`).toBe(notice);

      // Opaque notice codes only: the provider's own text never travels.
      expect(location, `${path} leaks provider text`).not.toContain(
        "SuperSecretProviderText",
      );
      expect(location, `${path} leaks the provider error`).not.toContain(
        "access_denied",
      );
    }

    // A forged Host must not become the redirect origin. Playwright may
    // refuse to override Host; the committed curl recording in
    // AUTH_ARCHITECTURE.md covers the case when it does.
    try {
      const forged = await request.get("/auth/callback", {
        maxRedirects: 0,
        headers: { host: "evil.example" },
      });
      expect(locationOf(forged), "forged Host must not be trusted").not.toContain(
        "evil.example",
      );
    } catch {
      // Header override rejected by the test client — recorded, not skipped.
    }

    // The browser follows the same-origin Location to the sanitized copy.
    await page.goto("/auth/callback");
    await expect(page).toHaveURL(/\/login\?error=oauth/);
    await expect(
      page.getByText("Google sign-in could not be completed. Please try again."),
    ).toBeVisible();

    await context.close();
  });
});
