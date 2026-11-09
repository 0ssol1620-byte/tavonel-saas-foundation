// The four Home film stages (R3, 2026-11-09): route, viewport, fixture routes, the scripted actions at their film
// times (each step one action, then the camera on its result), and the strings the recorder probes for frame-strings.mjs.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { doc } from "./fixture.mjs";
const NEXT = fileURLToPath(new URL("../..", import.meta.url));
const INPUTS = JSON.parse(readFileSync(`${NEXT}/lib/explore-sample.w4.inputs.json`, "utf8"));
// The five filings of the published public sample (/explore), by their published file names and real sha256 version keys.
const FILINGS = [
  ["doc-k25", "apple-form-10-k", "apple-2025-form-10-k.pdf"],
  ["doc-p26", "apple-2026-proxy-def14a", "apple-2026-proxy-def14a-reference.pdf"],
  ["doc-q1", "apple-2026-q1-10-q", "apple-2026-q1-10-q-reference.pdf"],
  ["doc-q2", "apple-2026-q2-10-q", "apple-2026-q2-10-q-reference.pdf"],
  ["doc-q3", "apple-2026-q3-10-q", "apple-2026-q3-10-q-reference.pdf"],
].map(([id, sample, name]) => { const input = INPUTS.find(x => x.documentId === sample); if (!input) throw new Error(sample); return { id, name, input }; });
const READ_ID = "doc-q1";
const JOB_ID = `cjob-${"c".repeat(32)}`;
const frame = (sequence, st, ready) => ({ sequence, eventType: ready > 0 ? "progressed" : "state_changed", state: st, documentsTotal: 5, documentsReady: ready, errorCode: null });
const HISTORY = [frame(1, "reading", 0), frame(2, "reading", 1), frame(3, "reading", 2), frame(4, "reading", 3), frame(5, "reading", 4), frame(6, "reading", 5), frame(7, "structuring", 5), frame(8, "review_required", 5)];
const fileDoc = (f, reading) => {
  const d = doc(f.id, "a", reading ? "sanitized" : "ocr_ready", f.name);
  const v = f.input.versionKey;
  return { ...d, versionKey: v, sanitizedKey: `immutable/ws/${f.id}/${v}/sanitized.pdf`, ocrJsonKey: `immutable/ws/${f.id}/${v}/ocr.json`, cdrReceiptKey: `immutable/ws/${f.id}/${v}/cdr-receipt.json`, hasOcrJson: !reading };
};
function progressFor(f, pages) {
  const v = f.input.versionKey;
  const shown = f.input.regions.filter(r => r.pageNumber1 <= pages);
  return { schemaVersion: "tavonel.ocr_progress.v1", sourceImmutableKey: `immutable/ws/${f.id}/${v}/sanitized.pdf`, inputSha256: `sha256:${v}`, state: "reading",
    pagesRead: pages, pageCount: f.input.pageCount, regionsFound: shown.length,
    pages: Array.from({ length: pages }, (_, i) => i + 1).map(p => {
      const boxes = f.input.regions.filter(r => r.pageNumber1 === p).map(r => ({ bbox1000: r.bbox1000, confidence: r.confidence ?? 1, text: r.text, regionId: r.regionId }));
      return { pageNumber1: p, pageCount: f.input.pageCount, path: "", regionCount: boxes.length, meanConfidence: 1, boxes };
    }) };
}
// Stages 1 and 2: the workspace with the five sample filings, as a paying customer's fixture session (fixture.mjs).
const workspace = (reading, pages) => state => {
  state.reading = reading; state.pages = pages; state.released = 0;
  return { documents: () => [...FILINGS.filter(f => f.id === READ_ID), ...FILINGS.filter(f => f.id !== READ_ID)].map(f => fileDoc(f, state.reading && f.id === READ_ID)), names: Object.fromEntries(FILINGS.map(f => [f.id, f.name])) };
};
async function workspaceRoutes(page, state) {
  await page.route("**/api/compile-jobs", r => r.request().method() !== "POST"
    ? r.fulfill({ json: { code: "OK", jobs: [] } })
    : r.fulfill({ status: 202, json: { code: "COMPILE_JOB_ACCEPTED", jobId: JOB_ID, state: "preflight", documentsTotal: 5 } }));
  await page.route(`**/api/compile-jobs/${JOB_ID}/events**`, r => {
    const after = Number(new URL(r.request().url()).searchParams.get("after") ?? "0");
    const body = HISTORY.slice(0, state.released).filter(f => f.sequence > after).map(f => `id: ${f.sequence}\nevent: ${f.eventType}\ndata: ${JSON.stringify(f)}\n\n`).join("");
    return r.fulfill({ status: 200, contentType: "text/event-stream", headers: { "cache-control": "no-store" }, body });
  });
  await page.route("**/api/documents/*/progress", r => {
    const id = decodeURIComponent(new URL(r.request().url()).pathname.split("/")[3]);
    const f = FILINGS.find(x => x.id === id); const v = f.input.versionKey;
    return r.fulfill({ json: { documentId: id, versionKey: v, sourceImmutableKey: `immutable/ws/${id}/${v}/sanitized.pdf`, sourceSha256: `sha256:${v}`, readUrl: `${new URL(r.request().url()).origin}/__film/progress/${id}` } });
  });
  await page.route("**/api/documents/*/source**", r => {
    const id = decodeURIComponent(new URL(r.request().url()).pathname.split("/")[3]);
    const f = FILINGS.find(x => x.id === id);
    return r.fulfill({ status: 200, contentType: "application/pdf", body: readFileSync(`${NEXT}/${f.input.sanitizedKey}`) });
  });
  await page.route("**/__film/progress/*", r => {
    const id = new URL(r.request().url()).pathname.split("/").pop();
    return r.fulfill({ json: progressFor(FILINGS.find(x => x.id === id), state.pages) });
  });
}

