/**
 * `shared/intakeCeiling.ts` holds the size and page ceiling once, but the processors that enforce
 * it live in trees that cannot import it: the Cloudflare worker, the Cloud Run rasterizer and the
 * GPU reader. Each restates the number as its own constant, and the worker's OCR result check
 * restates the page ceiling inline. Those copies were never compared, so raising the ceiling in
 * one place would have left a refusal hiding in another.
 *
 * This test reads every copy as text (no Python and no worker toolchain needed) and fails when one
 * disagrees with `intakeCeiling.ts`. The bounds downstream of the ceiling -- the rasterizer's
 * output, the reader's input, and the worker's OCR result and storage bounds -- are not derived
 * from `intakeCeiling.ts`; they are sized for an 80-page source and pinned here, so changing one
 * is a deliberate edit to this file rather than a silent drift (table/limits plan 2026-10-17, T1).
 * No number is changed by this test.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  INTAKE_CEILING_STAGE,
  INTAKE_CEILING_STAGES,
  OCR_JSON_MAX_BYTES,
  PROCESSING_CEILING,
  intakeCeilingFor,
} from "../../shared/intakeCeiling";
import { MAX_DERIVED_JSON_BYTES } from "./r2-objects";

const ROOT = resolve(import.meta.dirname, "..", "..");
const WORKER_KEYS = "quarantine-sidecar/foundation-cdr-worker/src/keys.ts";
const WORKER_OCR = "quarantine-sidecar/foundation-cdr-worker/src/ocr.ts";
const CDR = "quarantine-sidecar/cdr-cloudrun/app.py";
const GPU = "workers/foundation-ocr-gpu/app.py";
const CEILING = "shared/intakeCeiling.ts";
const READER = "nextjs/lib/r2-objects.ts";
const WORKER_SANITIZE = "quarantine-sidecar/foundation-cdr-worker/src/sanitize.ts";
const WORKER_TEXT_LAYER = "quarantine-sidecar/foundation-cdr-worker/src/text-layer-shadow.ts";

// A Windows checkout is CRLF (core.autocrlf) and CI is LF; the line anchors must see the same text.
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8").replace(/\r\n/g, "\n");
const tree = new Map([WORKER_KEYS, WORKER_OCR, CDR, GPU, CEILING, READER, WORKER_SANITIZE, WORKER_TEXT_LAYER].map((path) => [path, read(path)]));
const fromTree = (path: string) => tree.get(path) ?? "";

/** `80`, `4_000_000`, `5 * 1024 * 1024`. A name, a call or anything else is NaN and never matches. */
function integerLiteral(expression: string): number {
  const factors = expression.split("*").map((factor) => factor.trim());
  if (!factors.every((factor) => /^\d[\d_]*$/.test(factor))) return Number.NaN;
  return factors.reduce((product, factor) => product * Number(factor.replaceAll("_", "")), 1);
}

const declaredInCeiling = (name: string) =>
  integerLiteral(new RegExp(`^const ${name} = (.+);$`, "m").exec(fromTree(CEILING))?.[1] ?? "");

// intakeCeiling.ts keeps one private copy per processor and exports the minimum, so a processor is
// compared with its own copy: raising one processor and its copy together is not a disagreement.
const WORKER_SOURCE_BYTES = declaredInCeiling("WORKER_MAX_SOURCE_BYTES");
const CDR_INPUT_BYTES = declaredInCeiling("CDR_MAX_INPUT_BYTES");
const PAGES = INTAKE_CEILING_STAGES[0].maxSourcePages;
const STAGE_1_PAGES = INTAKE_CEILING_STAGES[1].maxSourcePages;
const MIB = 1024 * 1024;
const RASTER_HANDOFF_BYTES = 18 * MIB;
// D1 stage 1 bounds below the ceiling are the stage-0 bounds per page times the stage-1 pages.
const perStage1Page = (stage0Bound: number) => (stage0Bound / PAGES) * STAGE_1_PAGES;
const ocrBounds = (stage: 0 | 1, field: string, tail = ",") =>
  new RegExp(`^const STAGE_${stage}_OCR_BOUNDS: OcrBounds = \\{.*?\\b${field}: ([^,}]+?)${tail}`, "gm");

type Site = { file: string; name: string; pattern: RegExp; expected: number; source: string };

