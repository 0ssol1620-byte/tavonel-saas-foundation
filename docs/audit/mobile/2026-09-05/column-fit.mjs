/*
  The number the fallback breakpoint is derived from.

  Every cut composes a fixed stage: `opening-film-3.tsx` lays a four-column board across
  `bw = clientWidth * 0.97` with `colW = (bw - 30) / 4`, and draws each pane's header as a
  left-aligned title at `x + 10` and a right-aligned live label at `x + w - 8`, both in
  `500 10px ui-monospace`. None of that scales with the frame. So a column stops working the
  moment `title + live` no longer fits inside `colW`, and the founder's screenshot
  ("PaymentTerms PaymentTerms" over "NODES MARKDOWN ONTOLOGY WORLD") is that collision.

  This measures the real advance widths of the strings the film actually draws, in the browser
  that draws them, and reports the frame width — and therefore the viewport — at which the
  header stops colliding. Titles and labels are copied from the locked film; the film is not
  modified or imported.

      cd <worktree>/nextjs && node ../docs/audit/mobile/2026-09-05/column-fit.mjs
*/
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, "..", "..", "..", "..", "nextjs", "package.json"));
const { chromium } = require("@playwright/test");

const base = process.env.BASE ?? "http://127.0.0.1:3137";

/** pane(title, live) pairs, in the order cut 3 draws them, across all four DELTAS entries. */
const HEADERS = [
  ["SOURCES", "MSA_v4.pdf"], ["SOURCES", "ops-manual-r9.pdf"], ["SOURCES", "scan_0140.jpg"], ["SOURCES", "handbook-2026.pdf"],
  ["MARKDOWN", "PaymentTerms"], ["MARKDOWN", "PurchaseOrder"], ["MARKDOWN", "WarehouseB"], ["MARKDOWN", "NoticePeriod"],
  ["ONTOLOGY", "PaymentTerms"], ["ONTOLOGY", "PurchaseOrder"], ["ONTOLOGY", "WarehouseB"], ["ONTOLOGY", "NoticePeriod"],
  ["WORLD", "trace"],
];

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
// Load the site so the film's own webfont stack is present in the document that measures it.
await page.goto(`${base}/`, { waitUntil: "networkidle", timeout: 60_000 });

const measured = await page.evaluate((headers) => {
  const c = document.createElement("canvas").getContext("2d");
  c.font = "500 10px ui-monospace, Menlo, monospace";
  return headers.map(([title, live]) => ({
    title, live,
    titleW: Number(c.measureText(title).width.toFixed(1)),
    liveW: Number(c.measureText(live).width.toFixed(1)),
  }));
}, HEADERS);

/*
  `colW` must hold: 10px left inset + title + a legible separation + live + 8px right inset.
  6px is one monospace advance at this size — the narrowest gap at which two runs of 10px mono
  still read as two labels rather than one word.
*/
const SEP = 6;
const needs = measured.map((m) => ({ ...m, colW: Math.ceil(10 + m.titleW + SEP + m.liveW + 8) }));
const worst = needs.reduce((a, b) => (b.colW > a.colW ? b : a));
// colW = (frameW * 0.97 - 30) / 4  =>  frameW = (4 * colW + 30) / 0.97
const frameW = Math.ceil((4 * worst.colW + 30) / 0.97);

console.log("title/live pairs, 500 10px ui-monospace:");
for (const n of needs) console.log(`  ${n.title.padEnd(9)} ${n.live.padEnd(18)} title=${String(n.titleW).padStart(5)} live=${String(n.liveW).padStart(5)} needs colW>=${n.colW}`);
console.log(`\nworst pair: ${worst.title} / ${worst.live} -> colW >= ${worst.colW}px -> frame width >= ${frameW}px`);
console.log("frame widths measured on this build (frame-sweep.mjs): 320vp=280, 390vp=350, 412vp=372, 430vp=390, 768vp=707, 900vp=828, 1024vp=866, 1280vp=1203, 1440vp=1354");
await browser.close();
