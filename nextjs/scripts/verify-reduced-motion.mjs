/**
 * What a `prefers-reduced-motion` visitor actually sees.
 *
 * This branch had no coverage at all, which is how cuts 2-4 shipped rendering
 * `<img src={undefined}>` — a broken-image icon and an alt string where the film should be. A
 * screenshot alone would not have caught it either, so this asserts the decoded state of every
 * image: `naturalWidth === 0` is exactly what a browser reports for a broken one.
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

const report = await page.evaluate(() => {
  const imgs = [...document.querySelectorAll(".film-band img")];
  const vids = [...document.querySelectorAll(".film-band video")];
  return {
    videos: vids.length,
    images: imgs.map((i) => ({
      src: (i.getAttribute("src") || "(none)").split("/").pop(),
      alt: i.getAttribute("alt"),
      broken: i.naturalWidth === 0,
      w: Math.round(i.getBoundingClientRect().width),
      h: Math.round(i.getBoundingClientRect().height),
    })),
  };
});

console.log(JSON.stringify(report, null, 1));
const broken = report.images.filter((i) => i.broken);
console.log(broken.length === 0 ? "OK: no broken posters" : `FAIL: ${broken.length} broken`);
await page.screenshot({ path: `${dest}/home-reduced-motion.png`, fullPage: false });
await browser.close();