const SITES: readonly Site[] = [
  {
    file: WORKER_KEYS, name: "MAX_SOURCE_BYTES", pattern: /^export const MAX_SOURCE_BYTES = (.+);$/gm,
    expected: WORKER_SOURCE_BYTES, source: "intakeCeiling.ts WORKER_MAX_SOURCE_BYTES",
  },
  {
    file: CDR, name: "MAX_INPUT_BYTES", pattern: /^MAX_INPUT_BYTES: Final = (.+)$/gm,
    expected: CDR_INPUT_BYTES, source: "intakeCeiling.ts CDR_MAX_INPUT_BYTES",
  },
  {
    file: CDR, name: "MAX_PAGES", pattern: /^MAX_PAGES: Final = (.+)$/gm,
    expected: PAGES, source: "PROCESSING_CEILING.maxSourcePages",
  },
  {
    file: GPU, name: "MAX_PAGES", pattern: /^MAX_PAGES: Final = (.+)$/gm,
    expected: PAGES, source: "PROCESSING_CEILING.maxSourcePages: the reader reads every page the rasterizer renders",
  },
  {
    file: WORKER_OCR, name: "STAGE_0_OCR_BOUNDS pages", pattern: ocrBounds(0, "pages"),
    expected: PAGES, source: "PROCESSING_CEILING.maxSourcePages: the worker keeps every page the reader returns",
  },
  {
    file: CDR, name: "MAX_OUTPUT_BYTES", pattern: /^MAX_OUTPUT_BYTES: Final = (.+)$/gm,
    expected: RASTER_HANDOFF_BYTES, source: "pinned: the sanitized PDF the GPU reader must admit",
  },
  {
    file: GPU, name: "MAX_INPUT_BYTES", pattern: /^MAX_INPUT_BYTES: Final = (.+)$/gm,
    expected: RASTER_HANDOFF_BYTES, source: "pinned: equal to the rasterizer's MAX_OUTPUT_BYTES",
  },
  {
    // The worker carries the sanitized PDF from the rasterizer to the reader; a smaller bound
    // here retries a paid CDR run into the DLQ (review R1 M1).
    file: WORKER_SANITIZE, name: "MAX_SANITIZED_BYTES", pattern: /^const MAX_SANITIZED_BYTES = (.+);$/gm,
    expected: RASTER_HANDOFF_BYTES, source: "pinned: equal to the rasterizer's MAX_OUTPUT_BYTES",
  },
  {
    // The compile reads what the worker stored (#189): below the worker's bound, an accepted
    // source reads, stores, and then fails at structuring on size alone (cjob-1e8b7a0e).
    file: WORKER_OCR, name: "STAGE_0_OCR_BOUNDS persistedBytes", pattern: ocrBounds(0, "persistedBytes", " \\};"),
    expected: intakeCeilingFor(0).OCR_JSON_MAX_BYTES, source: "intakeCeiling.ts OCR_JSON_MAX_BYTES at stage 0: ocr.json for an 80-page source",
  },
  {
    file: WORKER_SANITIZE, name: "MAX_RECEIPT_BYTES", pattern: /^const MAX_RECEIPT_BYTES = (.+);$/gm,
    expected: 16 * 1024, source: "pinned: the ocr-review.json receipt the worker writes",
  },
  {
    file: READER, name: "MAX_OCR_REVIEW_JSON_BYTES", pattern: /^export const MAX_OCR_REVIEW_JSON_BYTES = (.+);$/gm,
    expected: 16 * 1024, source: "pinned: equal to the worker's MAX_RECEIPT_BYTES",
  },
  {
    file: WORKER_OCR, name: "STAGE_0_OCR_BOUNDS textChars", pattern: ocrBounds(0, "textChars"),
    expected: 4_000_000, source: "pinned: OCR text for an 80-page source",
  },
  {
    file: WORKER_OCR, name: "STAGE_0_OCR_BOUNDS regions", pattern: ocrBounds(0, "regions"),
    expected: 50_000, source: "pinned: OCR regions for an 80-page source",
  },
  // D1 stage 1 (PROGRAM-2026-11-04 §4.D, 25 MiB / 200 pages): the copies a processor reads when it
  // runs with TAVONEL_INTAKE_CEILING_STAGE=1. Bytes and pages are §4.D's; the rest is derived.
  {
    file: WORKER_KEYS, name: "STAGE_1_MAX_SOURCE_BYTES", pattern: /^export const STAGE_1_MAX_SOURCE_BYTES = (.+);$/gm,
    expected: declaredInCeiling("WORKER_STAGE_1_MAX_SOURCE_BYTES"), source: "intakeCeiling.ts WORKER_STAGE_1_MAX_SOURCE_BYTES",
  },
  {
    file: CDR, name: "STAGE_1_MAX_INPUT_BYTES", pattern: /^STAGE_1_MAX_INPUT_BYTES: Final = (.+)$/gm,
    expected: declaredInCeiling("CDR_STAGE_1_MAX_INPUT_BYTES"), source: "intakeCeiling.ts CDR_STAGE_1_MAX_INPUT_BYTES",
  },
  {
    file: CDR, name: "STAGE_1_MAX_PAGES", pattern: /^STAGE_1_MAX_PAGES: Final = (.+)$/gm,
    expected: STAGE_1_PAGES, source: "INTAKE_CEILING_STAGES[1].maxSourcePages",
  },
  {
    file: CDR, name: "STAGE_1_MAX_OUTPUT_BYTES", pattern: /^STAGE_1_MAX_OUTPUT_BYTES: Final = (.+)$/gm,
    expected: perStage1Page(RASTER_HANDOFF_BYTES), source: "derived: the stage-0 output bound per page times the stage-1 pages",
  },
  {
    file: CDR, name: "STAGE_1_RASTER_RANGE_PAGES", pattern: /^STAGE_1_RASTER_RANGE_PAGES: Final = (.+)$/gm,
    expected: 8, source: "pinned: the worker's OCR range size (wrangler.jsonc FOUNDATION_OCR_PAGE_RANGE_SIZE)",
  },
  {
    file: GPU, name: "STAGE_1_MAX_PAGES", pattern: /^STAGE_1_MAX_PAGES: Final = (.+)$/gm,
    expected: STAGE_1_PAGES, source: "INTAKE_CEILING_STAGES[1].maxSourcePages: the reader reads every page the rasterizer renders",
  },
  {
    file: GPU, name: "STAGE_1_MAX_INPUT_BYTES", pattern: /^STAGE_1_MAX_INPUT_BYTES: Final = (.+)$/gm,
    expected: perStage1Page(RASTER_HANDOFF_BYTES), source: "derived: equal to the rasterizer's STAGE_1_MAX_OUTPUT_BYTES",
  },
  {
    file: WORKER_SANITIZE, name: "STAGE_1_MAX_SANITIZED_BYTES", pattern: /^const STAGE_1_MAX_SANITIZED_BYTES = (.+);$/gm,
    expected: perStage1Page(RASTER_HANDOFF_BYTES), source: "derived: equal to the rasterizer's STAGE_1_MAX_OUTPUT_BYTES",
  },
  {
    // The D2 shadow reads the ocr.json the worker wrote at either stage, so it takes the larger.
    file: WORKER_TEXT_LAYER, name: "MAX_OCR_JSON_BYTES", pattern: /^const MAX_OCR_JSON_BYTES = (.+);$/gm,
    expected: intakeCeilingFor(1).OCR_JSON_MAX_BYTES, source: "intakeCeiling.ts OCR_JSON_MAX_BYTES at stage 1",
  },
  {
    file: WORKER_TEXT_LAYER, name: "MAX_TEXT_LAYER_BYTES", pattern: /^const MAX_TEXT_LAYER_BYTES = (.+);$/gm,
    expected: intakeCeilingFor(0).OCR_JSON_MAX_BYTES, source: "intakeCeiling.ts OCR_JSON_MAX_BYTES at stage 0",
  },
  {
    file: WORKER_OCR, name: "STAGE_1_OCR_BOUNDS pages", pattern: ocrBounds(1, "pages"),
    expected: STAGE_1_PAGES, source: "INTAKE_CEILING_STAGES[1].maxSourcePages",
  },
  {
    file: WORKER_OCR, name: "STAGE_1_OCR_BOUNDS textChars", pattern: ocrBounds(1, "textChars"),
    expected: perStage1Page(4_000_000), source: "derived: the stage-0 text bound per page times the stage-1 pages",
  },
  {
    file: WORKER_OCR, name: "STAGE_1_OCR_BOUNDS regions", pattern: ocrBounds(1, "regions"),
    expected: perStage1Page(50_000), source: "derived: the stage-0 region bound per page times the stage-1 pages",
  },
  {
    file: WORKER_OCR, name: "STAGE_1_OCR_BOUNDS persistedBytes", pattern: ocrBounds(1, "persistedBytes", " \\};"),
    expected: intakeCeilingFor(1).OCR_JSON_MAX_BYTES, source: "intakeCeiling.ts OCR_JSON_MAX_BYTES at stage 1",
  },
];

