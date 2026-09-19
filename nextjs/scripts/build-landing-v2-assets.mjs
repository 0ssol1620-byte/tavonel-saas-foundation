/**
 * Landing V2 image derivatives: resized pages and region crops, cut from the committed rasters.
 *
 * Nothing here generates imagery. Every byte emitted under `public/landing/v2/` is a resize or a
 * crop of a file already committed under `public/explore-sample/pages/`, which is itself a render
 * of a committed source PDF (`scripts/render-source-pages.mjs`). The landing may therefore show a
 * real filing page at a size a phone can afford, and nothing else.
 *
 * Fail-closed on the input: each source raster is re-hashed and compared with the sha256
 * `pages.manifest.json` recorded for it before a single pixel is read. A raster that drifted from
 * its manifest entry stops this script rather than being silently re-encoded into the landing.
 *
 * Deterministic: sorted keys, no timestamps, no run ids, fixed encoder settings. Re-running over
 * unchanged inputs rewrites byte-identical files, so a diff in `public/landing/v2/` means an input
 * or a setting moved.
 *
 * The render set below is a literal list because this script is plain Node and the selection lives
 * in TypeScript (`lib/landing-v2-hero.ts`, `lib/landing-v2-proof.ts`). It cannot drift silently:
 * `lib/landing-v2-assets.test.ts` fails when a region those modules resolve to is missing from the
 * manifest this script writes.
 *
 * `sharp` is not a dependency of this package. It is resolved from the shared pnpm store by
 * absolute path, the way the lane contract allows, and this file is a regeneration tool rather
 * than a build step -- the outputs and the manifest are committed.
 *
 *   node scripts/build-landing-v2-assets.mjs
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const pagesDir = join(root, "public", "explore-sample", "pages");
const outDir = join(root, "public", "landing", "v2");
const publicPrefix = "/landing/v2";

const SHARP_PATH =
  "D:/tvdetail-0910/nextjs/node_modules/.pnpm/sharp@0.35.4_@types+node@24.13.3/node_modules/sharp";
const sharp = createRequire(import.meta.url)(SHARP_PATH);

/** Encoder settings, fixed so the output bytes are a function of the input bytes alone. */
const WEBP = { quality: 80, effort: 6 };
const AVIF = { quality: 55, effort: 4 };

/*
  The render set.

  `page` entries are the filing pages the landing paints; `region` entries are the per-mille
  boxes it outlines, cut from the same page raster rather than from a second render, so a crop
  and the page it sits on can never disagree. Widths are CSS pixels: the page widths are the
  three hero sizes and the two proof sizes, and a region is emitted at its display width and at
  twice it.
*/
const RENDER_SET = [
  // Hero -- the /explore entry proof: Apple's 2025 Form 10-K, page 4, Company Background.
  { file: "apple-2025-form-10-k-p004.webp", kind: "page", widths: [560, 840, 1120] },
  { file: "apple-2025-form-10-k-p004.webp", kind: "region", bbox1000: [30, 291, 971, 380], widths: [640, 1280] },
  // Scene 02 -- the three grounded questions whose cited region sits on a committed page.
  { file: "apple-2026-q1-10-q-reference-p019.webp", kind: "page", widths: [720, 1080] },
  { file: "apple-2026-q1-10-q-reference-p019.webp", kind: "region", bbox1000: [62, 621, 939, 667], widths: [560, 1120] },
  { file: "apple-2026-q1-10-q-reference-p004.webp", kind: "page", widths: [720, 1080] },
  { file: "apple-2026-q1-10-q-reference-p004.webp", kind: "region", bbox1000: [64, 476, 932, 538], widths: [560, 1120] },
  { file: "apple-2026-proxy-def14a-reference-p017.webp", kind: "page", widths: [720, 1080] },
  { file: "apple-2026-proxy-def14a-reference-p017.webp", kind: "region", bbox1000: [62, 40, 949, 521], widths: [560, 1120] },
];

const manifest = JSON.parse(readFileSync(join(pagesDir, "pages.manifest.json"), "utf8"));

