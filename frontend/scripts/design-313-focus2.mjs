/** Task 3.13 — §33 final pass: Tab-driven focus rings + corrected disabled
 *  contrast (composites element opacity into the fg). */
import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto("http://localhost:3000/specimen", { waitUntil: "networkidle" });

// Keyboard-focus from the start of the document until Primary is focused.
await page.keyboard.press("Home");
const btn = page.locator("button", { hasText: "Primary" }).first();
await btn.focus();
const out = await page.evaluate(() => {
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
  const nonzeroShadows = (el) =>
    getComputedStyle(el)
      .boxShadow.split(/,(?![^(]*\))/)
      .map((s) => s.trim())
      .filter((s) => {
        const m = s.match(/rgba?\(/);
        if (!m) return false;
        const c = parseRGB(s);
        return c && (c.a !== 0 || / [\d.]+px /.test(s.replace(/rgba?\([^)]+\)/, "")));
      });

  const r = {};
  const primary = [...document.querySelectorAll("button")].find((b) => b.textContent === "Primary");
  if (primary && primary.matches(":focus-visible")) {
    r.primaryFocusVisible = true;
    r.primaryShadows = nonzeroShadows(primary);
  }
  // effective fg color of the disabled button (opacity multiplies)
  const disabled = [...document.querySelectorAll("button")].find((b) => b.disabled && b.textContent === "Disabled");
  if (disabled) {
    const cs = getComputedStyle(disabled);
    const fg = parseRGB(cs.color);
    const op = parseFloat(cs.opacity);
    const eff = { r: fg.r * op + 255 * (1 - op), g: fg.g * op + 255 * (1 - op), b: fg.b * op + 255 * (1 - op), a: 1 };
    r.disabledFgOnCard = contrast(eff, { r: 255, g: 255, b: 255, a: 1 });
  }
  // disabled on inverted (light text, 50% opacity over #1a1c1c)
  const disInv = [...document.querySelectorAll("button")].find(
    (b) => b.disabled && b.closest('[class*="bg-surface-inverted"]')
  );
  if (disInv) {
    const cs = getComputedStyle(disInv);
    const fg = parseRGB(cs.color);
    const op = parseFloat(cs.opacity);
    const bg = { r: 26, g: 28, b: 28, a: 1 };
    const eff = { r: fg.r * op + bg.r * (1 - op), g: fg.g * op + bg.g * (1 - op), b: fg.b * op + bg.b * (1 - op), a: 1 };
    r.disabledOnInverted = contrast(eff, bg);
  }
  return r;
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
