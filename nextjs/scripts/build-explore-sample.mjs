/**
 * Build the public /explore sample from Apple's public SEC filings.
 *
 * The committed bytes under `public/explore-sample/` are the proof chain and are never
 * rewritten here. Two kinds of byte sit in that directory and they are not the same thing:
 *
 *   - the 2025 Form 10-K is an official PDF, so the bytes the compiler reads ARE the source;
 *   - the four 2026 filings are HTML primary documents from SEC EDGAR (`sec-source/*.html`),
 *     and the committed PDF beside each one is a deterministic *reference render* of it. The
 *     render is a representation. It is never "the original SEC PDF", and both digests are
 *     carried separately so a reader can tell which is which.
 *
 * `sec-corpus-manifest.json` is the acquisition record for all five filings and is the only
 * place their §25.1 fields come from -- form, filing/report date, accession, CIK, primary
 * document, source URL, original sha256, render filename/sha256/profile, page count, authority.
 * This script re-hashes the committed bytes and refuses to emit anything if a manifest digest or
 * page count and the file on disk disagree. The 2025 10-K's record carries `renderFilename: null`
 * because it has no render: its acquired bytes are the bytes the compiler reads.
 *
 * Every filing is compiled in full. No page slice is declared anywhere: `declaredPages` is null
 * for all five documents and `compiledPages` -- the pages that actually produced a region -- is
 * measured per filing. Page numbers, page counts and bounding boxes are always the real ones.
 *
 * The corpus, measured here on 2026-09-08 (program §24 directs all five filings, ~290 pages):
 *
 *   | snapshot | docs | pages | with text | regions | candidates | emitted | package B  |
 *   |----------|-----:|------:|----------:|--------:|-----------:|--------:|-----------:|
 *   | W0       |    1 |    80 |        80 |     502 |      2,310 |   2,310 |  4,649,873 |
 *   | W1       |    2 |   110 |       110 |     671 |      2,679 |   2,679 |  5,786,326 |
 *   | W2       |    3 |   213 |       213 |     908 |      5,406 |   5,406 | 11,157,220 |
 *   | W3       |    4 |   250 |       249 |   1,095 |      5,859 |   5,859 | 12,613,858 |
 *   | W4       |    5 |   290 |       287 |   1,281 |      6,300 |   6,300 | 14,046,999 |
 *
 * Every snapshot is `lifecycle: candidate` with candidates considered equal to candidates
 * emitted -- nothing dropped to fit. 287 of the 290 pages carry a text layer; the three that do
 * not produce no region and are not published as compiled.
 *
 * Two constants decide whether this fits: `EXTRACTION_CANDIDATE_BUDGET`
 * (`lib/collection-compiler.ts`, now 7,000) and `MAX_UNCOMPRESSED_BYTES`
 * (`lib/collection-download.ts`, now 24 MiB). Both were re-derived from the measurement above
 * rather than raised to make a build pass, and each derivation is written out above the
 * constant. W4's package is 13.40 MiB against a 24 MiB ceiling.
 *
 * Snapshots (blueprint §25.2) are a data list, `SNAPSHOTS` below. All five are compiled:
 *   W0 = 2025 10-K alone
 *   W1 = W0 + 2026 Q1 10-Q
 *   W2 = W1 + 2026 DEF 14A
 *   W3 = W2 + 2026 Q2 10-Q
 *   W4 = W3 + 2026 Q3 10-Q
 * Every snapshot costs a frozen digest to re-derive and review by hand on every corpus change
 * (§25.4). That is the price of the Change Act showing the five steps §24 asks for rather than
 * only its two endpoints.
 *
 * The 2024 Form 10-K stays committed in `public/explore-sample/` as the earlier annual filing,
 * but it is no longer compiled into any World: the temporal story is now the 2026 filings
 * arriving, not two unrelated annual Worlds compared.
 *
 * Regenerate compiler inputs with:
 *   node scripts/build-explore-sample.mjs
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const pdfDirectory = join(root, "public", "explore-sample");
const sourcesPath = join(root, "lib", "explore-sample.sources.json");

const manifest = JSON.parse(readFileSync(join(pdfDirectory, "sec-corpus-manifest.json"), "utf8"));

/**
 * Every filing is compiled whole, so there is no slice table any more.
 *
 * This string is still carried per document because `lib/explore-sample.sources.json` publishes
 * it and the source sheet prints it: a reader gets told the scope of the compile rather than
 * having to infer it from two page counts agreeing.
 */
const WHOLE_DOCUMENT = "Every page of the filing.";

function manifestEntry(id) {
  const filing = manifest.filings.find((entry) => entry.id === id);
  if (!filing) throw new Error(`explore_sample_manifest_missing_filing:${id}`);
  return filing;
}

