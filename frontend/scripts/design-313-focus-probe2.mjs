/** Task 3.13 — why does ring not render? Check a normal Button's focus shadow. */
import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto("http://localhost:3000/specimen", { waitUntil: "networkidle" });

const out = await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => b.textContent === "Primary");
  if (!btn) return "not found";
  btn.focus({ focusVisible: true });
  return {
    matches: btn.matches(":focus-visible"),
    shadow: getComputedStyle(btn).boxShadow,
    classList: btn.className,
  };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
