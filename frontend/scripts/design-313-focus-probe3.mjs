/** Task 3.13 — how does the focus indicator actually render in TW v4? */
import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto("http://localhost:3000/specimen", { waitUntil: "networkidle" });

const out = await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => b.textContent === "Primary");
  btn.focus({ focusVisible: true });
  const cs = getComputedStyle(btn);
  return {
    outlineStyle: cs.outlineStyle,
    outlineWidth: cs.outlineWidth,
    outlineColor: cs.outlineColor,
    boxShadow: cs.boxShadow === "none" ? "none" : cs.boxShadow.slice(0, 120),
    ringVar: cs.getPropertyValue("--tw-ring-color"),
  };
});
console.log(JSON.stringify(out, null, 2));

// Screenshot the focused state for visual evidence
const btn2 = await page.locator("button", { hasText: "Primary" }).first();
await btn2.focus();
await page.screenshot({ path: ".playwright/design-313/specimen/focus-primary.png", clip: { x: 40, y: 600, width: 400, height: 200 } });
await browser.close();
console.log("done");
