/**
 * Raster the source pages the public proof block paints first.
 *
 * Why this exists: the proof block used to fetch a 1 MB PDF on every marketing route to paint one
 * page, and its failure state was a blank frame. The committed rasters here are the first paint.
 * The live PDF.js reader stays exactly where it was -- it SHA-256-checks the committed bytes
 * before painting, which a picture cannot -- and takes over as the verified overlay once it is
 * ready. Nothing here is generated imagery: every pixel is a render of a committed source PDF.
 *
 * Output is deterministic. No timestamps, no run ids, sorted keys, and the manifest carries the
 * sha256 of both the source PDF and every emitted file, so a raster that stopped matching its
 * source is detectable rather than plausible.
 *
 * PAGES below is the render set: the page each shipped proof pick resolves to, plus the /explore
 * entry proof's page. It is a list rather than a query because this script is plain Node and the
 * selection lives in TypeScript. `lib/source-page-rasters.test.ts` fails when a pick resolves to a
 * page that is not in the manifest, so the list cannot drift silently -- and a missing raster
 * degrades to the live reader alone rather than to a broken page.
 *
 * Requires @napi-rs/canvas, which ships transitively with pdfjs-dist. It is a regeneration tool,
 * not a build step: the .webp files and the manifest are committed.
 *
 *   node scripts/render-source-pages.mjs
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const sampleDir = join(root, "public", "explore-sample");
const outDir = join(sampleDir, "pages");

/** Full-page render width in CSS pixels. Region crops are cut from a 2x render of the same page. */
const PAGE_WIDTH = 1400;
const REGION_SCALE = 2;
const QUALITY = 82;

/**
 * file -> the pages a shipped proof pick, the /explore entry proof, or a Change-act arrival card
 * opens.
 */
const PAGES = [
  { file: "apple-2025-form-10-k.pdf", pages: [4] },
  { file: "apple-2026-q1-10-q-reference.pdf", pages: [4, 19] },
  { file: "apple-2026-q2-10-q-reference.pdf", pages: [4] },
  { file: "apple-2026-q3-10-q-reference.pdf", pages: [4] },
  { file: "apple-2026-proxy-def14a-reference.pdf", pages: [11, 17, 48] },
];

/** The regions those picks highlight, in per-mille page coordinates as the compiler emitted them. */
const REGIONS = [
  { file: "apple-2025-form-10-k.pdf", page: 4, bbox1000: [30, 291, 971, 380] },
  { file: "apple-2026-q1-10-q-reference.pdf", page: 4, bbox1000: [188, 174, 813, 224] },
  // CompilerSpecimen: the operating-expenses row carried through all five homepage stages.
  { file: "apple-2026-q1-10-q-reference.pdf", page: 4, bbox1000: [64, 476, 932, 538] },
  { file: "apple-2026-q1-10-q-reference.pdf", page: 19, bbox1000: [62, 392, 939, 584] },
  { file: "apple-2026-proxy-def14a-reference.pdf", page: 11, bbox1000: [62, 40, 949, 518] },
  { file: "apple-2026-proxy-def14a-reference.pdf", page: 17, bbox1000: [62, 40, 949, 521] },
  /*
    BQ-016, the Change act's four arrival cards. `exploreChangeStory.arrivals` picks these at
    module load from the frozen compile snapshot; `lib/source-page-rasters.test.ts` reads the same
    selection and fails when one of them resolves to a page or bbox that is not rendered here.
  */
  { file: "apple-2026-proxy-def14a-reference.pdf", page: 48, bbox1000: [62, 90, 949, 257] },
  { file: "apple-2026-q1-10-q-reference.pdf", page: 4, bbox1000: [64, 561, 936, 639] },
  { file: "apple-2026-q2-10-q-reference.pdf", page: 4, bbox1000: [64, 561, 936, 639] },
  { file: "apple-2026-q3-10-q-reference.pdf", page: 4, bbox1000: [64, 583, 936, 668] },
];

const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const pad = (page) => String(page).padStart(3, "0");
const slug = (file) => file.replace(/\.pdf$/, "");

