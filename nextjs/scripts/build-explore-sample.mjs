/**
 * Builds the /explore sample from documents that actually exist.
 *
 * What this replaces: the Explore page used to be four object literals and a `SOURCE` constant
 * carrying `sha256:3e118d4e...bf1c` and `bbox [118, 214, 886, 374]` for a file named
 * `FP-200-maintenance-manual-revC.pdf` that was not in the repository. Nothing on that page was
 * false about the product, and every provenance value on it was invented -- which is the one
 * thing this codebase says never to do to satisfy a schema.
 *
 * So the sample gets real documents. This script writes three fixture PDFs, reads their text
 * layer back with pdfjs to get the page geometry, and emits the compiler's input contract with
 * a real sha256 per file and a real bounding box per paragraph. The compile itself is not done
 * here: `lib/explore-sample.ts` runs the production `compileCollectionCandidate` over this
 * output, so the page renders what the compiler produced rather than what a script decided it
 * should look like.
 *
 * Deterministic on purpose. No creation date, no document ID, no timestamp anywhere in the
 * emitted PDF, so re-running this produces byte-identical files and `explore-sample.test.ts`
 * can prove the committed inputs still match the committed PDFs.
 *
 *   node scripts/build-explore-sample.mjs
 *
 * The fixture is a maintenance corpus rather than anything of TAVONEL's own. An earlier sample
 * compiled our retention policy, and a first-time visitor read "source material is retained for
 * 30 days" as a commitment in product chrome. A pump nobody owns cannot be mistaken for one.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const pdfDirectory = join(root, "public", "explore-sample");
const inputsPath = join(root, "lib", "explore-sample.inputs.json");

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN_LEFT = 66;
const TOP_BASELINE = 762;
const TITLE_SIZE = 13;
const BODY_SIZE = 10.5;
const LINE_HEIGHT = 15;
const PARAGRAPH_GAP = 26;
const WRAP_COLUMNS = 78;

/*
  The corpus. Three documents that disagree with each other on purpose: the manual states an
  interval, the change notice is why it changed, and the log is the work that was done. That
  disagreement is what a Compiled World is for, and it is the reason the sample has three files
  rather than one.
*/
export const DOCUMENTS = [
  {
    documentId: "fp200-maintenance-manual-rev-c",
    filename: "fp-200-maintenance-manual-revC.pdf",
    authority: "official",
    paragraphs: [
      "Scheduled maintenance for feedwater pump FP-200, revision C.",
      "Perform the full service procedure every 2,000 operating hours. This interval replaces the 1,500 hour interval published in revision B.",
      "Before replacing the mechanical seal, isolate the unit and fully depressurise the casing. Confirm zero pressure at gauge PG-11 before removing any fastener.",
      "The pump is rated for continuous duty at 2.4 MPa discharge pressure, and inspection points are listed in table 12.1.",
    ],
  },
  {
    documentId: "fp200-change-notice-cn-2026-03",
    filename: "fp-200-change-notice-CN-2026-03.pdf",
    authority: "official",
    paragraphs: [
      "Change notice CN-2026-03 for feedwater pump FP-200, revision C.",
      "The service interval moves from 1,500 operating hours to 2,000 operating hours with effect from revision C.",
      "Revision B is superseded and must not be used to schedule work on this pump.",
    ],
  },
  {
    documentId: "fp200-service-log-2026",
    filename: "fp-200-service-log-2026.pdf",
    authority: "informal",
    paragraphs: [
      "Service log for feedwater pump FP-200, January to March 2026.",
      "The mechanical seal on FP-200 was replaced on 14 February 2026 after the unit was depressurised.",
      "The next full service falls due at 2,000 operating hours from the February visit.",
    ],
  },
];

/** PDF literal strings escape exactly three characters. */
function escapeText(value) {
  return value.replace(/([\\()])/g, "\\$1");
}

/** Character-count wrapping. Crude, deterministic, and the geometry is read back from pdfjs anyway. */
function wrap(text, columns) {
  const lines = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line.length === 0) line = word;
    else if (line.length + 1 + word.length <= columns) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line.length > 0) lines.push(line);
  return lines;
}

