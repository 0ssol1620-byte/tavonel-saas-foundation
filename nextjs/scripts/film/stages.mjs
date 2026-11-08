// The four Home film stages: route, fixture routes, the scripted actions at their film times, and the strings the
// recorder probes for frame-strings.mjs.
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

const OCR = 'section[aria-label="Selected source version and OCR observation"]';
const LINE = n => `${OCR} ol li:nth-child(${n + 1}) button`;
const BOX = n => `main.one-path-workspace input[type=checkbox] >> nth=${n}`;
const COMPILE = 'button:has-text("Compile selected documents")';
const NODE = (kind, n) => `button[data-node-kind="${kind}"] >> nth=${n}`;
const QUESTION = n => `main button:has-text("?") >> nth=${n}`;
const OPEN_EVIDENCE = 'button:has-text("Open source evidence")';
const OPEN_SOURCE = 'button:has-text("Open the source region")';
export const STAGES = {
  1: {
    path: "/workspace/sources",
    probe: ["Extracted lines", "apple-2026-q1-10-q-reference.pdf", "Live OCR view"],
    workspace: state => {
      state.reading = true; state.pages = 1; state.released = 1;
      return { documents: () => [...FILINGS.filter(f => f.id === READ_ID), ...FILINGS.filter(f => f.id !== READ_ID)].map(f => fileDoc(f, state.reading && f.id === READ_ID)), names: Object.fromEntries(FILINGS.map(f => [f.id, f.name])) };
    },
    routes: async (page, state) => {
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
    },
    ready: page => page.waitForSelector('section[aria-label="Selected source version and OCR observation"]', { timeout: 45000 }),
    steps: [
      // 0-7 s: the 10-Q is read page by page; the live view shows each page beside the lines read from it.
      { at: 1.0, do: a => a.scrollToEl(OCR, 84, 1.8) },
      { at: 2.2, do: async a => { a.state.pages = 2; await a.wait(3800); } },
      { at: 3.8, do: async a => { a.state.pages = 3; await a.wait(3800); } },
      { at: 5.4, do: async a => { a.state.pages = 4; await a.wait(4000); } },
      // 7-15 s: three extracted lines, each lighting the region of the page it was read from.
      { at: 7.0, do: a => a.move(LINE(3), 1.0) },
      { at: 8.2, do: a => a.click(LINE(3)) },
      { at: 9.6, do: a => a.move(LINE(4), 0.7) },
      { at: 10.5, do: a => a.click(LINE(4)) },
      { at: 11.9, do: a => a.move(LINE(5), 0.7) },
      { at: 12.8, do: a => a.click(LINE(5)) },
      // 15 s: the reading finishes and the immutable OCR record is ready.
      { at: 15.0, do: async a => { a.state.reading = false; await a.wait(3200); } },
      { at: 15.2, do: a => a.move([1260, 760], 1.2) },
    ],
  },
  // Stage 2 -- the World the five filings compile into (the published sample): document -> entity, one object at a time.
  2: {
    path: "/explore?act=world",
    probe: ["Greater China", "Services", "filed 2026-01-30"],
    ready: page => page.waitForSelector("button[data-node-id]", { timeout: 60000 }),
    cursorStart: [760, 560],
    steps: [
      { at: 1.2, do: a => a.move(NODE("Entity", 4), 1.4) },
      { at: 2.8, do: a => a.click(NODE("Entity", 4), { settle: 1400 }) },
      { at: 4.6, do: a => a.scroll(300, 1.6) },
      { at: 7.4, do: a => a.scroll(0, 1.3) },
      { at: 8.8, do: a => a.move(NODE("Document", 2), 1.3) },
      { at: 10.3, do: a => a.click(NODE("Document", 2), { settle: 1400 }) },
      { at: 12.6, do: a => a.move(NODE("Entity", 1), 1.2) },
      { at: 14.0, do: a => a.click(NODE("Entity", 1), { settle: 1400 }) },
      { at: 15.6, do: a => a.move([1300, 560], 1.2) },
    ],
  },
  // Stage 3 -- the change view: the annual World, and what four 2026 filings brought into it.
  3: {
    path: "/explore?act=change",
    probe: ["filed 2026-07-31", "Filings that arrived", "Open the reference render"],
    ready: page => page.waitForSelector("text=FILINGS THAT ARRIVED", { timeout: 60000 }),
    cursorStart: [900, 640],
    steps: [
      { at: 1.0, do: a => a.move([400, 236], 1.0) },
      { at: 3.0, do: a => a.move([380, 430], 1.2) },
      { at: 3.4, do: a => a.scroll(240, 2.0) },
      { at: 6.4, do: a => a.move([1040, 480], 1.2) },
      { at: 8.6, do: a => a.scroll(540, 2.4) },
      { at: 11.6, do: a => a.move([1040, 470], 1.0) },
      // 12.8 s: the World after the filings arrived, the relations they brought in drawn in the change colour.
      { at: 12.8, do: a => a.scroll(1130, 2.4) },
      { at: 15.4, do: a => a.move([700, 520], 1.4) },
    ],
  },
  // Stage 4 -- the same knowledge, asked: a prepared question answered by a passage and the page region it came from.
  4: {
    path: "/explore",
    probe: ["Retrieved source passage", "reference render"],
    ready: page => page.waitForSelector("text=Find a sample question", { timeout: 60000 }),
    cursorStart: [900, 700],
    steps: [
      { at: 1.0, do: a => a.scrollToEl("text=Retrieved source passage", 90, 1.8) },
      { at: 3.4, do: a => a.move([420, 380], 1.2) },
      { at: 5.0, do: a => a.move([1040, 600], 1.4) },
      { at: 7.4, do: a => a.scroll(0, 1.3) },
      { at: 8.0, do: a => a.move(QUESTION(1), 1.2) },
      { at: 9.4, do: a => a.click(QUESTION(1), { settle: 1800 }) },
      { at: 10.4, do: a => a.scrollToEl("text=Retrieved source passage", 90, 1.8) },
      { at: 12.8, do: a => a.move([1040, 560], 1.4) },
      { at: 15.0, do: a => a.move([430, 700], 1.4) },
    ],
  },
};
export { FILINGS, HISTORY };
