/**
 * Load the real site, in a real browser, and report why a band is or is not visible.
 *
 * Server-side checks had all passed — the HTML carries the <video>, the mp4 and the poster both
 * return 200 with the right content type — while the page still looked wrong to a person. So
 * this asks the questions only a browser can answer: did the media element decode, is it laid
 * out at a non-zero size, is anything covering it, and is it inside the visible viewport.
 */
import { chromium } from "@playwright/test";

const url = process.argv[2] || "https://tavonel.com/";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const failures = [];
page.on("requestfailed", (r) => failures.push(`${r.url().split("/").pop()} ${r.failure()?.errorText}`));
page.on("response", (r) => { if (r.status() >= 400) failures.push(`${r.url().split("/").pop()} HTTP ${r.status()}`); });
page.on("pageerror", (e) => failures.push(`PAGEERROR ${e.message}`));

await page.goto(url, { waitUntil: "networkidle", timeout: 90_000 });
await page.waitForTimeout(4000);

const report = await page.evaluate(() => {
  const bands = [...document.querySelectorAll(".film-band")];
  return {
    bandCount: bands.length,
    heroScene: !!document.querySelector("#s1"),
    bands: bands.map((band) => {
      const v = band.querySelector("video");
      const b = band.getBoundingClientRect();
      const cs = getComputedStyle(band);
      // What is actually painted at the middle of this band?
      const hit = document.elementFromPoint(
        Math.min(innerWidth - 2, Math.max(2, b.left + b.width / 2)),
        Math.min(innerHeight - 2, Math.max(2, b.top + b.height / 2)),
      );
      return {
        src: v ? (v.currentSrc || "(no src)").split("/").pop() : "NO VIDEO ELEMENT",
        paused: v?.paused,
        t: v ? Number(v.currentTime.toFixed(2)) : null,
        readyState: v?.readyState,
        err: v?.error ? `${v.error.code}:${v.error.message}` : null,
        decoded: v ? `${v.videoWidth}x${v.videoHeight}` : null,
        box: `${Math.round(b.width)}x${Math.round(b.height)}`,
        top: Math.round(b.top),
        /*
          Does the hero frame actually fit the first screen?

          Every earlier check asked whether the film was cropped or paused, and both passed while
          the band still ran 291px below the fold — a visitor reported the hero had "disappeared"
          because the only part of it on screen was its top edge. Fitting is a separate property
          from being uncropped, and it needs its own number.
        */
        overflowsViewport: Math.max(0, Math.round(b.bottom - innerHeight)),
        display: cs.display,
        visibility: cs.visibility,
        opacity: cs.opacity,
        topElementAtCentre: hit ? `${hit.tagName}.${hit.className}`.slice(0, 60) : null,
      };
    }),
  };
});

console.log(JSON.stringify(report, null, 1));
console.log(failures.length ? `\nNETWORK/JS FAILURES:\n${failures.join("\n")}` : "\nno network or JS failures");
await page.screenshot({ path: "C:/Users/yspow/work/tavonel-saas-foundation/docs/audit/live-check.png" });
await browser.close();
