/** Task 3.13 — inverted-context focus ring, decisive (login-page method). */
import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto("http://localhost:3000/specimen", { waitUntil: "networkidle" });

// Tab through until the "Icon on inverted" button is focused.
let hit = false;
for (let i = 0; i < 40 && !hit; i++) {
  await page.keyboard.press("Tab");
  hit = await page.evaluate(
    () => document.activeElement?.getAttribute("aria-label") === "Icon on inverted"
  );
}

const out = await page.evaluate(() => {
  const el = document.activeElement;
  if (!el) return { error: "none" };
  const cs = getComputedStyle(el);
  const parseRGB = (str) => {
    const m = str.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
    if (!m) return null;
    return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const contrast = (fg, bg) =>
    ((Math.max(lum(fg), lum(bg)) + 0.05) / (Math.min(lum(fg), lum(bg)) + 0.05)).toFixed(2);
  // full shadow, no truncation
  const full = cs.boxShadow;
  // ring entry: the last NON-transparent colored entry
  const entries = full.split(/,(?![^(]*\))/).map((s) => s.trim());
  const colored = entries.filter((s) => {
    const c = parseRGB(s);
    return c && !(c.r === 0 && c.g === 0 && c.b === 0 && c.a === 0);
  });
  const ring = colored.find((s) => /0px 0px 0px [\d.]+px/.test(s.replace(/rgba?\([^)]+\)/, ""))) ?? colored[colored.length - 1];
  const ringColor = ring ? parseRGB(ring) : null;
  return {
    hit: el.getAttribute("aria-label"),
    focusVisible: el.matches(":focus-visible"),
    fullShadow: full,
    ringEntry: ring ?? null,
    ringContrastVsInverted: ringColor ? contrast(ringColor, { r: 26, g: 28, b: 28, a: 1 }) : null,
  };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