function sha256(buffer) {
  return `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
}

/** The committed page raster this entry reads, verified against its manifest digest first. */
function readSource(fileName) {
  const entry = manifest.pages.find((page) => page.file.endsWith(`/${fileName}`));
  if (!entry) throw new Error(`landing_v2_source_not_in_manifest: ${fileName}`);
  const bytes = readFileSync(join(pagesDir, fileName));
  const digest = sha256(bytes);
  if (digest !== entry.sha256) {
    throw new Error(`landing_v2_source_digest_moved: ${fileName} expected ${entry.sha256}, read ${digest}`);
  }
  return { entry, bytes };
}

/** Per-mille box to whole pixels on a raster of this size. Rounded once, here, so every consumer agrees. */
function cropRect(bbox1000, width, height) {
  const left = Math.round((bbox1000[0] / 1000) * width);
  const top = Math.round((bbox1000[1] / 1000) * height);
  const right = Math.round((bbox1000[2] / 1000) * width);
  const bottom = Math.round((bbox1000[3] / 1000) * height);
  return { left, top, width: right - left, height: bottom - top };
}

function baseName(fileName, bbox1000) {
  const stem = fileName.replace(/\.webp$/, "");
  return bbox1000 ? `${stem}-r${bbox1000.join("-")}` : stem;
}

async function main() {
  // A full rewrite, so a render set that shrank cannot leave an orphan file behind that the
  // manifest no longer names and nothing ever deletes.
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const entries = [];
  let avifWorks = true;

  for (const item of RENDER_SET) {
    const { entry, bytes } = readSource(item.file);
    const pipeline = () => {
      const image = sharp(bytes);
      return item.kind === "region"
        ? image.extract(cropRect(item.bbox1000, entry.width, entry.height))
        : image;
    };
    const outputs = [];
    for (const width of item.widths) {
      for (const format of ["webp", "avif"]) {
        if (format === "avif" && !avifWorks) continue;
        const encoder = pipeline().resize({ width, withoutEnlargement: true });
        let buffer;
        try {
          buffer = format === "webp"
            ? await encoder.webp(WEBP).toBuffer()
            : await encoder.avif(AVIF).toBuffer();
        } catch (error) {
          if (format !== "avif") throw error;
          // Reported rather than swallowed: the lane report says whether AVIF was emitted.
          console.warn(`avif_unavailable: ${error.message}`);
          avifWorks = false;
          continue;
        }
        const meta = await sharp(buffer).metadata();
        const name = `${baseName(item.file, item.bbox1000)}-${width}.${format}`;
        writeFileSync(join(outDir, name), buffer);
        outputs.push({
          bytes: buffer.length,
          format,
          height: meta.height,
          sha256: sha256(buffer),
          src: `${publicPrefix}/${name}`,
          width: meta.width,
        });
      }
    }
    outputs.sort((left, right) => left.src.localeCompare(right.src));
    entries.push({
      ...(item.bbox1000 ? { bbox1000: item.bbox1000 } : {}),
      kind: item.kind,
      outputs,
      page: entry.page,
      source: entry.file,
      sourceSha256: entry.sourceSha256,
    });
  }

  entries.sort((left, right) =>
    `${left.source}|${left.kind}|${left.bbox1000 ?? ""}`.localeCompare(
      `${right.source}|${right.kind}|${right.bbox1000 ?? ""}`,
    ));

  writeFileSync(
    join(outDir, "manifest.json"),
    `${JSON.stringify({ avif: avifWorks, entries, generator: "scripts/build-landing-v2-assets.mjs", quality: { avif: AVIF.quality, webp: WEBP.quality } }, null, 2)}\n`,
  );

  const files = readdirSync(outDir).filter((name) => name !== "manifest.json");
  const total = entries.flatMap((entry) => entry.outputs).reduce((sum, output) => sum + output.bytes, 0);
  console.log(`${files.length} files, ${total} bytes, avif=${avifWorks}`);
  for (const entry of entries) {
    for (const output of entry.outputs) console.log(`  ${output.src} ${output.width}x${output.height} ${output.bytes}`);
  }
}

await main();