// 1400 wide: the workspace column (x 280-1348) fits the 1080px camera with its own margin.
const WORKSPACE_VIEW = { width: 1400, height: 900 };
const MID = 814;
const OCR = 'section[aria-label="Selected source version and OCR observation"]';
const LINE = n => `${OCR} ol li:nth-child(${n + 1}) button`;
const BOARD = 'section[aria-label="Document processing"]';
const BOX = n => `${BOARD} input[type=checkbox] >> nth=${n}`;
const COMPILE = 'button:has-text("Compile selected documents")';
const RUN = "section.workspace-compile-job";
const NODE = (kind, label) => `button[data-node-kind="${kind}"]:has-text("${label}")`;
const QUESTION = text => `main button:has-text("${text}")`;
const PASSAGE = "text=Retrieved source passage";
const ROW = n => `main button:has-text("Page ") >> nth=${n}`;
const REGION = "[data-original-source] [data-original-region]";
// The page card's own header (its zoom and Highlight controls): the camera frames the page from it down.
const PAGE_HEAD = "text=Source page · reference render >> nth=-1";
// /explore's own site nav and its page headline (eyebrow + H1): hidden inside the recording only (review R2-MINOR-1).
const EXPLORE_CHROME = ['[class*="explore-stage_header"]', '[class*="evidence-workbench_intro"] > div:first-child'];

