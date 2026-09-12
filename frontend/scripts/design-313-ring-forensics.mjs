/** Task 3.13 — ring var forensics. */
import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto("http://localhost:3000/specimen", { waitUntil: "networkidle" });

const out = await page.evaluate(() => {
  const primary = [...document.querySelectorAll("button")].find((b) => b.textContent === "Primary");
  primary.focus();
  const cs = getComputedStyle(primary);
  return {
    matchesFocusVisible: primary.matches(":focus-visible"),
    ringShadowVar: cs.getPropertyValue("--tw-ring-shadow"),
    ringColorVar: cs.getPropertyValue("--tw-ring-color"),
    ringOffsetShadowVar: cs.getPropertyValue("--tw-ring-offset-shadow"),
    ringOffsetColorVar: cs.getPropertyValue("--tw-ring-offset-color"),
    boxShadowRaw: cs.boxShadow,
    outlineRaw: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`,
  };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
