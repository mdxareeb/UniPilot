/**
 * Task 3.13 LOOP 4 — propagation-proof capture utility.
 * Usage: node scripts/design-313-capture.mjs <before|after>
 * Captures the seven surface/state combinations at 375 and 1280 into
 * .playwright/design-313/<phase>/ using the 20.10 QA storage state for the
 * authenticated surfaces (never the founder account; see QA_SESSION.md).
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const phase = process.argv[2];
if (phase !== "before" && phase !== "after") {
  console.error("Usage: node scripts/design-313-capture.mjs <before|after>");
  process.exit(1);
}

const outDir = resolve(`.playwright/design-313/${phase}`);
mkdirSync(outDir, { recursive: true });

const STORAGE = resolve(".playwright/qa-session.json");

const surfaces = [
  { name: "home", url: "http://localhost:3000/", auth: false },
  { name: "features", url: "http://localhost:3000/features", auth: false },
  { name: "pricing", url: "http://localhost:3000/pricing", auth: false },
  { name: "dashboard-guest", url: "http://localhost:3000/dashboard", auth: false },
  { name: "dashboard-auth", url: "http://localhost:3000/dashboard", auth: true },
  { name: "tasks", url: "http://localhost:3000/tasks", auth: true },
  { name: "calendar", url: "http://localhost:3000/calendar", auth: true },
];

const widths = [375, 1280];

const browser = await chromium.launch();

for (const surface of surfaces) {
  for (const width of widths) {
    // Separate contexts: authenticated ones load the QA storage state; guest
    // ones stay clean so no session cookie leaks into the guest capture.
    const context = await browser.newContext({
      viewport: { width, height: width === 375 ? 812 : 800 },
      ...(surface.auth ? { storageState: STORAGE } : {}),
    });
    const page = await context.newPage();
    try {
      await page.goto(surface.url, { waitUntil: "networkidle", timeout: 60_000 });
      await page.waitForTimeout(1200); // let entrances settle
      const file = resolve(outDir, `${surface.name}-${width}.png`);
      await page.screenshot({ path: file, fullPage: true });
      console.log(`captured ${surface.name} @ ${width}`);
    } catch (err) {
      console.error(`FAILED ${surface.name} @ ${width}: ${err.message}`);
    } finally {
      await context.close();
    }
  }
}

await browser.close();
console.log("done");
