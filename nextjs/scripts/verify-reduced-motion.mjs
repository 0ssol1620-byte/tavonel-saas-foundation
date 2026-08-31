/**
 * What a `prefers-reduced-motion` visitor sees.
 *
 * The bands used to swap to a still under this setting, which meant a visitor who had it on saw
 * no explanation of the product at all — and, for one deploy, a broken-image icon where the
 * cuts with no poster file should have been. The cuts hold the camera still and translate
 * nothing, so they now play for everyone; this asserts that, and that nothing renders an
 * `<img>` here any more.
 */
import { chromium } from "@playwright/test";

const dest = "C:/Users/yspow/work/tavonel-saas-foundation/docs/audit";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  reducedMotion: "reduce",
});
const page = await ctx.newPage();
await page.goto("http://127.0.0.1:3056/", { waitUntil: "networkidle", timeout: 60_000 });
await page.waitForTimeout(2500);

const report = await page.evaluate(() => ({
  strayImages: [...document.querySelectorAll(".film-band img")].map((i) => ({
    src: (i.getAttribute("src") || "(none)").split("/").pop(),
    broken: i.naturalWidth === 0,
  })),
  videos: [...document.querySelectorAll(".film-band video")].map((v) => ({
    f: (v.currentSrc || "(none)").split("/").pop(),
    paused: v.paused,
    t: Number(v.currentTime.toFixed(2)),
    vw: v.videoWidth,
  })),
}));

console.log(JSON.stringify(report, null, 1));
const hero = report.videos[0];
const ok = report.strayImages.length === 0 && hero && !hero.paused;
console.log(ok ? "OK: reduced-motion plays the film" : "FAIL: hero not playing, or an <img> is present");
await page.screenshot({ path: `${dest}/home-reduced-motion.png` });
await browser.close();
