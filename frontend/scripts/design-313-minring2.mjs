/** Forensic: does :focus-visible box-shadow compute at all in this
 *  stylesheet, on a class-free probe with inline styles? */
import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const page = await browser.newPage();

await page.setContent(`<!doctype html><html><head>
<style>
  .r:focus-visible { box-shadow: 0 0 0 4px rgb(0, 0, 0); }
  @supports (color: color-mix(in lab, red, red)) { .supports-probe::after { content: "x"; } }
</style></head><body>
<button id="b" class="r">probe</button></body></html>`);
await page.keyboard.press("Tab");
const out = await page.evaluate(() => {
  const b = document.getElementById("b");
  b.focus();
  return {
    focusVisible: b.matches(":focus-visible"),
    shadow: getComputedStyle(b).boxShadow,
    tag: b.tagName,
  };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
