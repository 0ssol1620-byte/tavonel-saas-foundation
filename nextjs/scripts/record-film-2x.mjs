/**
 * Record a cut at 2x, by capturing frames instead of recording video.
 *
 *   usage: node scripts/record-film-2x.mjs <route> <capture-dir>
 *   e.g.   node scripts/record-film-2x.mjs /film film-capture
 *
 * Why frames rather than `recordVideo`:
 *
 * The films look soft on any HiDPI display. Measured, a band painted 1230 CSS px wide is 2460
 * device pixels, so a 1440-wide master is upscaled 1.7x and the small mono type smears — which
 * is why it looks fine on one monitor and mushy on another.
 *
 * The canvas already draws at devicePixelRatio (capped at 2), so a 1440 CSS-px stage has a
 * 2880-px backing store; the detail exists, it was being thrown away on the way out.
 * `recordVideo` records in CSS pixels and ignores deviceScaleFactor, and raising the viewport to
 * 2880 instead breaks the locked composition — the cuts size type in fixed pixels, so a wider
 * stage means the same 12px text on twice the canvas (the SOURCES list repeated three times to
 * fill its column). Screenshots at deviceScaleFactor 2 keep the 1440 CSS layout and return the
 * 2880 backing store, which is exactly what is wanted.
 *
 * Frames are taken against the cut's own published clock, so timing does not drift with the cost
 * of each capture.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const route = process.argv[2] || "/film";
const dirName = process.argv[3] || "film-capture";
const BASE = process.env.FILM_BASE || "http://127.0.0.1:3057";
const FPS = 25;
const RUN = 18;

const frameDir = `C:/Users/yspow/work/tavonel-saas-foundation/docs/audit/${dirName}/frames-2x`;
rmSync(frameDir, { recursive: true, force: true });
mkdirSync(frameDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  // The composed stage stays 1440x900; only the pixel density rises.
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  reducedMotion: "no-preference",
});
const page = await context.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
await page.goto(`${BASE}${route}`, { waitUntil: "networkidle", timeout: 90_000 });
await page.waitForSelector("canvas.film-canvas");
await page.waitForFunction(() => {
  const c = document.querySelector("canvas.film-canvas");
  return c instanceof HTMLCanvasElement && c.width >= 2000;
}, { timeout: 20_000 });

const backing = await page.evaluate(() => {
  const c = document.querySelector("canvas.film-canvas");
  return `${c.width}x${c.height}`;
});
console.log(`canvas backing store: ${backing}`);

/*
  Drive the clock rather than following it.

  Capturing in real time would take 18 seconds of wall clock and every screenshot would land
  wherever the film happened to be. Freezing the loop and stepping it one frame at a time gives
  an exact, reproducible 25fps sequence — and lets a slow capture take as long as it needs.
*/
await page.evaluate(() => { window.__filmFreeze = true; });

const total = FPS * RUN;
for (let i = 0; i < total; i += 1) {
  const t = i / FPS;
  await page.evaluate((time) => { window.__filmSeek?.(time); }, t);
  await page.screenshot({ path: join(frameDir, `f${String(i).padStart(4, "0")}.png`) });
}

console.log(`frames: ${readdirSync(frameDir).length} in ${frameDir}`);
await context.close();
await browser.close();
