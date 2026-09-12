/**
 * Task 20.10 — fixture self-check, not a feature QA pass.
 *
 * Loads exactly the one protected route (/onboarding) with the authenticated
 * storage state produced by `tests/qa/auth.setup.ts`, purely to prove the
 * reusable fixture works: a guest is bounced to /login there, so reaching the
 * flow (or its completed-student bounce to /dashboard) can only happen with a
 * real session. This is deliberately NOT task 3.10 (authenticated Motion
 * verification), 16.13/17.13 (responsive QA), or any other deferred pass —
 * those tasks now become actionable with this fixture but keep their own
 * definitions of done.
 *
 * (`/tasks` was the fixture's earlier probe; since guests can browse the
 * workspace it would pass for any visitor and no longer proves anything.)
 *
 * Requires: `npx playwright test` (runs the qa-auth-setup project first),
 * the dev server on http://localhost:3000 pointed at the LOCAL Supabase
 * stack via .env.development.local.
 */
import { test, expect } from "@playwright/test";

test(
  "authenticated storage state reaches the protected onboarding route without a login redirect",
  async ({ page }) => {
    // The proxy + requireUser must both accept the real session. QA1 is
    // completed by the qa-onboarding dependency, so the route's own gate
    // forwards to /dashboard; an unfinished session would render the flow.
    const response = await page.goto("/onboarding");
    expect(response?.status()).toBeLessThan(400);
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  },
);
