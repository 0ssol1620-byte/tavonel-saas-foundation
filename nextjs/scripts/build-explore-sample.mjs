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
 * `sec-corpus-manifest.json` is the acquisition record for the 2026 filings and is the only
 * place their §25.1 fields come from -- form, filing/report date, accession, CIK, primary
 * document, source URL, original sha256, render filename/sha256/profile, authority. This script
 * re-hashes the committed bytes and refuses to emit anything if a manifest digest and the file
 * on disk disagree.
 *
 * For a fast public demo each filing contributes a small, declared page slice rather than the
 * whole document. The slice and the reason for it are recorded per filing in
 * `lib/explore-sample.sources.json`; page numbers, page counts and bounding boxes are always
 * the real ones.
 *
 * Snapshots (blueprint §25.2) are a data list, `SNAPSHOTS` below. Two are compiled:
 *   W0 = 2025 10-K alone
 *   W4 = 2025 10-K + 2026 Q1 10-Q + 2026 DEF 14A + 2026 Q2 10-Q + 2026 Q3 10-Q
 * W1-W3 (the World after each individual filing arrived) are one line of data each and are
 * deliberately not compiled: each one costs another frozen digest to re-freeze and review by
 * hand on every corpus change, and the Change Act's story -- what the 2026 filings did to the
 * annual World -- is answered by the two endpoints.
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
 * The page slice each 2026 filing contributes, and why that slice.
 *
 * Written here rather than derived, because "which pages are worth compiling for a public demo"
 * is an editorial choice and should read as one. Everything downstream of it -- page numbers,
 * geometry, text -- is read out of the bytes.
 */
const SLICES = {
  "apple-2026-q1-10-q": {
    pages: [4, 17, 18],
    rationale: "Condensed consolidated statements of operations, Note 10 segment information, and the opening of Item 2 MD&A.",
  },
  "apple-2026-proxy-def14a": {
    pages: [16, 20, 51],
    rationale: "Role of the Board of Directors, the Board's privacy and data security oversight, and the Summary Compensation Table.",
  },
  "apple-2026-q2-10-q": {
    pages: [4, 18, 19],
    rationale: "Condensed consolidated statements of operations, Note 10 segment information, and the opening of Item 2 MD&A.",
  },
  "apple-2026-q3-10-q": {
    pages: [4, 20, 21],
    rationale: "Condensed consolidated statements of operations, Note 10 segment information, and the opening of Item 2 MD&A.",
  },
};

/** Reference renders are letter-sized print output, so their page count is the render's own. */
const RENDER_PAGE_COUNTS = {
  "apple-2026-q1-10-q": 30,
  "apple-2026-proxy-def14a": 103,
  "apple-2026-q2-10-q": 37,
  "apple-2026-q3-10-q": 40,
};

function fromManifest(id) {
  const filing = manifest.filings.find((entry) => entry.id === id);
  if (!filing) throw new Error(`explore_sample_manifest_missing_filing:${id}`);
  const slice = SLICES[id];
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
    expectedPageCount: RENDER_PAGE_COUNTS[id],
    selectedPages: slice.pages,
    sliceRationale: slice.rationale,
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
    /* Computed from the committed bytes in `buildInput`: this filing's source and its
       representation are the same file, so there is one digest and no render to declare. */
    originalSha256: null,
    representationFilename: "apple-2025-form-10-k.pdf",
    representationMediaType: "application/pdf",
    representationKind: "original",
    renderProfile: null,
    acquiredFrom: "Apple Investor Relations official PDF, cross-checkable in SEC EDGAR",
    expectedPageCount: 80,
    selectedPages: [4, 25, 32],
    sliceRationale: "Business overview, segment net sales, and the consolidated statements of operations.",
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
 * A list, so adding W1-W3 is a data change rather than a code change. Each added snapshot also
 * adds a frozen digest to re-derive and review by hand (§25.4), which is why only the two
 * endpoints are compiled today.
 */
export const SNAPSHOTS = [
  {
    id: "w0",
    label: "2025 Form 10-K",
    file: "explore-sample.w0.inputs.json",
    documentIds: ["apple-form-10-k"],
  },
  /* Not compiled -- one line each if the digest ritual is ever worth five worlds instead of two:
     { id: "w1", label: "+ 2026 Q1 10-Q",  documentIds: [...w0, "apple-2026-q1-10-q"] }
     { id: "w2", label: "+ 2026 DEF 14A",  documentIds: [...w1, "apple-2026-proxy-def14a"] }
     { id: "w3", label: "+ 2026 Q2 10-Q",  documentIds: [...w2, "apple-2026-q2-10-q"] } */
  {
    id: "w4",
    label: "2025 Form 10-K + four 2026 filings",
    file: "explore-sample.w4.inputs.json",
    documentIds: [
      "apple-form-10-k",
      "apple-2026-q1-10-q",
      "apple-2026-proxy-def14a",
      "apple-2026-q2-10-q",
      "apple-2026-q3-10-q",
    ],
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
  const extracted = await extractRegionsWithPageCount(stored, document.documentId, document.selectedPages);
  if (extracted.pageCount !== document.expectedPageCount) {
    throw new Error(`explore_sample_page_count_changed:${document.representationFilename}:${extracted.pageCount}`);
  }
  const regions = extracted.regions.map((region) => ({ ...region, authority: document.authority }));
  const key = `public/explore-sample/${document.representationFilename}`;

  const originalSha256 = document.representationKind === "original"
    ? `sha256:${digest}`
    : sha256Of(join(pdfDirectory, document.sourceFilename));
  if (document.originalSha256 !== null && document.originalSha256 !== originalSha256) {
    throw new Error(`explore_sample_original_digest_mismatch:${document.sourceFilename}`);
  }
  const manifestRender = manifest.filings.find((entry) => entry.id === document.documentId)?.renderSha256;
  if (manifestRender !== undefined && manifestRender !== `sha256:${digest}`) {
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
    selectedPages: document.selectedPages,
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
    writeFileSync(join(root, "lib", snapshot.file), `${JSON.stringify(inputs, null, 2)}\n`);
    console.log(`${snapshot.id}  ${inputs.length} documents  ${inputs.reduce((total, input) => total + input.regions.length, 0)} selected regions  -> lib/${snapshot.file}`);
  }
  for (const source of sources) {
    console.log(`  ${source.documentId}  ${source.representationKind}  pages ${source.selectedPages.join(",")} of ${source.pageCount}  ${source.regionCount} regions`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
