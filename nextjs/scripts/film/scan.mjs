/*
  Frame scans over the 450 source PNGs of each Home cut. Run after record.mjs, before encoding:
    node scripts/film/scan.mjs <frames-root>      (reads <frames-root>/hero-r2-c<n>/frames-2x/f0000.png ...; writes <frames-root>/scan.json)
  Exits 1 when any frame carries an edge band.

  blank (the cell rule of compile-stage-player.frame-strings.json): 24x24 source-px cells from the window origin; a cell
  holds ink when its luma range, sampled every 2px, is >= 48; a pane (or phone rect) is blank when >= 99% of its cells
  hold none.

  band (review R1 MAJOR-1): a frame captured while Chromium had not painted the area a scroll exposed carries a dark
  strip across the full width at the top or bottom edge. A frame has a band when any of its top or bottom 16 source-px
  rows has a mean luma < 60 (the design-C screens are light; their darkest full-width row is far above that).
  record.mjs runs the same check on every captured frame and retakes it, so a non-zero count here is a recorder bug.
*/
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const NEXT = fileURLToPath(new URL("../../", import.meta.url));
const nextRequire = createRequire(createRequire(`${NEXT}package.json`).resolve("next/package.json"));
export const sharp = nextRequire("sharp");

export const BAND_ROWS = 16, BAND_LUMA = 60;
/** Edge rows (of the top and bottom BAND_ROWS) whose full-width mean luma is under BAND_LUMA. */
export function edgeBand(luma, W, H) {
  const dark = y => { let s = 0; for (let x = 0; x < W; x += 1) s += luma[y * W + x]; return s / W < BAND_LUMA; };
  let top = 0, bottom = 0;
  for (let y = 0; y < BAND_ROWS; y += 1) { if (dark(y)) top += 1; if (dark(H - 1 - y)) bottom += 1; }
  return { top, bottom, band: top + bottom > 0 };
}
export async function greyscale(input) {
  const { data, info } = await sharp(input).greyscale().raw().toBuffer({ resolveWithObject: true });
  return { luma: data, W: info.width, H: info.height };
}

const BLANK_AT = 0.99, CELL = 24;
function blank(luma, W, x0, y0, w, h) {
  let cells = 0, empty = 0;
  for (let cy = y0; cy + CELL <= y0 + h; cy += CELL) for (let cx = x0; cx + CELL <= x0 + w; cx += CELL) {
    let lo = 255, hi = 0;
    for (let y = cy; y < cy + CELL; y += 2) for (let x = cx; x < cx + CELL; x += 2) { const v = luma[y * W + x]; if (v < lo) lo = v; if (v > hi) hi = v; }
    cells += 1; if (hi - lo < 48) empty += 1;
  }
  return empty / cells >= BLANK_AT;
}

// Crop windows and phone rects: STAGE_FRAMES in components/compile-stage-player.tsx.
const PLAN = {
  sources: { n: 1, crop: { x: 0.5, y: 0.2 }, phonePane: { x: 1780, y: 420, w: 684 } },
  read: { n: 2, crop: { x: 0.5, y: 0.25 }, phonePane: { x: 1900, y: 400, w: 684 } },
  structure: { n: 3, crop: { x: 0.5, y: 0.4 }, phonePane: { x: 120, y: 300, w: 684 } },
  world: { n: 4, crop: { x: 0, y: 0.1 }, phonePane: { x: 160, y: 300, w: 684 } },
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = process.argv[2];
  if (!root) throw new Error("usage: scan.mjs <frames-root>");
  const out = {};
  let bands = 0;
  for (const [id, p] of Object.entries(PLAN)) {
    let inkBoth = 0, phoneBlank = 0, lastBlankT = null;
    const bandFrames = [];
    for (let i = 0; i < 450; i += 1) {
      const { luma, W, H } = await greyscale(`${root}/hero-r2-c${p.n}/frames-2x/f${String(i).padStart(4, "0")}.png`);
      const x0 = Math.round(p.crop.x * 2880), y0 = Math.round(p.crop.y * 1800);
      const a = blank(luma, W, x0, y0, 720, 900), b = blank(luma, W, x0 + 720, y0, 720, 900);
      if (!a && !b) inkBoth += 1; else lastBlankT = i / 25;
      if (blank(luma, W, p.phonePane.x, p.phonePane.y, p.phonePane.w, Math.round(p.phonePane.w * 5 / 4))) phoneBlank += 1;
      if (edgeBand(luma, W, H).band) bandFrames.push(i);
    }
    bands += bandFrames.length;
    out[id] = { crop: p.crop, frames: 450, inkBoth, share: Number((inkBoth / 450).toFixed(3)), lastBlankT, phonePane: p.phonePane, phoneBlankFrames: phoneBlank, phoneShare: Number(((450 - phoneBlank) / 450).toFixed(3)), bandFrames };
    console.log(id, JSON.stringify(out[id]));
  }
  writeFileSync(`${root}/scan.json`, JSON.stringify(out, null, 1));
  console.log(`band frames: ${bands}/1800`);
  if (bands) process.exit(1);
}
