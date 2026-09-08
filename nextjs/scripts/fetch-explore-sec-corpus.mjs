#!/usr/bin/env node
/**
 * Reproducibly acquire the public Apple SEC documents used by /explore.
 *
 * The SEC HTML bytes are the ORIGINAL representation and are retained byte-for-byte under
 * public/explore-sample/sec-source/. For the page/bbox demo we create a separate REFERENCE_RENDER
 * PDF from those committed bytes. The render is never described as the original filing.
 *
 * This script is an explicit maintainer action; production builds never fetch the network.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const publicDir = join(root, "public", "explore-sample");
const sourceDir = join(publicDir, "sec-source");
const manifestPath = join(publicDir, "sec-corpus-manifest.json");
const SEC_UA = process.env.SEC_USER_AGENT || "TAVONEL public demo source acquisition tavonel.com/contact";

const filings = [
  {
    id: "apple-2026-q1-10-q",
    form: "10-Q",
    filingDate: "2026-01-30",
    reportDate: "2025-12-27",
    accession: "0000320193-26-000006",
    primaryDocument: "aapl-20251227.htm",
  },
  {
    id: "apple-2026-proxy-def14a",
    form: "DEF 14A",
    filingDate: "2026-01-08",
    reportDate: "2026-02-24",
    accession: "0001308179-26-000008",
    primaryDocument: "aapl014016-def14a.htm",
  },
  {
    id: "apple-2026-q2-10-q",
    form: "10-Q",
    filingDate: "2026-05-01",
    reportDate: "2026-03-28",
    accession: "0000320193-26-000013",
    primaryDocument: "aapl-20260328.htm",
  },
  {
    id: "apple-2026-q3-10-q",
    form: "10-Q",
    filingDate: "2026-07-31",
    reportDate: "2026-06-27",
    accession: "0000320193-26-000020",
    primaryDocument: "aapl-20260627.htm",
  },
];

/**
 * The 2025 Form 10-K, which this script does not fetch.
 *
 * It came from Apple's investor-relations site as an official PDF, so it has no EDGAR HTML
 * original and no reference render -- the acquired bytes are the bytes the compiler reads, and
 * the four `render*` fields are null rather than a copy of the source digest under a name that
 * would imply a representation exists. It is written into the manifest anyway because
 * `build-explore-sample.mjs` reads every filing's §25.1 record from there, and a corpus record
 * missing one of its five filings is a record that has to be maintained in two places.
 */
const NOT_FETCHED_2025_10_K = {
  id: "apple-form-10-k",
  form: "10-K",
  filingDate: "2025-10-31",
  reportDate: "2025-09-27",
  accession: "0000320193-25-000079",
  primaryDocument: "aapl-20250927.htm",
  cik: "0000320193",
  authority: "official",
  sourceUrl: "https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm",
  sourceFilename: "apple-2025-form-10-k.pdf",
  sourceMediaType: "application/pdf",
  originalSha256: "sha256:108590052c3ba5400c63660d787fe7ed4e43868292946d7a7facebe9ab7d1aab",
  renderFilename: null,
  renderMediaType: null,
  renderSha256: null,
  renderProfile: null,
  pageCount: 80,
  acquiredFrom: "Apple Investor Relations official PDF, cross-checkable in SEC EDGAR",
};

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Read back from the file just written, so the recorded length is the render's, not the DOM's. */
async function pageCountOf(bytes) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
  const pdf = await task.promise;
  const { numPages } = pdf;
  await task.destroy();
  return numPages;
}
function accessionPath(accession) {
  return accession.replaceAll("-", "");
}
function secUrl(filing) {
  return `https://www.sec.gov/Archives/edgar/data/320193/${accessionPath(filing.accession)}/${filing.primaryDocument}`;
}
function normalizedForRender(html) {
  // Keep the filing content and its inline styles, but remove executable/network-only material.
  // This is a derived representation, so the ORIGINAL digest is always recorded separately.
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<link\b[^>]*>/gi, "")
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, "")
    .replace(/<img\b[^>]*>/gi, "")
    .replace(/<meta\s+http-equiv=["']Content-Security-Policy["'][^>]*>/gi, "");
}

await mkdir(sourceDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const records = [];
try {
  for (const filing of filings) {
    const url = secUrl(filing);
    const response = await fetch(url, {
      headers: { "user-agent": SEC_UA, accept: "text/html,application/xhtml+xml" },
    });
    if (!response.ok) throw new Error(`SEC fetch failed ${response.status}: ${url}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const originalSha256 = digest(bytes);
    const sourceFilename = `${filing.id}.html`;
    const sourcePath = join(sourceDir, sourceFilename);
    await writeFile(sourcePath, bytes);

    const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
    const normalized = normalizedForRender(bytes.toString("utf8"));
    await page.setContent(normalized, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.emulateMedia({ media: "print" });
    const renderFilename = `${filing.id}-reference.pdf`;
    const renderPath = join(publicDir, renderFilename);
    await page.pdf({
      path: renderPath,
      format: "Letter",
      printBackground: true,
      displayHeaderFooter: false,
      margin: { top: "0.45in", right: "0.45in", bottom: "0.45in", left: "0.45in" },
      preferCSSPageSize: false,
    });
    await page.close();
    const renderBytes = await readFile(renderPath);
    records.push({
      ...filing,
      cik: "0000320193",
      authority: "official",
      sourceUrl: url,
      sourceFilename: `sec-source/${sourceFilename}`,
      sourceMediaType: "text/html",
      originalSha256: `sha256:${originalSha256}`,
      renderFilename,
      renderMediaType: "application/pdf",
      renderSha256: `sha256:${digest(renderBytes)}`,
      renderProfile: "chromium-print-letter-v1; scripts/links/iframes/images removed; inline filing content retained",
      pageCount: await pageCountOf(renderBytes),
      acquiredFrom: "SEC EDGAR primary document",
    });
  }
} finally {
  await browser.close();
}

await writeFile(
  manifestPath,
  `${JSON.stringify(
    {
      schemaVersion: "tavonel.public_sec_corpus.v1",
      generatedAt: new Date().toISOString(),
      filings: [NOT_FETCHED_2025_10_K, ...records],
    },
    null,
    2,
  )}\n`,
);
for (const record of records) {
  console.log(`${record.form} ${record.filingDate} ${record.accession} ${record.originalSha256.slice(0, 24)}… -> ${record.renderFilename}`);
}
