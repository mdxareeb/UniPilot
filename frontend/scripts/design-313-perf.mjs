/** Task 3.13 — §32 performance: backdrop-filter element counts on the
 *  heaviest surface, scroll-repaint behaviour of the backdrop, motif cost. */
import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const STORAGE = ".playwright/qa-session.json";

// Heaviest surface: the authenticated dashboard (rail + bar + cards + launcher).
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, storageState: STORAGE });
const page = await ctx.newPage();
await page.goto("http://localhost:3000/dashboard", { waitUntil: "networkidle" });

const counts = await page.evaluate(() => {
  const backdropFilter = [];
  const all = document.querySelectorAll("*");
  all.forEach((el) => {
    const cs = getComputedStyle(el);
    if (cs.backdropFilter && cs.backdropFilter !== "none") backdropFilter.push(el.tagName + "." + (el.className || "").toString().split(" ")[0]);
  });
  return {
    totalElements: all.length,
    backdropFilterCount: backdropFilter.length,
    backdropFilterElements: backdropFilter.slice(0, 12),
    willChange: [...all].filter((el) => getComputedStyle(el).willChange !== "auto").length,
  };
});
console.log("dashboard backdrop-filter audit:", JSON.stringify(counts, null, 2));

// Scroll repaint: the fixed backdrop must not repaint on scroll. Measure by
// confirming the ::before stays position:fixed after scrolling (it cannot
// "repaint" per-frame as a composited fixed layer; check it doesn't become
// the containing block by scrolling and re-reading).
await page.evaluate(() => window.scrollTo(0, 400));
await page.waitForTimeout(150);
const afterScroll = await page.evaluate(() => {
  const el = document.querySelector(".bg-dotted-grid");
  const cs = getComputedStyle(el, "::before");
  const r = el.getBoundingClientRect();
  return { beforePosition: cs.position, mountRectTop: r.top };
});
console.log("after 400px scroll:", JSON.stringify(afterScroll));

// Motif cost: it is pure CSS (radial/linear-gradient), 0 extra bytes of
// assets. Verify no image request is made for it:
const imageRequests = [];
page.on("request", (req) => { if (req.resourceType() === "image") imageRequests.push(req.url()); });
await page.goto("http://localhost:3000/dashboard", { waitUntil: "networkidle" });
console.log("image requests after full dashboard load:", imageRequests.length, imageRequests.slice(0, 5));

await ctx.close();
await browser.close();
console.log("perf done");
