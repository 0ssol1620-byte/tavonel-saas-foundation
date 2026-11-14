/**
 * The size a source has to be under for this deployment to actually process it.
 *
 * The number was written down three times in three trees and drifted: intake admitted 250 MiB
 * (`nextjs/lib/r2-presign.ts`), the Cloudflare CDR worker refused above 5 MiB
 * (`quarantine-sidecar/foundation-cdr-worker/src/keys.ts`) and the Cloud Run rasterizer refused
 * above 5 MiB and 80 pages (`quarantine-sidecar/cdr-cloudrun/app.py`). Everything in between was
 * accepted, stored, billed and then dropped with nothing to show for it.
 *
 * So the ceiling lives here, once, and every party that has an opinion about it reads this file:
 * the capability route that admits an upload, the worker that reads the bytes, the capability
 * manifest `/sources` renders, and migration 0051's CHECK on `requested_bytes`.
 *
 * Two rules for changing a number below:
 *
 *   1. `PROCESSING_CEILING` is a *measurement of the deployed processors*, not a target. Raising
 *      it without raising `MAX_INPUT_BYTES` in `app.py` and `MAX_SOURCE_BYTES` in the worker
 *      re-creates exactly the failure this file exists to remove.
 *   2. Intake never decodes the document, so the page ceiling is checked at intake only against
 *      the count the browser read from a PDF's page tree or a Word file's declared pages; a file
 *      with no count is refused by the processors after it is read. It is disclosed in
 *      `knownLimitations` and in the refusal a customer reads either way.
 *   2a. Pages come in two numbers (ADR-0006). One CDR request renders at most the stage's
 *      `maxSourcePages` in `INTAKE_CEILING_STAGES`; with `SEGMENTED_INTAKE_ENABLED`, a PDF longer
 *      than that is read as ranges of that size, up to `CDR_SEGMENTED_MAX_DOCUMENT_PAGES` in all.
 *      Every other format, and every file whose pages are not counted before upload, keeps the
 *      per-request number.
 *   3. The processors restate these numbers in trees that cannot import this file: the worker's
 *      `MAX_SOURCE_BYTES` and its OCR result page bound (`src/ocr.ts`), the rasterizer's
 *      `MAX_INPUT_BYTES` and `MAX_PAGES`, and the GPU reader's `MAX_PAGES`. The bounds sized
 *      against an 80-page source sit beside them: the rasterizer's `MAX_OUTPUT_BYTES`, the GPU
 *      reader's `MAX_INPUT_BYTES`, and the worker's OCR text, region and stored `ocr.json` bounds.
 *      `nextjs/lib/intake-ceiling-cross-tree.test.ts` reads every one of them as text and fails
 *      when one disagrees, so changing any of them is a change to that test too.
 */

/** Bytes the Cloudflare worker will read (`src/keys.ts` MAX_SOURCE_BYTES). */
const WORKER_MAX_SOURCE_BYTES = 5 * 1024 * 1024;
/** Bytes the Cloud Run rasterizer will accept (`app.py` MAX_INPUT_BYTES). */
const CDR_MAX_INPUT_BYTES = 5 * 1024 * 1024;
/** Pages the Cloud Run rasterizer will render (`app.py` MAX_PAGES). */
const CDR_MAX_PAGES = 80;
/**
 * Pages in one segmented source, read as ranges of at most one request's pages: `app.py`
 * SEGMENTED_MAX_DOCUMENT_PAGES and the worker's `src/sanitize.ts` MAX_SEGMENTED_SOURCE_PAGES.
 */
const CDR_SEGMENTED_MAX_DOCUMENT_PAGES = 500;

/**
 * The formats the worker segments (`src/sanitize.ts` SEGMENTABLE_MIMES): PDF only.
 *
 * Not DOCX. A Word file's page count is the number Word last wrote into docProps/app.xml, which
 * intake may quote against but the processor never verified, and a DOCX with no such number is
 * approved at the per-request ceiling. Reading either in ranges would process pages nobody
 * approved, so a DOCX keeps one request's pages and the rasterizer refuses a longer one before
 * any page is read or charged (#234 R1, item 1).
 */
export const SEGMENTED_SOURCE_MIMES: ReadonlySet<string> = new Set(["application/pdf"]);

