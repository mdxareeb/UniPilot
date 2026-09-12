/** Task 3.13 — precise probe of the inverted-context focus ring. */
import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto("http://localhost:3000/specimen", { waitUntil: "networkidle" });

const out = await page.evaluate(() => {
  const btn = document.querySelector("button[aria-label='Icon on inverted']");
  if (!btn) return "not found";
  const before = getComputedStyle(btn).boxShadow;
  btn.focus({ focusVisible: true });
  const after = getComputedStyle(btn).boxShadow;
  const matchesFocusVisible = btn.matches(":focus-visible");
  // Every colored shadow in the stack:
  const colored = [];
  after.split(/,(?![^(]*\))/).forEach((s) => {
    const m = s.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
    if (m) colored.push(s.trim());
  });
  return {
    matchesFocusVisible,
    shadowBefore: before,
    shadowAfter: after,
    coloredShadows: colored,
    cssRingColor: getComputedStyle(btn).getPropertyValue("--tw-ring-color"),
  };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
