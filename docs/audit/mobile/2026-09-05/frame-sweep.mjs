/*
  Where does the compile frame stop being wide enough for the film that is drawn into it?

  The four live cuts compose a fixed 1440x900 stage in absolute pixels — 10px monospace labels,
  a four-column board whose columns are `(boardWidth - 3*gap) / 4` — and then size themselves to
  `canvas.clientWidth`. Nothing in them scales with the frame, so the only question that decides
  the fallback rule is how many CSS pixels each of those four columns actually gets at a given
  viewport. This sweep measures that, on the built site, and prints it.

      cd <worktree>/nextjs && node ../docs/audit/mobile/2026-09-05/frame-sweep.mjs
*/
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, "..", "..", "..", "..", "nextjs", "package.json"));
const { chromium } = require("@playwright/test");

const base = process.env.BASE ?? "http://127.0.0.1:3137";
const WIDTHS = [320, 360, 390, 412, 430, 480, 540, 600, 680, 720, 768, 820, 900, 1024, 1100, 1280, 1440];

const browser = await chromium.launch({ headless: true });
const rows = [];
for (const width of WIDTHS) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 2, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.locator("#s3").scrollIntoViewIfNeeded();
  await page.waitForTimeout(900);
  const m = await page.evaluate(() => {
    const frame = document.querySelector("#s3 .compile-film-viewport")?.getBoundingClientRect();
    return {
      frameW: Math.round(frame?.width ?? 0),
      frameH: Math.round(frame?.height ?? 0),
      coarse: window.matchMedia("(pointer: coarse)").matches,
    };
  });
  /*
    The board the four columns sit in, reproduced from the locked film's own arithmetic:
    `opening-film-3.tsx` insets the board and then takes `colW = (bw - gap * 3) / 4` with
    `bodyW = colW - 16` for the text. The absolute numbers below are the film's, not this
    script's; only `bw` changes with the frame.
  */
  const bw = m.frameW - 48;
  const colW = (bw - 18 * 3) / 4;
  rows.push({ width, frameW: m.frameW, frameH: m.frameH, ratio: Number((m.frameW / m.frameH).toFixed(3)), colW: Math.round(colW), bodyW: Math.round(colW - 16), scale: Number((m.frameW / 1440).toFixed(2)), coarse: m.coarse });
  await ctx.close();
}
await browser.close();
console.log("viewport frameW frameH ratio colW bodyW scaleVs1440");
for (const r of rows) console.log(`${String(r.width).padStart(7)} ${String(r.frameW).padStart(6)} ${String(r.frameH).padStart(6)} ${String(r.ratio).padStart(5)} ${String(r.colW).padStart(4)} ${String(r.bodyW).padStart(5)} ${r.scale}`);
