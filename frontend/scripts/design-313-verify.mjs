/**
 * Task 3.13 — specimen + responsive + contrast + motion verification.
 * Runs against the dev server (specimen flag on). Playwright headless,
 * reusing the 20.10 QA storage state where noted.
 * Usage: node scripts/design-313-verify.mjs
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(".playwright/design-313/specimen");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();

// ---------- 1. Specimen renders + motif candidates visible ----------
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto("http://localhost:3000/specimen", { waitUntil: "networkidle" });
  const title = await page.title();
  const checks = await page.evaluate(() => {
    const r = {};
    r.motifPanels = [...document.querySelectorAll("[data-motif]")].map((el) => ({
      motif: el.getAttribute("data-motif"),
      afterImage: getComputedStyle(el, "::after").backgroundImage.slice(0, 60),
    }));
    r.radiusFrame = getComputedStyle(document.querySelector(".rounded-frame")).borderRadius;
    r.radiusCard = getComputedStyle(document.querySelector(".rounded-card")).borderRadius;
    r.radiusNested = getComputedStyle(document.querySelector(".rounded-nested"))?.borderRadius ?? null;
    const inverted = [...document.querySelectorAll("div")].find((d) => d.className.includes("bg-surface-inverted"));
    r.invertedFill = inverted ? getComputedStyle(inverted).backgroundColor : null;
    const overlay = document.querySelector(".shadow-overlay");
    r.shadowOverlay = overlay ? getComputedStyle(overlay).boxShadow.slice(0, 70) : null;
    r.displayXl = (() => {
      const el = [...document.querySelectorAll("p")].find((p) => p.className.includes("text-display-xl"));
      const cs = getComputedStyle(el);
      return { size: cs.fontSize, weight: cs.fontWeight };
    })();
    return r;
  });
  await page.screenshot({ path: resolve(OUT, "specimen-1280.png"), fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(OUT, "specimen-375.png"), fullPage: true });
  console.log(JSON.stringify({ title, checks }, null, 2));
  await page.close();
}

// ---------- 2. Responsive widths on real surfaces: overflow check ----------
const STORAGE = resolve(".playwright/qa-session.json");
{
  const routes = [
    { url: "http://localhost:3000/", name: "home", auth: false },
    { url: "http://localhost:3000/dashboard", name: "dashboard-auth", auth: true },
  ];
  for (const route of routes) {
    for (const width of [320, 375, 768, 1024, 1280]) {
      const ctx = await browser.newContext({
        viewport: { width, height: 800 },
        ...(route.auth ? { storageState: STORAGE } : {}),
      });
      const page = await ctx.newPage();
      await page.goto(route.url, { waitUntil: "networkidle", timeout: 60000 });
      await page.waitForTimeout(600);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      console.log(`${route.name} @ ${width}: overflowX=${overflow}px ${overflow > 0 ? "FAIL" : "ok"}`);
      await ctx.close();
    }
  }
}

// ---------- 3. Contrast measurements on all three fills ----------
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto("http://localhost:3000/specimen", { waitUntil: "networkidle" });

  const ratios = await page.evaluate(() => {
    const hex = (rgb) => {
      const m = rgb.match(/\d+(\.\d+)?/g);
      return m.slice(0, 3).map(Number);
    };
    const lum = ([r, g, b]) => {
      const a = [r, g, b].map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
    };
    const contrast = (fg, bg) => {
      const l1 = lum(fg), l2 = lum(bg);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    };
    const measure = (el) => {
      const cs = getComputedStyle(el);
      const fg = hex(cs.color);
      // walk up for an opaque bg
      let node = el;
      let bg = null;
      while (node && node !== document.documentElement) {
        const c = getComputedStyle(node).backgroundColor;
        if (c && c !== "rgba(0, 0, 0, 0)") { bg = hex(c); break; }
        node = node.parentElement;
      }
      if (!bg) bg = hex(getComputedStyle(document.body).backgroundColor);
      return contrast(fg, bg).toFixed(2);
    };
    const r = {};
    const first = (sel) => document.querySelector(sel);
    // Solid fill
    const solidCard = [...document.querySelectorAll("div")].find((d) => typeof d.className === "string" && d.className.includes("bg-card") && d.querySelector("p"));
    if (solidCard) {
      r.solidBody = measure(solidCard.querySelector("p"));
      r.solidLabel = measure(solidCard.querySelectorAll("p")[1] ?? solidCard.querySelector("p"));
    }
    // Glass fill (measured against the backdrop base — worst case for glass text)
    const glassPanel = [...document.querySelectorAll("div")].find((d) => typeof d.className === "string" && d.className.includes("bg-glass") && d.querySelector("p"));
    if (glassPanel) r.glassBody = measure(glassPanel.querySelector("p"));
    // Inverted fill
    const invCard = first('[class*="variant"]') ?? [...document.querySelectorAll("div")].find((d) => typeof d.className === "string" && d.className.includes("bg-surface-inverted"));
    if (invCard) {
      const invP = [...invCard.querySelectorAll("p")];
      if (invP.length) {
        r.invertedTitle = measure(invP[0]);
        if (invP[1]) r.invertedSub = measure(invP[1]);
      }
      // nested-in-inverted
      const nested = [...invCard.querySelectorAll("div")].find((d) => typeof d.className === "string" && d.className.includes("bg-surface-inverted-nested"));
      if (nested) {
        const np = nested.querySelectorAll("p");
        if (np.length) r.nestedInInverted = measure(np[0]);
      }
    }
    // muted-foreground on card (the standard body-muted role)
    const muted = document.querySelector(".text-muted-foreground");
    if (muted) r.mutedOnCard = measure(muted);
    return r;
  });
  console.log("contrast ratios:", JSON.stringify(ratios, null, 2));
  await page.close();
}

// ---------- 4. Motion regression check (§34): nothing stuck hidden ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, storageState: STORAGE });
  const page = await ctx.newPage();
  for (const route of ["/dashboard", "/tasks", "/calendar"]) {
    await page.goto(`http://localhost:3000${route}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    const s = await page.evaluate(() => {
      let n = 0;
      document.querySelectorAll("main *").forEach((el) => {
        const cs = getComputedStyle(el);
        if (parseFloat(cs.opacity) === 0 || cs.visibility === "hidden" || cs.display === "none") {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0 && el.textContent?.trim()) n++;
        }
      });
      return n;
    });
    console.log(`motion-stuck on ${route}: ${s}`);
  }
  // reduced motion pass
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("http://localhost:3000/dashboard", { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  const reducedOk = await page.evaluate(() => {
    let n = 0;
    document.querySelectorAll("main *").forEach((el) => {
      const cs = getComputedStyle(el);
      if (parseFloat(cs.opacity) === 0) n++;
    });
    return n;
  });
  console.log(`reduced-motion hidden on /dashboard: ${reducedOk}`);
  await ctx.close();
}

await browser.close();
console.log("verify done");
