/*
  Home posters for the re-recorded cuts: one source frame per cut (the lossless PNG the cut was encoded from).
    node scripts/film/posters.mjs <frames-root>     (writes public/film/poster-r3-*; rows to <frames-root>/posters.json)
  D-11 encoders: AVIF quality 50, 4:4:4, effort 6 (each 2x AVIF <= 140,000 bytes); WebP quality 82, smartSubsample,
  effort 6; 1x = lanczos3. The stage-1 phone pane is an extract of the same PNG at STAGE_FRAMES.sources.phonePane (scan.mjs PLAN).
*/
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sharp, CUT, PLAN } from "./scan.mjs";
const root = process.argv[2];
if (!root) throw new Error("usage: posters.mjs <frames-root>");
const OUT = fileURLToPath(new URL("../../public/film/", import.meta.url));
// R3: each still is a step's result -- a line's region lit, the run stopped for review, an entity's relations, a passage's page region.
const PICK = [[1, 260], [2, 449], [3, 449], [4, 220]];
const { x: px, y: py, w: pw } = PLAN.sources.phonePane;
const PANE1 = { x: px, y: py, width: pw, height: pw * 5 / 4 };
const sha = b => createHash("sha256").update(b).digest("hex");
const rows = [];
for (const [n, frame] of PICK) {
  const src = readFileSync(`${root}/${CUT}-c${n}/frames-2x/f${String(frame).padStart(4, "0")}.png`);
  const t = (frame === 449 ? 17.96 : frame / 25).toFixed(2);
  const base = `poster-${CUT.slice(5)}-c${n}-t${t}`;
  const one = img => img.resize(1440, 900, { kernel: "lanczos3" });
  const webp = img => img.webp({ quality: 82, smartSubsample: true, effort: 6 });
  const avif = img => img.avif({ quality: 50, chromaSubsampling: "4:4:4", effort: 6 });
  const pane = () => sharp(src).extract({ left: PANE1.x, top: PANE1.y, width: PANE1.width, height: PANE1.height });
  const files = [
    [`${base}-2x.webp`, webp(sharp(src)), 2880, 1800], [`${base}.webp`, webp(one(sharp(src))), 1440, 900],
    [`${base}-2x.avif`, avif(sharp(src)), 2880, 1800], [`${base}.avif`, avif(one(sharp(src))), 1440, 900],
  ];
  const paneName = `${base}-pane1-${PANE1.width}x${PANE1.height}`;
  if (n === 1) files.push([`${paneName}.webp`, webp(pane()), PANE1.width, PANE1.height, PANE1], [`${paneName}.avif`, avif(pane()), PANE1.width, PANE1.height, PANE1]);
  for (const [file, pipe, width, height, crop] of files) {
    const buf = await pipe.toBuffer();
    const meta = await sharp(buf).metadata();
    if (meta.width !== width || meta.height !== height) throw new Error(`${file}: ${meta.width}x${meta.height}, expected ${width}x${height}`);
    if (file.endsWith("-2x.avif") && buf.length > 140_000) throw new Error(`${file}: ${buf.length} bytes > 140,000`);
    writeFileSync(`${OUT}${file}`, buf);
    rows.push({ file, width, height, bytes: buf.length, sha256: sha(buf), cut: `${CUT}-c${n}.mp4`, frameSeconds: Number(t), frameIndex: frame, framePngSha256: sha(src), ...(crop ? { cropRect: { x: crop.x, y: crop.y, width: crop.width, height: crop.height } } : {}) });
    console.log(file, buf.length);
  }
}
writeFileSync(`${root}/posters.json`, JSON.stringify(rows, null, 1));