function fromManifest(id) {
  const filing = manifestEntry(id);
  return {
    documentId: filing.id,
    form: filing.form,
    filingDate: filing.filingDate,
    reportDate: filing.reportDate,
    accession: filing.accession,
    cik: filing.cik,
    primaryDocument: filing.primaryDocument,
    authority: filing.authority,
    sourceUrl: filing.sourceUrl,
    sourceFilename: filing.sourceFilename,
    sourceMediaType: filing.sourceMediaType,
    originalSha256: filing.originalSha256,
    /* The bytes the compiler reads. For a 2026 filing that is the reference render, not the source. */
    representationFilename: filing.renderFilename,
    representationMediaType: filing.renderMediaType,
    representationKind: "reference_render",
    renderProfile: filing.renderProfile,
    acquiredFrom: filing.acquiredFrom,
    /* The render's own page count, from the acquisition record, re-checked against the file. */
    expectedPageCount: filing.pageCount,
    /* null = every page. The compiled page list is measured in `buildInput`, never assumed. */
    declaredPages: null,
    sliceRationale: WHOLE_DOCUMENT,
    sourceLabel: `Apple Inc. · ${filing.form} filed ${filing.filingDate} · SEC filing`,
    secUrl: filing.sourceUrl,
    officialUrl: null,
  };
}

/**
 * Public source catalog. The accession and URLs are identifiers for the source, not compiler
 * evidence. Evidence remains bound to the committed bytes and extracted page geometry.
 */
export const SOURCE_DOCUMENTS = [
  {
    documentId: "apple-form-10-k",
    form: "10-K",
    filingDate: "2025-10-31",
    reportDate: "2025-09-27",
    accession: "0000320193-25-000079",
    cik: "0000320193",
    primaryDocument: "aapl-20250927.htm",
    authority: "official",
    sourceUrl: "https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm",
    sourceFilename: "apple-2025-form-10-k.pdf",
    sourceMediaType: "application/pdf",
    /* This filing's source and its representation are the same file, so there is one digest and
       no render to declare. `buildInput` re-hashes the committed bytes and throws if they and
       the acquisition record disagree, which is why the record is read rather than left null. */
    originalSha256: manifestEntry("apple-form-10-k").originalSha256,
    representationFilename: "apple-2025-form-10-k.pdf",
    representationMediaType: "application/pdf",
    representationKind: "original",
    renderProfile: null,
    acquiredFrom: manifestEntry("apple-form-10-k").acquiredFrom,
    expectedPageCount: manifestEntry("apple-form-10-k").pageCount,
    declaredPages: null,
    sliceRationale: WHOLE_DOCUMENT,
    sourceLabel: "Apple Inc. · 2025 Form 10-K · public SEC filing",
    officialUrl: "https://d18rn0p25nwr6d.cloudfront.net/CIK-0000320193/c24e7a28-5254-4dfa-9447-62aaa3c24bb1.pdf",
    secUrl: "https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm",
  },
  fromManifest("apple-2026-q1-10-q"),
  fromManifest("apple-2026-proxy-def14a"),
  fromManifest("apple-2026-q2-10-q"),
  fromManifest("apple-2026-q3-10-q"),
];

/**
 * Committed but not compiled.
 *
 * Apple's 2024 Form 10-K is still in the repository -- deleting an acquired source would break
 * the proof chain -- and is deliberately absent from every snapshot below.
 */
export const UNCOMPILED_FILES = ["apple-2024-form-10-k.pdf"];

/**
 * The World snapshots this build emits, §25.2.
 *
 * A list, so the corpus's shape is a data change rather than a code change. Every snapshot
 * carries a frozen digest that has to be re-derived and reviewed by hand on every corpus change
 * (§25.4) -- five of them now, because §24 asks for the World after each filing arrived and a
 * step that is not compiled cannot be shown.
 */
const W0 = ["apple-form-10-k"];
const W1 = [...W0, "apple-2026-q1-10-q"];
const W2 = [...W1, "apple-2026-proxy-def14a"];
const W3 = [...W2, "apple-2026-q2-10-q"];
const W4 = [...W3, "apple-2026-q3-10-q"];

export const SNAPSHOTS = [
  { id: "w0", label: "2025 Form 10-K", file: "explore-sample.w0.inputs.json", documentIds: W0 },
  { id: "w1", label: "+ 2026 Q1 10-Q", file: "explore-sample.w1.inputs.json", documentIds: W1 },
  { id: "w2", label: "+ 2026 DEF 14A", file: "explore-sample.w2.inputs.json", documentIds: W2 },
  { id: "w3", label: "+ 2026 Q2 10-Q", file: "explore-sample.w3.inputs.json", documentIds: W3 },
  {
    id: "w4",
    label: "2025 Form 10-K + four 2026 filings",
    file: "explore-sample.w4.inputs.json",
    documentIds: W4,
  },
];

