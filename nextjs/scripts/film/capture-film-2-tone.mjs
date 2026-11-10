/*
  Capture opening-film-2 in a tone/variant, frame by frame from its own clock (window.__filmSeek),
  reading the canvas backing store (no page chrome, no dev overlay).

    node scripts/film/capture-film-2-tone.mjs <base-url+path?query> <out-dir> <width> <height> [fps] [seconds]

  e.g. http://127.0.0.1:3057/film-lab?tone=light  work/a-wide 1440 900
  The canvas draws at devicePixelRatio 2, so a 1440x900 stage gives 2880x1800 frames.
*/
import { createRequire } from "node:module";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const require = createRequire(resolve("package.json"));
const { chromium } = require("@playwright/test");
const [url, outDir, w, h, fpsArg, secArg] = process.argv.slice(2);
const FPS = Number(fpsArg ?? 25);
const RUN = Number(secArg ?? 18);
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: 2, reducedMotion: "no-preference" });
const page = await context.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
await page.goto(url, { waitUntil: "networkidle", timeout: 180_000 });
await page.waitForFunction(() => typeof window.__filmSeek === "function", null, { timeout: 60_000 });
await page.evaluate(() => document.fonts.ready);
await page.evaluate(() => { window.__filmFreeze = true; });
for (let i = 0; i < FPS * RUN; i += 1) {
  const data = await page.evaluate((t) => {
    window.__filmSeek(t);
    return document.querySelector("canvas.film-canvas").toDataURL("image/png");
  }, i / FPS);
  writeFileSync(join(outDir, `f${String(i).padStart(4, "0")}.png`), Buffer.from(data.slice(data.indexOf(",") + 1), "base64"));
}
await browser.close();
console.log(`${FPS * RUN} frames -> ${outDir}`);
