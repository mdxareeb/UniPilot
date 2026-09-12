/** Decisive: scroll the focused inverted IconButton into view, screenshot,
 *  and dump the full computed shadow. */
import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto("http://localhost:3000/specimen", { waitUntil: "networkidle" });

let hit = false;
for (let i = 0; i < 40 && !hit; i++) {
  await page.keyboard.press("Tab");
  hit = await page.evaluate(
    () => document.activeElement?.getAttribute("aria-label") === "Icon on inverted"
  );
}
if (!hit) { console.log("never focused"); process.exit(1); }
await page.evaluate(() => document.activeElement.scrollIntoView({ block: "center" }));
await page.waitForTimeout(200);
const rect = await page.evaluate(() => {
  const r = document.activeElement.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
await page.screenshot({
  path: ".playwright/design-313/specimen/inverted-focus.png",
  clip: { x: Math.max(0, rect.x - 30), y: Math.max(0, rect.y - 30), width: rect.w + 60, height: rect.h + 60 },
});
const probe = await page.evaluate(() => ({
  all: document.activeElement ? getComputedStyle(document.activeElement).boxShadow : "none",
}));
console.log("rect:", JSON.stringify(rect));
console.log("computed full shadow:", probe.all);
await browser.close();
