import { chromium } from "@playwright/test";
import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = "http://127.0.0.1:3056";
const CUT = 18_000;
const PATH = "/film-4";
const outDir = "C:/Users/yspow/work/tavonel-saas-foundation/docs/audit/film4-capture";
const frameDir = "C:/Users/yspow/work/tavonel-saas-foundation/docs/audit/film4-frames";
mkdirSync(outDir, { recursive: true });
mkdirSync(frameDir, { recursive: true });
for (const name of readdirSync(outDir)) {
  if (name.endsWith(".webm")) unlinkSync(join(outDir, name));
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: outDir, size: { width: 1440, height: 900 } },
  reducedMotion: "no-preference",
});
const recStart = Date.now();
const page = await context.newPage();
page.on("pageerror", (err) => console.log("PAGEERROR", err.message));
page.on("console", (msg) => { if (msg.type() === "error") console.log("CONSOLE", msg.text()); });
await page.goto(`${BASE}${PATH}`, { waitUntil: "networkidle", timeout: 60_000 });
await page.waitForSelector("canvas.film-canvas");
await page.waitForFunction(() => {
  const c = document.querySelector("canvas.film-canvas");
  return c instanceof HTMLCanvasElement && c.width > 800;
}, { timeout: 20_000 });
// The cut loops from mount and has no controls, so recording starts once the canvas is laid out.
await page.waitForTimeout(180);
const filmStart = Date.now();
writeFileSync(join(outDir, "offset-ms.txt"), String(filmStart - recStart));

/*
  One still per beat.

  The stills are taken against the page's own clock, not against wall time accumulated across
  screenshots. Each `page.screenshot()` costs a few hundred milliseconds, and summing those
  errors pushed the last frame past the 18s loop point — the "final beat" still came back
  showing a freshly reset cut with one line on screen. Waiting on the elapsed time the canvas
  itself reports removes the drift.
*/
const beats = [
  [2.6, "t03-attach"],
  [6.0, "t06-grounded"],
  [11.0, "t11-code"],
  [14.5, "t14-abstain"],
  [17.4, "t17-keep"],
];
// The cut publishes its own elapsed time; each beat waits for that value rather than for
// accumulated wall time, which drifts by the cost of every screenshot taken before it.
for (const [seconds, name] of beats) {
  await page.waitForFunction(
    (target) => (window.__filmElapsed ?? 0) >= target,
    seconds,
    { timeout: 30_000, polling: 40 },
  );
  await page.screenshot({ path: `${frameDir}/${name}.png` });
}
await page.waitForTimeout(Math.max(0, CUT - (Date.now() - filmStart)));
await context.close();
await browser.close();
console.log("videos", readdirSync(outDir).filter((f) => f.endsWith(".webm")));
console.log("offset-ms", filmStart - recStart);
