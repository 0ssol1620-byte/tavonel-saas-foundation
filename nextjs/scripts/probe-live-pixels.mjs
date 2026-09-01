/**
 * What the live site actually paints, compared to the source frame.
 *
 * Every measurement so far was on local files: the master on disk against the PNG it came from.
 * That says nothing about what a visitor's browser ends up putting on the glass, which is the
 * only thing the complaint is about. This screenshots a band from the live site at 2x, seeked to
 * a known time, so it can be differenced against the source frame for that same time.
 */
import { chromium } from "@playwright/test";

const url = process.argv[2] || "https://tavonel.com/";
const at = Number(process.argv[3] || 6.0);
const out = "C:/Users/yspow/work/tavonel-saas-foundation/docs/audit";

// Real Chrome: the bundled Chromium has no H.264 decoder and paints nothing at all.
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const ctx = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
await page.waitForTimeout(8000);

const bands = await page.$$(".film-band");
for (let i = 0; i < bands.length; i += 1) {
  await bands[i].scrollIntoViewIfNeeded();
  await page.waitForTimeout(6000);

  // Park every band on the same frame so the comparison is like for like.
  const info = await bands[i].evaluate(async (el, time) => {
    const v = el.querySelector("video");
    if (!v) return null;
    v.pause();
    v.currentTime = time;
    await new Promise((r) => { v.addEventListener("seeked", r, { once: true }); setTimeout(r, 4000); });
    const b = v.getBoundingClientRect();
    return {
      src: (v.currentSrc || "").split("/").pop(),
      sourceW: v.videoWidth,
      paintedW: Math.round(b.width),
      devicePx: Math.round(b.width * devicePixelRatio),
      t: Number(v.currentTime.toFixed(2)),
    };
  }, at);
  if (!info) continue;

  const el = await bands[i].$("video");
  await el.screenshot({ path: `${out}/live-band-${i}.png` });
  console.log(`band ${i}: ${JSON.stringify(info)}`);
}
await browser.close();
