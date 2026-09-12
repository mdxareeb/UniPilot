/**
 * Task 3.13 — §33 accessibility: contrast on all three fills, focus rings,
 * disabled states, placeholders. Explicit composite math for translucent
 * fills (glass composites over the backdrop base).
 * Usage: node scripts/design-313-contrast.mjs
 */
import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto("http://localhost:3000/specimen", { waitUntil: "networkidle" });

const ratios = await page.evaluate(() => {
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
  const composite = (over, under) => ({
    r: over.r * over.a + under.r * (1 - over.a),
    g: over.g * over.a + under.g * (1 - over.a),
    b: over.b * over.a + under.b * (1 - over.a),
    a: 1,
  });
  const bgOf = (el) => {
    let node = el;
    const chain = [];
    while (node && node !== document.documentElement) {
      const c = parseRGB(getComputedStyle(node).backgroundColor);
      if (c && c.a > 0) chain.push(c);
      if (c && c.a === 1) break;
      node = node.parentElement;
    }
    // composite from the bottom (page base) up
    const base = { r: 244, g: 244, b: 245, a: 1 }; // --background
    return chain.reverse().reduce((acc, c) => composite(c, acc), base);
  };
  const textOn = (el) => {
    if (!el || el.nodeType !== 1) return "n/a";
    const cs = getComputedStyle(el);
    let fg = parseRGB(cs.color);
    const bg = bgOf(el);
    // Composite a translucent foreground over its actual background before
    // luminance — an rgba fg is NOT the same color as its rgb part.
    if (fg && fg.a < 1) fg = composite(fg, bg);
    return fg ? contrast(fg, bg) : "n/a";
  };
  const r = {};

  // --- Solid fill: body + muted + label text ---
  const solidCard = [...document.querySelectorAll("section")].find((s) =>
    s.textContent.includes("Opaque card fill")
  );
  if (solidCard) {
    const p = [...solidCard.querySelectorAll("p")];
    r.solidBody = textOn(p[0]);
    r.solidMuted = textOn(p[1]);
  }

  // --- Glass fill: composite glass over backdrop base, then text over it ---
  const glassPanel = [...document.querySelectorAll("div")].find(
    (d) => typeof d.className === "string" && d.className.includes("bg-glass") && d.textContent.includes("Glass")
  );
  if (glassPanel) {
    const p = glassPanel.querySelectorAll("p");
    r.glassBody = textOn(p[0]);
    r.glassMuted = textOn(p[1]);
  }

  // --- Inverted fill: title + sub + nested-in-inverted ---
  const invCard = [...document.querySelectorAll("div")].find(
    (d) => typeof d.className === "string" && d.className.includes("bg-surface-inverted") && !d.className.includes("nested")
  );
  if (invCard) {
    const directP = [...invCard.querySelectorAll(":scope > p")];
    const p = directP.length ? directP : [...invCard.querySelectorAll("p")];
    r.invertedTitle = textOn(p[0]);
    r.invertedSub = textOn(p[1]);
    const nested = [...invCard.querySelectorAll("div")].find(
      (d) => typeof d.className === "string" && d.className.includes("bg-surface-inverted-nested")
    );
    if (nested) {
      const np = nested.querySelectorAll("p");
      r.nestedInInvertedTitle = textOn(np[0]);
      r.nestedInInvertedSub = textOn(np[1]);
    }
  }

  // --- Disabled states on both fills ---
  const disabled = [...document.querySelectorAll("button")].find((b) => b.disabled && b.textContent === "Disabled");
  if (disabled) r.disabledLight = textOn(disabled);
  const disabledInv = [...document.querySelectorAll("button")].find((b) => b.disabled && b.closest('[class*="bg-surface-inverted"]'));
  if (disabledInv) r.disabledInverted = textOn(disabledInv);

  // --- Focus rings: light context + inverted context (ring color vs its surface) ---
  const focusTarget = [...document.querySelectorAll("button")].find((b) => b.textContent === "Focus this");
  if (focusTarget) {
    focusTarget.focus();
    const cs = getComputedStyle(focusTarget);
    const ring = parseRGB(cs.boxShadow.match(/rgba?\([\d., ]+\)/)?.[0] ?? "rgb(0,0,0)");
    r.focusRingLight = ring ? contrast(ring, { r: 244, g: 244, b: 245, a: 1 }) : null;
  }
  const invSection = [...document.querySelectorAll("div")].find(
    (d) => typeof d.className === "string" && d.className.includes("bg-surface-inverted") && d.querySelector("button[aria-label='Icon on inverted']")
  );
  if (invSection) {
    const btn = invSection.querySelector("button[aria-label='Icon on inverted']");
    btn.focus();
    const cs = getComputedStyle(btn);
    const ringM = cs.boxShadow.match(/rgba?\([\d., ]+\)/);
    const ring = ringM ? parseRGB(ringM[0]) : parseRGB(cs.borderColor);
    r.focusRingInverted = ring ? contrast(ring, { r: 26, g: 28, b: 28, a: 1 }) : null;
    r.iconOnInverted = textOn(btn.querySelector("svg"));
  }

  // --- Placeholder: create a probe input inside a Solid card context ---
  const probeHost = [...document.querySelectorAll("section")].find((s) => s.textContent.includes("Badges, dividers"));
  if (probeHost) {
    const input = document.createElement("input");
    input.placeholder = "Placeholder text";
    input.className = "rounded-base border border-border bg-card px-3 py-2 text-body-md";
    probeHost.appendChild(input);
    const cs = getComputedStyle(input);
    const phColor = cs.getPropertyValue("--tw-placeholder-color") || "rgb(76, 69, 70)";
    r.placeholderOnCard = contrast(parseRGB(phColor.trim()) ?? { r: 76, g: 69, b: 70, a: 1 }, { r: 255, g: 255, b: 255, a: 1 });
    input.remove();
  }

  // --- Borders/dividers visibility on each fill (border vs fill) ---
  const solidBorder = parseRGB(getComputedStyle(document.querySelector(".rounded-card.border-border")).borderColor);
  r.solidBorderVsCard = contrast(solidBorder, { r: 255, g: 255, b: 255, a: 1 });
  if (invCard) {
    const invBorder = parseRGB(getComputedStyle(invCard).borderColor);
    r.invertedBorderVsFill = contrast(invBorder, { r: 26, g: 28, b: 28, a: 1 });
    const nestedEl = [...invCard.querySelectorAll("div")].find((d) => typeof d.className === "string" && d.className.includes("border-border-inverted"));
    if (nestedEl) {
      const nb = parseRGB(getComputedStyle(nestedEl).borderColor);
      r.nestedBorderVsFill = contrast(nb, { r: 46, g: 46, b: 47, a: 1 });
    }
  }
  return r;
});

console.log(JSON.stringify(ratios, null, 2));
await browser.close();
