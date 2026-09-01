/**
 * Does a 2x capture of the film actually contain 2x detail?
 *
 * The canvas already renders at devicePixelRatio (capped at 2), so a 1440 CSS-px stage has a
 * 2880-px backing store. The open question is whether a screenshot at deviceScaleFactor 2
 * captures that backing store — if it does, the sharpness problem is solvable without touching
 * the locked composition, by capturing frames rather than recording CSS-pixel video.
 */
import { chromium } from "@playwright/test";

const base = process.argv[2] || "http://127.0.0.1:3057";
const out = "C:/Users/yspow/work/tavonel-saas-foundation/docs/audit";

for (const dsf of [1, 2]) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: dsf,
  });
  const page = await ctx.newPage();
  await page.goto(`${base}/film`, { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForSelector("canvas.film-canvas");
  await page.waitForTimeout(8000);

  const info = await page.evaluate(() => {
    const c = document.querySelector("canvas.film-canvas");
    return { backing: `${c.width}x${c.height}`, css: `${c.clientWidth}x${c.clientHeight}`, dpr: devicePixelRatio };
  });
  const path = `${out}/dsf-${dsf}.png`;
  await page.screenshot({ path });
  console.log(`dsf=${dsf}  dpr=${info.dpr}  canvas backing=${info.backing}  css=${info.css}  -> ${path}`);
  await browser.close();
}
