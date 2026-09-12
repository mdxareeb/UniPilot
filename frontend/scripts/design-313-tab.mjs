/** Task 3.13 — real keyboard Tab focus, then read the ring. */
import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto("http://localhost:3000/specimen", { waitUntil: "networkidle" });

// Real keyboard: Tab until the Primary button is focused (max 25 tabs).
let focused = false;
for (let i = 0; i < 25 && !focused; i++) {
  await page.keyboard.press("Tab");
  focused = await page.evaluate(() =>
    document.activeElement?.textContent === "Primary" &&
    document.activeElement?.matches(":focus-visible")
  );
}

const out = await page.evaluate(() => {
  const el = document.activeElement;
  if (!el) return { error: "no active element" };
  const cs = getComputedStyle(el);
  return {
    tag: el.tagName,
    text: el.textContent?.slice(0, 20),
    focusVisible: el.matches(":focus-visible"),
    boxShadow: cs.boxShadow,
  };
});
console.log(JSON.stringify(out, null, 2));

// Screenshot the focused button row for the founder's eyes.
await page.screenshot({
  path: ".playwright/design-313/specimen/focus-ring-tab.png",
  clip: { x: 0, y: 560, width: 1280, height: 240 },
});
await browser.close();
console.log("screenshot saved");