/**
 * Whether intake admits a PDF longer than one CDR request (ADR-0006). The same switch, in code,
 * as the worker's `FOUNDATION_SOURCE_SEGMENT_PAGES`: intake must never admit a page count the
 * deployed worker would refuse after upload (#234 R1, item 2).
 *
 * A code constant like `INTAKE_CEILING_STAGE`, so every server and client number in one build
 * agrees, and the pricing fingerprint does not move until it flips. It is set true only in its
 * own release, after the worker runs with `FOUNDATION_SOURCE_SEGMENT_PAGES=80`
 * (docs/runbooks/RELEASE_ORDER.md, "Segmented sources"). `intake-ceiling-cross-tree.test.ts`
 * refuses a tree where this is true and the worker's wrangler.jsonc does not set that var.
 */
export const SEGMENTED_INTAKE_ENABLED: boolean = false;

/*
  D1 stage 1 (PROGRAM-2026-11-04 §4.D, "단계 1: 25 MiB / 200쪽"). The same three copies for a
  processor deployed with TAVONEL_INTAKE_CEILING_STAGE=1: worker `STAGE_1_MAX_SOURCE_BYTES`,
  rasterizer `STAGE_1_MAX_INPUT_BYTES` / `STAGE_1_MAX_PAGES`. §4.D calls the numbers measurements,
  not targets: they stay here, unused by intake, until the stage-1 gates have been measured.
*/
const WORKER_STAGE_1_MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const CDR_STAGE_1_MAX_INPUT_BYTES = 25 * 1024 * 1024;
const CDR_STAGE_1_MAX_PAGES = 200;

/**
 * The worker's stored `ocr.json` bound for an 80-page source (`src/ocr.ts` STAGE_0_OCR_BOUNDS
 * persistedBytes), and the compile's read bound with it (#189). Every other stage's bound is this
 * one per page times its page ceiling: derived, not measured.
 */
const OCR_JSON_BYTES_FOR_80_PAGES = 24 * 1024 * 1024;

export const INTAKE_CEILING_STAGES = {
  0: { maxSourceBytes: Math.min(WORKER_MAX_SOURCE_BYTES, CDR_MAX_INPUT_BYTES), maxSourcePages: CDR_MAX_PAGES },
  1: { maxSourceBytes: Math.min(WORKER_STAGE_1_MAX_SOURCE_BYTES, CDR_STAGE_1_MAX_INPUT_BYTES), maxSourcePages: CDR_STAGE_1_MAX_PAGES },
} as const;

export type IntakeCeilingStage = keyof typeof INTAKE_CEILING_STAGES;

/**
 * The stage intake admits. A code constant, not an environment flag, so `/sources`, the pricing
 * page and the refusal a customer reads are one build's numbers on server and client alike
 * (§4.D: "한도는 flag가 아니라 코드 상수(측정값)다").
 *
 * Stays 0 until every stage-1 precondition holds (docs/runbooks/RELEASE_ORDER.md, "W2-D"): the
 * §4.D gates measured, the rasterizer, reader and worker deployed with
 * TAVONEL_INTAKE_CEILING_STAGE=1, and the admission CHECKs migrated. Raising it before the
 * processors is the accepted-then-dropped failure this file exists to prevent.
 */
export const INTAKE_CEILING_STAGE: IntakeCeilingStage = 0;

/** One page limit, as a manifest token and the format it applies to. */
export type PageLimit = { token: string; pages: number; appliesTo: "any" | "pdf" | "other" };

/** "up to 500 pages per PDF", with the noun the caller's sentence uses for one source. */
export function pageLimitPhrase(limit: PageLimit, noun: "source" | "file"): string {
  if (limit.appliesTo === "pdf") return `up to ${limit.pages} pages per PDF`;
  if (limit.appliesTo === "other") return `up to ${limit.pages} pages per ${noun} in any other format`;
  return `up to ${limit.pages} pages per ${noun}`;
}