export function renderPdf(document) {
  const commands = [];
  let baseline = TOP_BASELINE;
  document.paragraphs.forEach((paragraph, index) => {
    const size = index === 0 ? TITLE_SIZE : BODY_SIZE;
    for (const line of wrap(paragraph, index === 0 ? 54 : WRAP_COLUMNS)) {
      commands.push(`BT /F1 ${size} Tf ${MARGIN_LEFT} ${baseline} Td (${escapeText(line)}) Tj ET`);
      baseline -= LINE_HEIGHT;
    }
    baseline -= PARAGRAPH_GAP - LINE_HEIGHT;
  });
  const content = `${commands.join("\n")}\n`;

  const objects = [
    "<</Type /Catalog /Pages 2 0 R>>",
    "<</Type /Pages /Kids [3 0 R] /Count 1>>",
    `<</Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources <</Font <</F1 4 0 R>>>> /Contents 5 0 R>>`,
    "<</Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding>>",
    `<</Length ${Buffer.byteLength(content, "latin1")}>>\nstream\n${content}endstream`,
  ];

  let body = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const startxref = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<</Size ${objects.length + 1} /Root 1 0 R>>\nstartxref\n${startxref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

/**
 * Reads the geometry back out of the file that was just written.
 *
 * Deriving the boxes from the layout variables above would be faster and would prove nothing:
 * it would report where the script intended to put the text. This reads where the text is.
 */
export async function extractRegions(bytes, documentId) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
  const pdf = await task.promise;
  const regions = [];
  let order = 0;
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const lines = content.items
      .filter((item) => typeof item.str === "string" && item.str.trim().length > 0)
      .map((item) => ({
        text: item.str,
        left: item.transform[4],
        right: item.transform[4] + item.width,
        baseline: item.transform[5],
        height: item.height,
      }))
      .sort((left, right) => right.baseline - left.baseline);

    let group = [];
    const flush = () => {
      if (group.length === 0) return;
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
        text: group.map((line) => line.text).join(" "),
        // PDF measures up from the bottom of the page; a bounding box measures down from the top.
        bbox1000: [
          scale(left, viewport.width),
          scale(viewport.height - top, viewport.height),
          scale(right, viewport.width),
          scale(viewport.height - bottom, viewport.height),
        ],
        /*
          Not a recognition score. This text was read from the file's own text layer rather than
          recognised from pixels, so there is no estimate to report and reporting one below 1
          would be inventing uncertainty that does not exist. A scanned page compiled through
          the GPU reader carries the reader's confidence instead.
        */
        confidence: 1,
        authority: null,
      });
      order += 1;
      group = [];
    };

    for (const line of lines) {
      const previous = group[group.length - 1];
      if (previous && previous.baseline - line.baseline > LINE_HEIGHT + 4) flush();
      group.push(line);
    }
    flush();
    page.cleanup();
  }
  await task.destroy();
  return regions;
}

async function main() {
  mkdirSync(pdfDirectory, { recursive: true });
  const inputs = [];

  for (const document of DOCUMENTS) {
    const bytes = renderPdf(document);
    const path = join(pdfDirectory, document.filename);
    writeFileSync(path, bytes);

    const stored = readFileSync(path);
    const digest = createHash("sha256").update(stored).digest("hex");
    const regions = (await extractRegions(stored, document.documentId)).map((region) => ({
      ...region,
      authority: document.authority,
    }));
    const key = `public/explore-sample/${document.filename}`;

    inputs.push({
      documentId: document.documentId,
      versionKey: digest,
      sanitizedKey: key,
      ocrJsonKey: `public/explore-sample/${document.documentId}/${digest}/text-layer.json`,
      pageCount: 1,
      text: regions.map((region) => region.text).join("\n").trim(),
      inputSha256: `sha256:${digest}`,
      sourceImmutableKey: key,
      regions,
    });
    console.log(`${document.filename}  ${stored.length} bytes  sha256:${digest.slice(0, 16)}…  ${regions.length} regions`);
  }

  writeFileSync(inputsPath, `${JSON.stringify(inputs, null, 2)}\n`);
  console.log(`wrote ${inputsPath}`);
}

/*
  Only when run as a script.

  `lib/explore-sample.test.ts` imports `renderPdf` and `extractRegions` from here to prove the
  committed PDFs and the committed inputs are still what this file produces. Importing must not
  rewrite them, or the test would be checking its own side effect.
*/
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
