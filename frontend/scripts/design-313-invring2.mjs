/** Inspect the specimen's inverted IconButton after the variant change. */
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
const out = await page.evaluate(() => {
  const el = document.activeElement;
  const cs = getComputedStyle(el);
  return {
    classList: el.className,
    ringColor: cs.getPropertyValue("--tw-ring-color"),
    ringShadow: cs.getPropertyValue("--tw-ring-shadow"),
    offsetShadow: cs.getPropertyValue("--tw-ring-offset-shadow"),
    boxShadow: cs.boxShadow,
  };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
