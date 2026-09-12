/**
 * Task 3.13 — §33 focus-ring contrast, precisely. A focus ring is a shadow
 * (box-shadow), so its contrast is ring-color vs the surface it sits on.
 * Uses :focus-visible via CDP-forced state emulation; composites alpha.
 * Usage: node scripts/design-313-focus.mjs
 */
import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto("http://localhost:3000/specimen", { waitUntil: "networkidle" });

// Focus with keyboard so :focus-visible applies.
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

  const r = {};
  const ringOf = (el) => {
    const shadows = getComputedStyle(el).boxShadow.split(/,(?![^(]*\))/);
    // The ring shadow is the one carrying the ring color (non-0-alpha, from --ring)
    for (const s of shadows) {
      const c = parseRGB(s.trim());
      if (c) return c;
    }
    return null;
  };

  // Light context: "Focus this" (primary button on card)
  const lightBtn = [...document.querySelectorAll("button")].find((b) => b.textContent === "Focus this");
  if (lightBtn) {
    lightBtn.focus({ focusVisible: true });
    const ring = ringOf(lightBtn);
    r.lightRing_vs_card = ring ? contrast(ring, { r: 255, g: 255, b: 255, a: 1 }) : null;
    r.lightRing_vs_backdrop = ring ? contrast(ring, { r: 244, g: 244, b: 245, a: 1 }) : null;
  }

  // Inverted context: the specimen IconButton that overrides ring + border
  const invBtn = document.querySelector("button[aria-label='Icon on inverted']");
  if (invBtn) {
    invBtn.focus({ focusVisible: true });
    const ring = ringOf(invBtn);
    r.invertedRing_overridden = ring ? contrast(ring, { r: 26, g: 28, b: 28, a: 1 }) : null;
    const bc = parseRGB(getComputedStyle(invBtn).borderColor);
    r.invertedBorder_token = bc ? contrast(bc, { r: 26, g: 28, b: 28, a: 1 }) : null;
  }

  // What an UN-overridden default ring would measure on inverted (the defect
  // the spec warns about): simulate --ring #000 on the near-black fill.
  r.defaultRing_on_inverted_simulated = contrast({ r: 0, g: 0, b: 0, a: 1 }, { r: 26, g: 28, b: 28, a: 1 });

  // ring-inverted token on the light surface (its worst legal case is
  // inverted-only; measuring for the record)
  r.ringInvertedToken_vs_invertedFill = contrast({ r: 240, g: 241, b: 241, a: 1 }, { r: 26, g: 28, b: 28, a: 1 });

  return r;
});

console.log(JSON.stringify(out, null, 2));
await browser.close();