/** Everything a stage decides, under the names this module exports for the active stage. */
export function intakeCeilingFor(stage: IntakeCeilingStage, segmented: boolean = SEGMENTED_INTAKE_ENABLED) {
  // Per CDR request: what one rasterizer call renders and one ocr.json holds.
  const ceiling = INTAKE_CEILING_STAGES[stage];
  const mib = ceiling.maxSourceBytes / (1024 * 1024);
  const perRequest = ceiling.maxSourcePages;
  const processing = {
    maxSourceBytes: ceiling.maxSourceBytes,
    /** A PDF counted before upload: read in ranges when segmented intake is on, else one request. */
    maxSourcePages: segmented ? CDR_SEGMENTED_MAX_DOCUMENT_PAGES : perRequest,
    /** Every other format, and any file whose pages are not counted before upload. */
    maxUnsegmentedSourcePages: perRequest,
  } as const;
  const pageLimits: readonly PageLimit[] = segmented
    ? [
      { token: `at_most_${processing.maxSourcePages}_pages_per_pdf_source`, pages: processing.maxSourcePages, appliesTo: "pdf" },
      { token: `at_most_${perRequest}_pages_per_other_source`, pages: perRequest, appliesTo: "other" },
    ]
    : [{ token: `at_most_${perRequest}_pages_per_source`, pages: perRequest, appliesTo: "any" }];
  /** "500 pages for a PDF or 80 pages for any other format", or "80 pages" while segmented intake is off. */
  const pages = segmented
    ? `${processing.maxSourcePages} pages for a PDF or ${perRequest} pages for any other format`
    : `${perRequest} pages`;
  return {
    PROCESSING_CEILING: processing,
    PROCESSING_CEILING_MIB: mib,
    PROCESSING_CEILING_PAGE_LIMITS: pageLimits,
    PROCESSING_CEILING_PAGES: pages,
    /*
      The same ceilings as manifest tokens, so `/sources` and a refusal cannot drift apart.
      `words()` in the capability table renders a token by replacing underscores with spaces, so
      these read as sentences in the Known limitations column.
    */
    PROCESSING_CEILING_LIMITATIONS: [`at_most_${mib}_mib_per_source`, ...pageLimits.map((limit) => limit.token)] as readonly string[],
    /** One sentence a customer can act on. Used by the refusal copy and the typed 413. */
    PROCESSING_CEILING_SENTENCE: segmented
      ? `TAVONEL processes sources up to ${mib} MB, and up to ${pages}.`
      : `TAVONEL processes sources up to ${mib} MB and ${pages}.`,
    /**
     * The largest `ocr.json` the worker stores for this stage, and so the compile's read bound.
     * Per request, not per source: a segmented source stores one `ocr.json` per range.
     */
    OCR_JSON_MAX_BYTES: (OCR_JSON_BYTES_FOR_80_PAGES / 80) * ceiling.maxSourcePages,
  };
}

const ACTIVE = intakeCeilingFor(INTAKE_CEILING_STAGE);

export const PROCESSING_CEILING = ACTIVE.PROCESSING_CEILING;
export const PROCESSING_CEILING_MIB = ACTIVE.PROCESSING_CEILING_MIB;
export const PROCESSING_CEILING_PAGE_LIMITS = ACTIVE.PROCESSING_CEILING_PAGE_LIMITS;
export const PROCESSING_CEILING_PAGES = ACTIVE.PROCESSING_CEILING_PAGES;
export const PROCESSING_CEILING_LIMITATIONS = ACTIVE.PROCESSING_CEILING_LIMITATIONS;
export const PROCESSING_CEILING_SENTENCE = ACTIVE.PROCESSING_CEILING_SENTENCE;
export const OCR_JSON_MAX_BYTES = ACTIVE.OCR_JSON_MAX_BYTES;

/**
 * The most pages intake admits for one source of this format. Only a segmented format may pass
 * one request's pages, and only while `SEGMENTED_INTAKE_ENABLED`; a caller with no count reserves
 * `maxUnsegmentedSourcePages`, never this.
 */
export function maxSourcePagesFor(mimeType: string, ceiling: { maxSourcePages: number; maxUnsegmentedSourcePages: number } = PROCESSING_CEILING): number {
  return SEGMENTED_SOURCE_MIMES.has(mimeType.toLowerCase())
    ? ceiling.maxSourcePages
    : ceiling.maxUnsegmentedSourcePages;
}