/* pnpm keeps transitive packages out of the hoisted tree, so @napi-rs/canvas is resolved through
   pdfjs-dist -- the package that depends on it -- rather than from this project's own root. */
const require = createRequire(join(root, "package.json"));
const pdfjsEntry = require.resolve("pdfjs-dist/package.json");
const fromPdfjs = createRequire(pdfjsEntry);
const { createCanvas } = await import(pathToFileURL(fromPdfjs.resolve("@napi-rs/canvas")).href);
const pdfjs = await import(pathToFileURL(join(dirname(pdfjsEntry), "legacy", "build", "pdf.mjs")).href);

function paint(page, scale) {
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  return { canvas, context, viewport };
}

async function render() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const entries = [];

  for (const source of PAGES) {
    const bytes = new Uint8Array(readFileSync(join(sampleDir, source.file)));
    const sourceSha256 = sha256(bytes);
    const document = await pdfjs.getDocument({ data: bytes, useSystemFonts: false, isEvalSupported: false }).promise;

    for (const number of source.pages) {
      const page = await document.getPage(number);
      const natural = page.getViewport({ scale: 1 });
      const scale = PAGE_WIDTH / natural.width;

      const full = paint(page, scale);
      await page.render({ canvasContext: full.context, viewport: full.viewport, canvas: full.canvas }).promise;
      const fullFile = `${slug(source.file)}-p${pad(number)}.webp`;
      const fullBytes = full.canvas.toBuffer("image/webp", QUALITY);
      writeFileSync(join(outDir, fullFile), fullBytes);

      const regions = [];
      const picks = REGIONS.filter((region) => region.file === source.file && region.page === number);
      if (picks.length > 0) {
        const zoom = paint(page, scale * REGION_SCALE);
        await page.render({ canvasContext: zoom.context, viewport: zoom.viewport, canvas: zoom.canvas }).promise;
        for (const pick of picks) {
          const [left, top, right, bottom] = pick.bbox1000;
          const x = Math.round((left / 1000) * zoom.canvas.width);
          const y = Math.round((top / 1000) * zoom.canvas.height);
          const width = Math.max(1, Math.round(((right - left) / 1000) * zoom.canvas.width));
          const height = Math.max(1, Math.round(((bottom - top) / 1000) * zoom.canvas.height));
          const crop = createCanvas(width, height);
          const context = crop.getContext("2d");
          context.fillStyle = "#ffffff";
          context.fillRect(0, 0, width, height);
          context.drawImage(zoom.canvas, x, y, width, height, 0, 0, width, height);
          const file = `${slug(source.file)}-p${pad(number)}-r${pick.bbox1000.join("-")}.webp`;
          const cropBytes = crop.toBuffer("image/webp", QUALITY);
          writeFileSync(join(outDir, file), cropBytes);
          regions.push({
            bbox1000: pick.bbox1000,
            file: `/explore-sample/pages/${file}`,
            width,
            height,
            bytes: cropBytes.length,
            sha256: sha256(cropBytes),
          });
        }
      }

      entries.push({
        sourceFile: source.file,
        sourceSha256,
        page: number,
        pageCount: document.numPages,
        file: `/explore-sample/pages/${fullFile}`,
        width: full.canvas.width,
        height: full.canvas.height,
        bytes: fullBytes.length,
        sha256: sha256(fullBytes),
        regions,
      });
    }
  }

  entries.sort((a, b) => a.sourceFile.localeCompare(b.sourceFile) || a.page - b.page);
  writeFileSync(
    join(outDir, "pages.manifest.json"),
    `${JSON.stringify({ generator: "scripts/render-source-pages.mjs", pageWidth: PAGE_WIDTH, regionScale: REGION_SCALE, quality: QUALITY, pages: entries }, null, 2)}\n`,
  );
  const total = readdirSync(outDir).length;
  console.log(`rendered ${entries.length} pages, ${entries.reduce((n, e) => n + e.regions.length, 0)} region crops, ${total} files`);
}

await render();
