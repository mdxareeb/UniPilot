/** Task 3.13 — §31: measured before/after diff on real surfaces. What
 *  changed at the token level, and what the tokens could NOT reach. */
import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const STORAGE = ".playwright/qa-session.json";

const surfaces = [
  { name: "home (public)", url: "http://localhost:3000/", auth: false },
  { name: "pricing (public)", url: "http://localhost:3000/pricing", auth: false },
  { name: "features (public)", url: "http://localhost:3000/features", auth: false },
  { name: "dashboard-auth", url: "http://localhost:3000/dashboard", auth: true },
  { name: "tasks", url: "http://localhost:3000/tasks", auth: true },
  { name: "calendar", url: "http://localhost:3000/calendar", auth: true },
];

for (const s of surfaces) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    ...(s.auth ? { storageState: STORAGE } : {}),
  });
  const page = await ctx.newPage();
  await page.goto(s.url, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(600);
  const audit = await page.evaluate(() => {
    const out = { radii: {}, shadows: {}, backdrop: {}, inverted: 0, type: {} };
    const seen = new Map();
    document.querySelectorAll("div,section,article,aside,nav,header,button,a,input,select,dialog").forEach((el) => {
      const cs = getComputedStyle(el);
      const br = cs.borderRadius;
      if (br && br !== "0px") {
        const k = br.replace(/ /g, "");
        seen.set(k, (seen.get(k) ?? 0) + 1);
      }
    });
    out.radii = Object.fromEntries([...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8));
    // shadows in use
    const shadowSeen = new Map();
    document.querySelectorAll("*").forEach((el) => {
      const bs = getComputedStyle(el).boxShadow;
      if (bs && bs !== "none") {
        const key = bs.split(", ").filter((s) => !s.startsWith("rgba(0, 0, 0, 0) 0px 0px 0px 0px")).join(",").slice(0, 60);
        if (key) shadowSeen.set(key, (shadowSeen.get(key) ?? 0) + 1);
      }
    });
    out.shadows = Object.fromEntries([...shadowSeen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5));
    // backdrop stack
    const bgEl = document.querySelector(".bg-dotted-grid");
    if (bgEl) {
      out.backdrop.beforeImage = getComputedStyle(bgEl, "::before").backgroundImage.slice(0, 50);
      out.backdrop.afterImage = getComputedStyle(bgEl, "::after").backgroundImage.slice(0, 50);
      out.backdrop.bodyBg = getComputedStyle(document.body).backgroundColor;
    }
    out.inverted = [...document.querySelectorAll("div")].filter(
      (d) => getComputedStyle(d).backgroundColor === "rgb(26, 28, 28)"
    ).length;
    // hero/display weight check on marketing
    const h1 = document.querySelector("h1");
    if (h1) {
      const cs = getComputedStyle(h1);
      out.type.h1 = { size: cs.fontSize, weight: cs.fontWeight };
    }
    return out;
  });
  console.log(`=== ${s.name} ===`);
  console.log(JSON.stringify(audit, null, 2));
  await ctx.close();
}
await browser.close();
