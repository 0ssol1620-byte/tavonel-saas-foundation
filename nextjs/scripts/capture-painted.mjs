/**
 * Capture a band as the browser actually paints it.
 *
 * Frame stills prove the master is sharp; they say nothing about what the page does with it.
 * Cut 1 is painted 898px wide and cuts 2-4 are painted 1245px, so the lower bands are scaled
 * differently — and on a HiDPI screen the scale factor, not the file, decides how the type
 * reads. This screenshots each band in place at deviceScaleFactor 2.
 */
import { chromium } from "@playwright/test";

const url = process.argv[2] || "http://127.0.0.1:3057/";
const out = "C:/Users/yspow/work/tavonel-saas-foundation/docs/audit";

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
await page.waitForTimeout(6000);

const bands = await page.$$(".film-band");
for (let i = 0; i < bands.length; i += 1) {
  // Centre the band so it is the one playing, then let it reach a busy moment.
  await bands[i].scrollIntoViewIfNeeded();
  await page.waitForTimeout(7000);
  const box = await bands[i].boundingBox();
  await bands[i].screenshot({ path: `${out}/painted-band-${i}.png` });
  const src = await bands[i].evaluate((el) => {
    const v = el.querySelector("video");
    return { src: (v?.currentSrc || "").split("/").pop(), w: Math.round(v?.getBoundingClientRect().width ?? 0), vw: v?.videoWidth };
  });
  console.log(`band ${i}: ${src.src}  source=${src.vw}px  painted=${src.w}px  shot=${Math.round(box.width * 2)}px`);
}
await browser.close();