function ensurePromiseWithResolvers() {
  if (typeof Promise.withResolvers === "function") return;
  Promise.withResolvers = function withResolvers() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };
}

/**
 * Read real text-layer geometry from selected pages of the official filing.
 * `selectedPages` is 1-based and only reduces demo scope; the returned page numbers remain the
 * original filing's page numbers and `pageCount` is always the full PDF page count.
 * @param {Buffer | Uint8Array} bytes
 * @param {string} documentId
 * @param {number[] | null} [selectedPages=null]
 */
export async function extractRegionsWithPageCount(bytes, documentId, selectedPages = null) {
  ensurePromiseWithResolvers();
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
  const pdf = await task.promise;
  const pageNumbers = selectedPages ?? Array.from({ length: pdf.numPages }, (_, index) => index + 1);
  const regions = [];
  let order = 0;

  for (const pageNumber of pageNumbers) {
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pdf.numPages) {
      throw new Error(`explore_sample_page_out_of_range:${pageNumber}/${pdf.numPages}`);
    }
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const raw = content.items
      .filter((item) => typeof item.str === "string" && item.str.trim().length > 0)
      .map((item) => ({
        text: item.str.replace(/\s+/g, " ").trim(),
        left: item.transform[4],
        right: item.transform[4] + Math.max(item.width ?? 0, 1),
        baseline: item.transform[5],
        height: Math.max(item.height ?? 0, 1),
      }));

    // Merge runs that sit on the same baseline into a readable line first. SEC tables often emit
    // one run per cell; paragraphs often emit one run per line.
    const sorted = raw.sort((a, b) => b.baseline - a.baseline || a.left - b.left);
    const lines = [];
    for (const item of sorted) {
      const line = lines.find((candidate) => Math.abs(candidate.baseline - item.baseline) <= 2.5);
      if (line) line.items.push(item);
      else lines.push({ baseline: item.baseline, items: [item] });
    }
    const normalizedLines = lines
      .map((line) => {
        const items = line.items.sort((a, b) => a.left - b.left);
        return {
          text: items.map((item) => item.text).join(" ").replace(/\s+/g, " ").trim(),
          left: Math.min(...items.map((item) => item.left)),
          right: Math.max(...items.map((item) => item.right)),
          baseline: line.baseline,
          height: Math.max(...items.map((item) => item.height)),
        };
      })
      .filter((line) => line.text.length > 0)
      .sort((a, b) => b.baseline - a.baseline);

    // Paragraph groups are separated by a noticeably larger vertical gap. Keep tables readable
    // by allowing dense rows to remain one evidence region; the exact bbox still comes from PDF.
    let group = [];
    const flush = () => {
      if (group.length === 0) return;
      const text = group.map((line) => line.text).join(" ").replace(/\s+/g, " ").trim();
      if (text.length === 0) { group = []; return; }
      const left = Math.min(...group.map((line) => line.left));
      const right = Math.max(...group.map((line) => line.right));
      const top = Math.max(...group.map((line) => line.baseline + line.height));
      const bottom = Math.min(...group.map((line) => line.baseline));
      const scale = (value, extent) => Math.max(0, Math.min(1000, Math.round((value / extent) * 1000)));
      regions.push({
        regionId: `${documentId}-p${pageNumber}-r${order}`,
        pageIndex0: pageNumber - 1,
        pageNumber1: pageNumber,
        order,
        blockType: "paragraph",
        text,
        bbox1000: [
          scale(left, viewport.width),
          scale(viewport.height - top, viewport.height),
          scale(right, viewport.width),
          scale(viewport.height - bottom, viewport.height),
        ],
        confidence: 1,
        authority: null,
      });
      order += 1;
      group = [];
    };

    for (const line of normalizedLines) {
      const previous = group[group.length - 1];
      if (previous && previous.baseline - line.baseline > Math.max(previous.height, line.height) * 2.2 + 3) flush();
      group.push(line);
    }
    flush();
    page.cleanup();
  }

  await task.destroy();
  return { regions, pageCount: pdf.numPages };
}

/**
 * @param {Buffer | Uint8Array} bytes
 * @param {string} documentId
 * @param {number[] | null} [selectedPages=null]
 */
export async function extractRegions(bytes, documentId, selectedPages = null) {
  return (await extractRegionsWithPageCount(bytes, documentId, selectedPages)).regions;
}