export const STAGES = {
  // Stage 1 -- Read: the 10-Q is read page by page in the live OCR view; an extracted line lights the page region it came from.
  1: {
    path: "/workspace/sources",
    viewport: WORKSPACE_VIEW,
    probe: ["Extracted lines", "apple-2026-q1-10-q-reference.pdf", "Live OCR view"],
    workspace: workspace(true, 1),
    routes: workspaceRoutes,
    ready: async page => {
      await page.waitForSelector(OCR, { timeout: 45000 });
      await page.evaluate(sel => { const el = document.querySelector(sel); window.scrollTo({ top: el.getBoundingClientRect().top + scrollY - 92, behavior: "instant" }); }, OCR);
    },
    // A fixed camera on the OCR view, past the sidebar: the page's figures column and the extracted lines meet at the
    // frame's centre, which is the phone's pane.
    cameraStart: [830, 420],
    cursorStart: [1180, 640],
    steps: [
      // 0-6 s: pages 2, 3 and 4 arrive; each shows beside the lines read from it.
      { at: 1.0, do: async a => { a.state.pages = 2; await a.wait(3800); } },
      { at: 2.6, do: async a => { a.state.pages = 3; await a.wait(3800); } },
      { at: 4.2, do: async a => { a.state.pages = 4; await a.wait(4000); } },
      // 6-12 s: one extracted line (Operating expenses) lights the region of the page it was read from.
      { at: 6.2, do: a => a.move(LINE(4), 1.2) },
      { at: 7.8, do: a => a.click(LINE(4)) },
      // 12-18 s: a second line (Earnings per share), its region lit in turn.
      { at: 12.0, do: a => a.move(LINE(6), 1.2) },
      { at: 13.6, do: a => a.click(LINE(6)) },
    ],
  },
  // Stage 2 -- Compile: the five read sources are compiled; the run reads all five and stops for a person's review.
  2: {
    path: "/workspace/sources",
    viewport: WORKSPACE_VIEW,
    probe: ["apple-2026-q3-10-q-reference.pdf", "Ready to compile", "Compile selected documents", "A review package is ready for a person to inspect."],
    workspace: workspace(false, 4),
    routes: workspaceRoutes,
    ready: async page => {
      await page.waitForSelector(BOARD, { timeout: 45000 });
      for (let n = 0; n < 5; n += 1) await page.locator(BOX(n)).check();
      await page.evaluate(sel => { const el = document.querySelector(sel); window.scrollTo({ top: el.getBoundingClientRect().top + scrollY - 150, behavior: "instant" }); }, BOARD);
    },
    cameraStart: [MID, 520],
    cursorStart: [900, 420],
    steps: [
      // 0-3 s: five sources ticked; the pointer goes to Compile.
      { at: 0.8, do: a => a.move(COMPILE, 1.6) },
      { at: 2.8, do: a => a.click(COMPILE, { settle: 1600 }) },
      // 3-15 s: the run appears above the five sources and reads them one by one, then structures them.
      { at: 3.4, do: a => a.scrollToEl(RUN, 214, 1.6) },
      // From here the run panel holds its place while the page changes above it.
      { at: 5.1, do: a => a.pin(RUN, 214) },
      { at: 5.4, do: a => a.move([1180, 470], 1.4) },
      ...[1, 2, 3, 4, 5, 6, 7].map((released, k) => ({ at: 5.2 + k * 1.3, do: async a => { a.state.released = released; await a.wait(1600); } })),
      // 15 s: the run stops at review -- nothing becomes active until a person inspects it.
      { at: 14.4, do: async a => { a.state.released = 8; await a.wait(2400); } },

    ],
  },
  // Stage 3 -- Update: four 2026 filings arrive after the annual World; the World after them, then one entity's relations.
  3: {
    path: "/explore?act=change",
    hide: EXPLORE_CHROME,
    probe: ["filed 2026-01-30", "Filings that arrived", "Greater China", "filed 2026-07-31"],
    ready: page => page.waitForSelector("text=FILINGS THAT ARRIVED", { timeout: 60000 }),
    // The camera opens on the annual World and the first filing that arrived (the left column), follows the pointer to
    // the right column, then centres on the World (x 960 of 1920, the content column's centre).
    cameraStart: { target: "text=2025 FORM 10-K", at: [840, 268] },
    cursorStart: [1300, 760],
    steps: [
      { at: 0.8, do: a => a.move("text=THE WORLD THE 4 FILINGS ARRIVED INTO", 1.2) },
      { at: 3.4, do: a => a.move("text=10-Q · FILED 2026-01-30", 1.4) },
      { at: 3.6, do: a => a.cameraY(1080, "text=2025 FORM 10-K", 1.6, 268) },
      // 7 s: the World after the filings arrived, the relations they brought drawn in the change colour.
      { at: 7.0, do: a => a.scrollToEl("[data-visual-node]", 150, 2.2) },
      { at: 7.0, do: a => a.cameraY(960, "[data-visual-node]", 2.2, 300) },
      { at: 10.4, do: a => a.move(NODE("Entity", "Greater China"), 1.4) },
      { at: 12.0, do: a => a.click(NODE("Entity", "Greater China"), { settle: 1400 }) },
      { at: 13.6, do: a => a.move([1560, 760], 1.6) },
    ],
  },
  // Stage 4 -- Trace: a prepared question answered by a passage, the page region it came from, and a second source page.
  4: {
    path: "/explore",
    hide: EXPLORE_CHROME,
    probe: ["net sales", "reference render", "Retrieved source passage"],
    ready: page => page.waitForSelector("text=Find a sample question", { timeout: 60000 }),
    cameraStart: [820, 520],
    cursorStart: [1000, 640],
    steps: [
      { at: 0.8, do: a => a.move(QUESTION("Products and Services net sales"), 1.4) },
      { at: 2.6, do: a => a.click(QUESTION("Products and Services net sales"), { settle: 1800 }) },
      { at: 3.2, do: a => a.camera(PASSAGE, 1.4, [240, 220]) },
      // 6 s: the page the passage was read from, its region marked.
      { at: 6.0, do: a => a.camera(PAGE_HEAD, 1.6, [0, 300]) },
      { at: 6.4, do: a => a.move(REGION, 1.4) },
      // 9.6-18 s: the passage's second source row opens its own page and region.
      { at: 9.6, do: a => a.camera(ROW(1), 1.4, [200, -80]) },
      { at: 9.8, do: a => a.move(ROW(1), 1.4) },
      { at: 11.6, do: a => a.click(ROW(1), { settle: 1800 }) },
      { at: 12.8, do: a => a.camera(PAGE_HEAD, 1.6, [0, 300]) },
      { at: 13.4, do: a => a.move(REGION, 1.4) },
    ],
  },
};
export { FILINGS, HISTORY };