/** Every site must be declared exactly once: a second copy is one more hidden limit, not a refactor. */
function disagreements(sites: readonly Site[], text: (file: string) => string): string[] {
  return sites.flatMap((site) => {
    const source = text(site.file);
    const found = [...source.matchAll(site.pattern)];
    if (found.length !== 1) {
      return [`${site.file} ${site.name}: ${found.length} declarations found, expected exactly one`];
    }
    const [match] = found;
    if (integerLiteral(match[1]) === site.expected) return [];
    const line = source.slice(0, match.index).split("\n").length;
    return [`${site.file}:${line} ${site.name} = ${match[1]}, expected ${site.expected} (${site.source})`];
  });
}

/** The tree with one site's declaration rewritten, everything else as read from disk. */
function withSite(site: Site, rewrite: (declaration: string, value: string) => string) {
  return (file: string) => {
    const source = fromTree(file);
    if (file !== site.file) return source;
    const [match] = [...source.matchAll(site.pattern)];
    const start = match.index ?? 0;
    return source.slice(0, start) + rewrite(match[0], match[1]) + source.slice(start + match[0].length);
  };
}

describe("hidden copies of the intake ceiling", () => {
  it("parses the same copies intakeCeiling.ts computes its ceiling from", () => {
    expect(Number.isInteger(WORKER_SOURCE_BYTES) && Number.isInteger(CDR_INPUT_BYTES)).toBe(true);
    expect(PROCESSING_CEILING.maxSourceBytes).toBe(Math.min(WORKER_SOURCE_BYTES, CDR_INPUT_BYTES));
    expect(PROCESSING_CEILING.maxSourcePages).toBe(declaredInCeiling("CDR_MAX_PAGES"));
  });

  it("agree with intakeCeiling.ts and the pinned downstream bounds in every tree", () => {
    expect(disagreements(SITES, fromTree)).toEqual([]);
  });

  it("fail at the one site whose value changed, for every site", () => {
    for (const site of SITES) {
      const found = disagreements(SITES, withSite(site, (declaration, value) =>
        declaration.replace(value, String(site.expected + 1))));
      expect(found, site.name).toHaveLength(1);
      expect(found[0]).toMatch(new RegExp(`^${site.file}:\\d+ ${site.name} = ${site.expected + 1}, expected ${site.expected} `));
    }
  });

  it("fail when a copy disappears, doubles or stops being a literal", () => {
    const gpuPages = SITES.find((site) => site.file === GPU && site.name === "MAX_PAGES");
    if (!gpuPages) throw new Error("the GPU page site is missing from SITES");

    const renamed = disagreements([gpuPages], withSite(gpuPages, (declaration) =>
      declaration.replace("MAX_PAGES", "PAGE_LIMIT")));
    expect(renamed).toEqual([`${GPU} MAX_PAGES: 0 declarations found, expected exactly one`]);

    const doubled = disagreements([gpuPages], (file) => `${fromTree(file)}\nMAX_PAGES: Final = ${PAGES}\n`);
    expect(doubled).toEqual([`${GPU} MAX_PAGES: 2 declarations found, expected exactly one`]);

    const computed = disagreements([gpuPages], withSite(gpuPages, (declaration, value) =>
      declaration.replace(value, 'int(os.environ["MAX_PAGES"])')));
    expect(computed).toHaveLength(1);
    expect(computed[0]).toContain(`MAX_PAGES = int(os.environ["MAX_PAGES"]), expected ${PAGES}`);
  });

  /*
    D1 stage 1 (PROGRAM-2026-11-04 §4.D). The rasterizer and the reader accept measurement
    overrides of the literals above, for a revision or endpoint deployed for measurement only.
    What keeps that from becoming a hidden production limit: the literals stay the defaults (the
    site checks above), the overrides are capped at the stage-2 target, and no definition a
    production deploy is built or applied from sets one.
  */
  it("caps the measurement overrides at stage 2 and keeps them out of every deploy definition", () => {
    const cdr = fromTree(CDR);
    const gpu = fromTree(GPU);
    const cap = (source: string, name: string) =>
      integerLiteral(new RegExp(`^${name}: Final = (.+)$`, "m").exec(source)?.[1] ?? "");
    expect(cap(cdr, "MEASUREMENT_HARD_MAX_PAGES")).toBe(500);
    expect(cap(cdr, "MEASUREMENT_HARD_MAX_INPUT_BYTES")).toBe(50 * MIB);
    expect(cap(gpu, "MEASUREMENT_HARD_MAX_PAGES")).toBe(500);
    for (const name of ["TAVONEL_CDR_MAX_INPUT_BYTES", "TAVONEL_CDR_MAX_PAGES", "TAVONEL_CDR_MAX_OUTPUT_BYTES", "TAVONEL_CDR_RASTER_RANGE_PAGES"]) {
      expect(cdr, name).toContain(`"${name}"`);
    }
    for (const name of ["TAVONEL_OCR_MAX_INPUT_BYTES", "TAVONEL_OCR_MAX_PAGES"]) expect(gpu, name).toContain(`"${name}"`);
    const definitions = [
      "quarantine-sidecar/cdr-cloudrun/service.yaml", "quarantine-sidecar/cdr-cloudrun/Dockerfile",
      "workers/foundation-ocr-gpu/Dockerfile", "workers/foundation-ocr-gpu/cloudbuild.yaml",
      "quarantine-sidecar/foundation-cdr-worker/wrangler.jsonc",
    ];
    for (const file of definitions) {
      expect(read(file), file).not.toMatch(/TAVONEL_(CDR|OCR)_(MAX_[A-Z_]+|RASTER_RANGE_PAGES)/);
    }
  });

  it("read the compile's ocr.json bound from the active stage, never a literal of its own", () => {
    expect(fromTree(READER)).toMatch(/^export const MAX_DERIVED_JSON_BYTES = OCR_JSON_MAX_BYTES;$/m);
    expect(MAX_DERIVED_JSON_BYTES).toBe(OCR_JSON_MAX_BYTES);
    expect(OCR_JSON_MAX_BYTES).toBe(intakeCeilingFor(INTAKE_CEILING_STAGE).OCR_JSON_MAX_BYTES);
    expect([intakeCeilingFor(0).OCR_JSON_MAX_BYTES, intakeCeilingFor(1).OCR_JSON_MAX_BYTES]).toEqual([24 * MIB, 60 * MIB]);
  });

  /*
    The stage intake admits ships as 0. §4.D's stage-1 numbers are measurements to be taken, not
    targets, and the processors must run stage 1 before intake does (RELEASE_ORDER.md, "W2-D").
    Flipping it is therefore an edit to this assertion, made in the reviewed change that records
    the measurement.
  */
  it("ship intake at stage 0, with stage 1 at the section 4.D numbers", () => {
    expect(INTAKE_CEILING_STAGE).toBe(0);
    expect(PROCESSING_CEILING).toEqual(INTAKE_CEILING_STAGES[0]);
    expect(INTAKE_CEILING_STAGES).toEqual({
      0: { maxSourceBytes: 5 * MIB, maxSourcePages: 80 },
      1: { maxSourceBytes: 25 * MIB, maxSourcePages: 200 },
    });
  });

  it("fail when intakeCeiling.ts stops stating a processor copy as a literal", () => {
    expect(integerLiteral("5 * 1024 * 1024")).toBe(5 * MIB);
    expect(integerLiteral("4_000_000")).toBe(4_000_000);
    expect(integerLiteral("WORKER_MAX_SOURCE_BYTES")).toBeNaN();
    expect(integerLiteral("")).toBeNaN();
    const site = { ...SITES[0], expected: integerLiteral("") };
    expect(disagreements([site], fromTree)).toHaveLength(1);
  });
});
