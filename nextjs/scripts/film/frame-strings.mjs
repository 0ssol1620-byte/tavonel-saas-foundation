/*
  Regenerates components/compile-stage-player.frame-strings.json from a recording run:
    node scripts/film/frame-strings.mjs <frames-root>
  reads <frames-root>/hero-r3-c<n>/frames-2x.probe.json (record.mjs) and <frames-root>/scan.json (scan.mjs), and the
  committed cuts for their sha256. The reading targets and panes are STAGE_FRAMES in components/compile-stage-player.tsx.
*/
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { STAGES } from "./stages.mjs";
import { CUT } from "./scan.mjs";
const root = process.argv[2];
if (!root) throw new Error("usage: frame-strings.mjs <frames-root>");
const NEXT = fileURLToPath(new URL("../../", import.meta.url));
const scan = JSON.parse(readFileSync(`${root}/scan.json`, "utf8"));
const times = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18];
const PLAN = { sources: { n: 1 }, read: { n: 2 }, structure: { n: 3 }, world: { n: 4 } };
const PANES = ["Q1 (x 0-719)", "Q2 (x 720-1439)", "Q3 (x 1440-2159)", "Q4 (x 2160-2879)"];
const stages = {}, crop = {}, blank = {}, phone = {};
for (const [id, p] of Object.entries(PLAN)) {
  const probe = JSON.parse(readFileSync(`${root}/${CUT}-c${p.n}/frames-2x.probe.json`, "utf8"));
  const [text, ...also] = STAGES[p.n].probe;
  const cut = `${CUT}-c${p.n}.mp4`;
  const strings = {};
  for (const s of [text, ...also]) {
    const visibleAt = times.filter(t => (probe[String(t)][s] ?? []).length > 0);
    const panes = [...new Set(times.flatMap(t => (probe[String(t)][s] ?? []).map(b => Math.min(3, Math.floor(b.x / 720)))))];
    // R3: the pane is where the string first shows (its quarter column), measured, not set by hand.
    strings[s] = { pane: PANES[panes[0] ?? 0], visibleAt };
  }
  stages[id] = { cut, sha256: createHash("sha256").update(readFileSync(`${NEXT}public/film/${cut}`)).digest("hex"), strings };
  const rows = times.map(t => probe[String(t)][text] ?? []);
  const first = rows.find(r => r.length)[0];
  const s = scan[id];
  const y0 = Math.round(s.crop.y * 1800), h = first.h;
  const yAt = Object.fromEntries(times.map((t, i) => [String(t), rows[i].filter(b => Math.floor(b.x / 720) >= s.crop.x * 4 && Math.floor(b.x / 720) <= s.crop.x * 4 + 1).map(b => b.y)]));
  const inside = times.filter(t => yAt[String(t)].some(y => y >= y0 && y + h <= y0 + 900)).length;
  const holds = inside / times.length >= 0.8;
  crop[id] = { text, box: { x: first.x, w: first.w, h }, yAt, insideWindow: inside, holdsTarget: holds,
    smallestXHeight: { px: 15, text: "12px CSS product type (Wanted Sans / Plex Mono), drawn at 32 source px (camera 1080 CSS px at 8/3); x-height 0.46-0.52 of the em. Embedded page renders (the PDF pages and reference renders on screen) are excluded: their type is the filing's own, at the page's scale", at: "every frame: the recording is a 1080x675 CSS camera on the product UI at deviceScaleFactor 8/3", window: `crop x ${s.crop.x}, y ${s.crop.y}` } };
  blank[id] = { crop: s.crop, frames: s.frames, inkBoth: s.inkBoth, share: s.share, lastBlankT: s.lastBlankT, defaultView: s.share >= 0.85 && holds ? "crop" : "fit" };
  phone[id] = { phonePane: s.phonePane, frames: s.frames, blankFrames: s.phoneBlankFrames, share: s.phoneShare };
}
const RECEIPT = "scripts/film/ (record.mjs probes, scan.mjs scans); run report: outputs/tavonel-research-replan-20261013/market-20261104/landing-film-r3-20261109/ (ai-knowledge-compiler)";
const table = {
  derivedFrom: `Film re-record R3 (2026-11-09, camera on the action; after review R2). Recorder, DOM probes and scans: ${RECEIPT}.`,
  method: "The cuts are recordings of the real product UI, so strings are read from the DOM, not transcribed: the recorder itself (record.mjs, the 2x capture run) records, at each sampled second, every visible occurrence of each of the stage's probe strings (Range.getBoundingClientRect, x2 for source px). t=18 is frame 449 (17.96 s). pane = the quarter column of the 2880x1800 frame (the cuts have no drawn panes).",
  times,
  stages,
  cropCheck: {
    method: "Re-record: yAt = the top edge (source px) of each probed occurrence inside the crop window's columns at each sampled second; insideWindow = sampled seconds where one occurrence lies wholly inside rows crop.y*1800 .. +900. A recording scrolls, so the window is held to the same 80% rule as visibleAt: holdsTarget = insideWindow / samples >= 0.8. A stage whose window does not hold its target opens on Fit. smallestXHeight: product UI type in the recordings is >= 12px CSS, i.e. 32 source px (x-height >= 15) through the R3 camera (1080 CSS px at 8/3); embedded page renders (the PDF pages and reference renders shown inside the product) are excluded and carry smaller type. At 1440 the film is drawn 1240px wide, so 12px UI type shows at about 13.8px.",
    stages: crop,
  },
  blankScan: {
    method: "Re-record: the Release 3 cell rule over the stage's whole 2x crop window (columns crop.x .. crop.x + 0.5 split into its two panes, rows crop.y .. crop.y + 0.5), on all 450 source PNG frames of each cut (2880x1800, the frames the cut was encoded from). 24x24 source-px cells from the window origin; a cell holds ink when its luma range (sampled every 2px) is >= 48; a pane is blank when >= blankAt of its cells hold none. share = frames with neither pane blank / frames. defaultView crop only when share >= threshold and the window holds the reading target (cropCheck.holdsTarget).",
    receipt: RECEIPT,
    blankAt: 0.99,
    threshold: 0.85,
    stages: blank,
  },
  phonePaneScan: {
    method: "Re-record: the blankScan cell rule over one w x w*5/4 source-px rect at the stage's phonePane, on all 450 source frames; a frame is blank when >= blankAt of the rect's cells hold none. share = frames not blank / frames; a phonePane is used only when share >= threshold. All four rects are 848 px wide, so 12px CSS product type (32 source px) draws at 32 x pane width / 848: >= 12px for a pane >= 318px wide (measured per width in the R3 QA receipts).",
    receipt: RECEIPT,
    blankAt: 0.99,
    threshold: 0.85,
    rect: "per stage: phonePane.w x phonePane.w * 5 / 4 source px (4:5)",
    stages: phone,
  },
  edgeBandScan: {
    method: "Review R1 MAJOR-1: a frame has an edge band when any of its top or bottom 16 source-px rows has a full-width mean luma < 60 (scan.mjs edgeBand; record.mjs retakes such a capture). bandFrames = frames of the 450 with a band.",
    receipt: RECEIPT,
    stages: Object.fromEntries(Object.keys(PLAN).map(id => [id, { frames: scan[id].frames, bandFrames: scan[id].bandFrames.length }])),
  },
};
writeFileSync(`${NEXT}components/compile-stage-player.frame-strings.json`, JSON.stringify(table, null, 2) + "\n");
for (const id of Object.keys(PLAN)) console.log(id, "visible", stages[id].strings[STAGES[PLAN[id].n].probe[0]].visibleAt.length, "inside", crop[id].insideWindow, "default", blank[id].defaultView, "phone", phone[id].share);
