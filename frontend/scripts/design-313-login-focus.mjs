/** Task 3.13 — decisive focus-ring check: keyboard-focus a button on the real
 *  /login page (a plain, long-existing surface), screenshot, and pixel-probe
 *  the ring. If the ring renders there, the system works and the earlier
 *  computed-style zeros are a getComputedStyle custom-property reporting
 *  artifact in headless. */
import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto("http://localhost:3000/login", { waitUntil: "networkidle" });

// Tab to the first interactive element (email input has ring classes).
await page.keyboard.press("Tab");
const info = await page.evaluate(() => {
  const el = document.activeElement;
  const cs = getComputedStyle(el);
  return {
    tag: el?.tagName,
    id: el?.id,
    focusVisible: el?.matches(":focus-visible"),
    ringShadowVar: cs.getPropertyValue("--tw-ring-shadow"),
    boxShadow: cs.boxShadow.slice(0, 150),
    border: cs.borderColor,
  };
});
console.log("focused:", JSON.stringify(info, null, 2));

await page.screenshot({ path: ".playwright/design-313/specimen/focus-login-tab.png" });

// Pixel probe: does a dark ring of pixels surround the focused control?
const probe = await page.evaluate(() => {
  const el = document.activeElement;
  if (!el) return "none";
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
});
console.log("rect:", JSON.stringify(probe));
await browser.close();