function sha256Of(path) {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

/**
 * One compiler input, plus the source record that says where its bytes came from.
 *
 * The compiler input can only address one file -- `validateCollectionOcrInput` requires
 * `sourceImmutableKey === sanitizedKey` -- so it names the bytes the geometry was actually read
 * from, which for a 2026 filing is the reference render. The original/representation pair lives
 * in the source record beside it, both digests re-hashed here from the committed files and
 * checked against the acquisition manifest.
 */
async function buildInput(document) {
  const representationPath = join(pdfDirectory, document.representationFilename);
  const stored = readFileSync(representationPath);
  const digest = createHash("sha256").update(stored).digest("hex");
  const extracted = await extractRegionsWithPageCount(stored, document.documentId, document.declaredPages);
  if (extracted.pageCount !== document.expectedPageCount) {
    throw new Error(`explore_sample_page_count_changed:${document.representationFilename}:${extracted.pageCount}`);
  }
  const regions = extracted.regions.map((region) => ({ ...region, authority: document.authority }));
  const compiledPages = [...new Set(regions.map((region) => region.pageNumber1))].sort((a, b) => a - b);
  const key = `public/explore-sample/${document.representationFilename}`;

  const originalSha256 = document.representationKind === "original"
    ? `sha256:${digest}`
    : sha256Of(join(pdfDirectory, document.sourceFilename));
  if (document.originalSha256 !== null && document.originalSha256 !== originalSha256) {
    throw new Error(`explore_sample_original_digest_mismatch:${document.sourceFilename}`);
  }
  /* Null for a filing with no render -- the 2025 10-K, whose acquired bytes are what was read. */
  const manifestRender = manifestEntry(document.documentId).renderSha256;
  if (manifestRender !== null && manifestRender !== `sha256:${digest}`) {
    throw new Error(`explore_sample_render_digest_mismatch:${document.representationFilename}`);
  }

  const input = {
    documentId: document.documentId,
    versionKey: digest,
    sanitizedKey: key,
    ocrJsonKey: `public/explore-sample/${document.documentId}/${digest}/text-layer-public-slice.json`,
    pageCount: extracted.pageCount,
    text: regions.map((region) => region.text).join("\n").trim(),
    inputSha256: `sha256:${digest}`,
    sourceImmutableKey: key,
    regions,
  };

  const source = {
    documentId: document.documentId,
    form: document.form,
    filingDate: document.filingDate,
    reportDate: document.reportDate,
    accession: document.accession,
    cik: document.cik,
    primaryDocument: document.primaryDocument,
    authority: document.authority,
    sourceUrl: document.sourceUrl,
    sourceFilename: document.sourceFilename,
    sourceMediaType: document.sourceMediaType,
    originalSha256,
    representationFilename: document.representationFilename,
    representationMediaType: document.representationMediaType,
    representationKind: document.representationKind,
    representationSha256: `sha256:${digest}`,
    renderProfile: document.renderProfile,
    acquiredFrom: document.acquiredFrom,
    pageCount: extracted.pageCount,
    /*
      Three page numbers, and they answer three different questions.

      `declaredPages` is the editorial/engine decision -- null when the whole document is
      compiled. `compiledPages` is what the extractor actually read a region out of, which is
      smaller than the declared set whenever a page carries no text layer. `pageCount` is the
      document's own length. Reporting only the first would let a blank page be published as
      compiled; reporting only the last would hide the slice.
    */
    declaredPages: document.declaredPages,
    compiledPages,
    sliceRationale: document.sliceRationale,
    regionCount: regions.length,
    sourceLabel: document.sourceLabel,
    officialUrl: document.officialUrl,
    secUrl: document.secUrl,
  };

  return { input, source };
}

async function main() {
  const built = new Map();
  const sources = [];
  for (const document of SOURCE_DOCUMENTS) {
    const { input, source } = await buildInput(document);
    built.set(document.documentId, input);
    sources.push(source);
  }
  writeFileSync(sourcesPath, `${JSON.stringify(sources, null, 2)}\n`);
  for (const snapshot of SNAPSHOTS) {
    const inputs = snapshot.documentIds.map((documentId) => {
      const input = built.get(documentId);
      if (!input) throw new Error(`explore_sample_snapshot_unknown_document:${snapshot.id}:${documentId}`);
      return input;
    });
    const regions = inputs.reduce((total, input) => total + input.regions.length, 0);
    if (!snapshot.file) {
      console.log(`${snapshot.id}  ${inputs.length} documents  ${regions} regions  -> declared, not compiled`);
      continue;
    }
    writeFileSync(join(root, "lib", snapshot.file), `${JSON.stringify(inputs, null, 2)}\n`);
    console.log(`${snapshot.id}  ${inputs.length} documents  ${regions} compiled regions  -> lib/${snapshot.file}`);
  }
  for (const source of sources) {
    const scope = source.declaredPages === null
      ? "every page"
      : `declared pages ${source.declaredPages.length}`;
    console.log(`  ${source.documentId}  ${source.representationKind}  ${scope}  ${source.compiledPages.length} of ${source.pageCount} pages compiled  ${source.regionCount} regions`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
