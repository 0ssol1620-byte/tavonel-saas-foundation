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
import { PROCESSING_CEILING } from "../../shared/intakeCeiling";

const ROOT = resolve(import.meta.dirname, "..", "..");
const WORKER_KEYS = "quarantine-sidecar/foundation-cdr-worker/src/keys.ts";
const WORKER_OCR = "quarantine-sidecar/foundation-cdr-worker/src/ocr.ts";
const CDR = "quarantine-sidecar/cdr-cloudrun/app.py";
const GPU = "workers/foundation-ocr-gpu/app.py";
const CEILING = "shared/intakeCeiling.ts";

// A Windows checkout is CRLF (core.autocrlf) and CI is LF; the line anchors must see the same text.
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8").replace(/\r\n/g, "\n");
const tree = new Map([WORKER_KEYS, WORKER_OCR, CDR, GPU, CEILING].map((path) => [path, read(path)]));
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
const PAGES = PROCESSING_CEILING.maxSourcePages;
const MIB = 1024 * 1024;
const RASTER_HANDOFF_BYTES = 18 * MIB;

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
    file: WORKER_OCR, name: "OCR result pageCount bound", pattern: /Number\(result\.pageCount\) > (\S+) \|\|/g,
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
    file: WORKER_OCR, name: "MAX_PERSISTED_OCR_BYTES", pattern: /^const MAX_PERSISTED_OCR_BYTES = (.+);$/gm,
    expected: 24 * MIB, source: "pinned: ocr.json for an 80-page source",
  },
  {
    file: WORKER_OCR, name: "OCR result text length bound", pattern: /result\.text\.length > (\S+) \|\|/g,
    expected: 4_000_000, source: "pinned: OCR text for an 80-page source",
  },
  {
    file: WORKER_OCR, name: "OCR result region count bound", pattern: /result\.regions\.length > (\S+)$/gm,
    expected: 50_000, source: "pinned: OCR regions for an 80-page source",
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

  it("fail when intakeCeiling.ts stops stating a processor copy as a literal", () => {
    expect(integerLiteral("5 * 1024 * 1024")).toBe(5 * MIB);
    expect(integerLiteral("4_000_000")).toBe(4_000_000);
    expect(integerLiteral("WORKER_MAX_SOURCE_BYTES")).toBeNaN();
    expect(integerLiteral("")).toBeNaN();
    const site = { ...SITES[0], expected: integerLiteral("") };
    expect(disagreements([site], fromTree)).toHaveLength(1);
  });
});
