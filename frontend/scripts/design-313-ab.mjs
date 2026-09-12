/** Is press-feedback killing the ring? Isolated A/B test. */
import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const page = await browser.newPage();

await page.setContent(`<!doctype html><html><head>
<link rel="stylesheet" href="http://localhost:3000/_next/static/chunks/app_1qkk8tu._.css">
</head><body style="background:#1a1c1c">
<button id="a" class="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring-inverted focus-visible:ring-offset-2 focus-visible:ring-offset-surface-inverted">A: no press-feedback</button>
<button id="b" class="press-feedback focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring-inverted focus-visible:ring-offset-2 focus-visible:ring-offset-surface-inverted">B: with press-feedback</button>
</body></html>`);

await page.keyboard.press("Tab"); // keyboard modality
const out = await page.evaluate(() => {
  const res = {};
  for (const id of ["a", "b"]) {
    const el = document.getElementById(id);
    el.focus();
    const cs = getComputedStyle(el);
    res[id] = {
      focusVisible: el.matches(":focus-visible"),
      shadow: cs.boxShadow,
    };
  }
  return res;
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
