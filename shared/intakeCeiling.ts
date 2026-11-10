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
 *   2. The page ceiling cannot be checked at intake, because intake deliberately never decodes
 *      the document. It is disclosed rather than enforced, which is why it appears in
 *      `knownLimitations` and in the refusal a customer reads, and not in an admission check.
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

/*
  D1 stage 1 (PROGRAM-2026-11-04 §4.D, "단계 1: 25 MiB / 200쪽"). The same three copies for a
  processor deployed with TAVONEL_INTAKE_CEILING_STAGE=1: worker `STAGE_1_MAX_SOURCE_BYTES`,
  rasterizer `STAGE_1_MAX_INPUT_BYTES` / `STAGE_1_MAX_PAGES`. §4.D calls the numbers measurements,
  not targets: they stay here, unused by intake, until the stage-1 gates have been measured.
*/
const WORKER_STAGE_1_MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const CDR_STAGE_1_MAX_INPUT_BYTES = 25 * 1024 * 1024;
const CDR_STAGE_1_MAX_PAGES = 200;

/*
  Large-source bytes (docs/adr/0006-segmented-large-sources.md): the bytes the worker
  (`LARGE_SOURCE_MAX_BYTES`) and the rasterizer (`LARGE_SOURCE_MAX_INPUT_BYTES`) read when the CDR
  reads the source from R2 itself (FOUNDATION_SOURCE_TRANSPORT=presigned). A target, not a stage:
  no stage admits it, and intake does not read it, until a 50 MiB source has been measured end to end.
*/
const WORKER_LARGE_SOURCE_MAX_BYTES = 50 * 1024 * 1024;
const CDR_LARGE_SOURCE_MAX_INPUT_BYTES = 50 * 1024 * 1024;
export const LARGE_SOURCE_TARGET_BYTES = Math.min(WORKER_LARGE_SOURCE_MAX_BYTES, CDR_LARGE_SOURCE_MAX_INPUT_BYTES);

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

/** Everything a stage decides, under the names this module exports for the active stage. */
export function intakeCeilingFor(stage: IntakeCeilingStage) {
  const ceiling = INTAKE_CEILING_STAGES[stage];
  const mib = ceiling.maxSourceBytes / (1024 * 1024);
  return {
    PROCESSING_CEILING: ceiling,
    PROCESSING_CEILING_MIB: mib,
    /*
      The same two ceilings as manifest tokens, so `/sources` and a refusal cannot drift apart.
      `words()` in the capability table renders a token by replacing underscores with spaces, so
      these read as sentences in the Known limitations column.
    */
    PROCESSING_CEILING_LIMITATIONS: [
      `at_most_${mib}_mib_per_source`,
      `at_most_${ceiling.maxSourcePages}_pages_per_source`,
    ] as const,
    /** One sentence a customer can act on. Used by the refusal copy and the typed 413. */
    PROCESSING_CEILING_SENTENCE:
      `TAVONEL processes sources up to ${mib} MB and ${ceiling.maxSourcePages} pages.`,
    /** The largest `ocr.json` the worker stores for this stage, and so the compile's read bound. */
    OCR_JSON_MAX_BYTES: (OCR_JSON_BYTES_FOR_80_PAGES / 80) * ceiling.maxSourcePages,
  };
}

const ACTIVE = intakeCeilingFor(INTAKE_CEILING_STAGE);

export const PROCESSING_CEILING = ACTIVE.PROCESSING_CEILING;
export const PROCESSING_CEILING_MIB = ACTIVE.PROCESSING_CEILING_MIB;
export const PROCESSING_CEILING_LIMITATIONS = ACTIVE.PROCESSING_CEILING_LIMITATIONS;
export const PROCESSING_CEILING_SENTENCE = ACTIVE.PROCESSING_CEILING_SENTENCE;
export const OCR_JSON_MAX_BYTES = ACTIVE.OCR_JSON_MAX_BYTES;
