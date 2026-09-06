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
 */

/** Bytes the Cloudflare worker will read (`src/keys.ts` MAX_SOURCE_BYTES). */
const WORKER_MAX_SOURCE_BYTES = 5 * 1024 * 1024;
/** Bytes the Cloud Run rasterizer will accept (`app.py` MAX_INPUT_BYTES). */
const CDR_MAX_INPUT_BYTES = 5 * 1024 * 1024;
/** Pages the Cloud Run rasterizer will render (`app.py` MAX_PAGES). */
const CDR_MAX_PAGES = 80;

export const PROCESSING_CEILING = {
  /** No processor in the chain reads more than this, so nothing above it can ever be compiled. */
  maxSourceBytes: Math.min(WORKER_MAX_SOURCE_BYTES, CDR_MAX_INPUT_BYTES),
  /** Checked by the rasterizer after decoding; disclosed at intake, never enforced there. */
  maxSourcePages: CDR_MAX_PAGES,
} as const;

export const PROCESSING_CEILING_MIB = PROCESSING_CEILING.maxSourceBytes / (1024 * 1024);

/**
 * The same two ceilings as manifest tokens, so `/sources` and a refusal cannot drift apart.
 *
 * `words()` in the capability table renders a token by replacing underscores with spaces, so
 * these read as sentences in the Known limitations column.
 */
export const PROCESSING_CEILING_LIMITATIONS = [
  `at_most_${PROCESSING_CEILING_MIB}_mib_per_source`,
  `at_most_${PROCESSING_CEILING.maxSourcePages}_pages_per_source`,
] as const;

/** One sentence a customer can act on. Used by the refusal copy and the typed 413. */
export const PROCESSING_CEILING_SENTENCE =
  `This deployment processes sources up to ${PROCESSING_CEILING_MIB} MB and ${PROCESSING_CEILING.maxSourcePages} pages.`;
