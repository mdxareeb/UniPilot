/** Task 3.313 — is a LATER rule resetting box-shadow? Check the cascade order
 *  for .press-feedback vs .focus-visible:ring-2 and whether --tw-ring-shadow
 *  computes on a focused button in a MINIMAL page (no press-feedback). */
import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const page = await browser.newPage();

// Build a minimal page with only Tailwind's compiled CSS + a focused button.
await page.setContent(`<!doctype html><html><head>
<link rel="stylesheet" href="http://localhost:3000/_next/static/chunks/app_1qkk8tu._.css">
</head><body>
<button id="b" class="focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none press-feedback">Focus probe</button>
<script>
  // force focus-visible heuristics: keyboard modality
  document.addEventListener("keydown", () => {}, true);
  window.__fire = () => { document.getElementById("b").focus(); };
</script>
</body></html>`);
await page.evaluate(() => window.__fire());
await page.keyboard.press("Tab"); // establish keyboard modality then refocus
const out = await page.evaluate(() => {
  const b = document.getElementById("b");
  b.focus();
  const cs = getComputedStyle(b);
  return {
    focusVisible: b.matches(":focus-visible"),
    boxShadow: cs.boxShadow.slice(0, 200),
  };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
