/*
  The two things both compile paths have to agree on.

  There are two compilers behind one product promise. `nextjs/lib/collection-compiler.ts` runs in
  this repository, over regions it was handed; `nextjs/lib/core-runtime-v2.ts` projects what the
  Python Core sent back. They were written months apart and drifted in the two places that matter
  most: whether a document without regions may be compiled at all, and who decides that a compiled
  World is sound. This file is the one copy of both answers, so the next drift is a type error
  rather than a customer following a citation to a page that does not say it.

  Nothing here validates a package -- `nextjs/scripts/compiled-world/validate.mjs` does that, and
  it stays dependency-light so a customer holding the package can run it. This is the contract the
  two callers share, not a second checker.
*/

/**
 * A locator is read, never synthesised.
 *
 * The v2 wire used to satisfy the Core's "at least one region" schema by inventing a region that
 * claimed page 1 and covered the whole document, which put every citation from a legacy-OCR
 * document on the cover page. Refusing costs the customer one compile; inventing costs them the
 * evidence trail, which is the product.
 */
export const OCR_REGIONS_REQUIRED = "OCR_REGIONS_REQUIRED" as const;

/** The document ids that carry no region, in input order. Empty means every document is anchored. */
export function documentsWithoutRegions(
  documents: ReadonlyArray<{ documentId: string; regions?: unknown }>,
): string[] {
  return documents
    .filter((document) => !Array.isArray(document.regions) || document.regions.length === 0)
    .map((document) => document.documentId);
}

/**
 * The regions a document carries. None is none.
 *
 * One line, in one place, because it is the line both compile paths got wrong in opposite
 * directions: `collection-compiler.ts` abstained and `core-runtime-v2.ts` invented. Spelling the
 * rule twice is what let them drift; spelling it once is what stops the next drift.
 */
export function regionsOrNone<T>(document: { regions?: readonly T[] }): readonly T[] {
  return document.regions ?? [];
}

/**
 * The four integrity properties a compiled World declares.
 *
 * `boolean`, not the literal `true` the site-side type used to demand. The literal is why the
 * projection dropped the Core's own validation record: a record that can say `false` had nowhere
 * to go, so the presentation layer overwrote the authority's verdict with four green checks.
 */
export type CompiledWorldValidationChecks = {
  /** The package's four graph serialisations describe one graph, and every file hashes to what it says. */
  deterministicMaterialization: boolean;
  /** Every input document is bound by version digest and reaches the model as an object. */
  sourceCoverage: boolean;
  /** Every document produced at least one region-anchored retrieval unit, and no evidence reference dangles. */
  evidenceCoverage: boolean;
  /** Every input names an immutable object key whose digest is the version key that was read. */
  immutableInputsOnly: boolean;
};

export const COMPILED_WORLD_VALIDATION_CHECKS = [
  "deterministicMaterialization",
  "sourceCoverage",
  "evidenceCoverage",
  "immutableInputsOnly",
] as const;

/** The review reason a false check carries, so a `review_required` artifact always names why. */
export const VALIDATION_CHECK_REVIEW_REASON: Record<keyof CompiledWorldValidationChecks, string> = {
  deterministicMaterialization: "DETERMINISTIC_MATERIALIZATION_UNPROVEN",
  sourceCoverage: "SOURCE_COVERAGE_INCOMPLETE",
  evidenceCoverage: "EVIDENCE_COVERAGE_INCOMPLETE",
  immutableInputsOnly: "IMMUTABLE_INPUTS_ONLY_UNPROVEN",
};

/**
 * Read a validation record, or refuse it.
 *
 * `null` for a missing or non-boolean field, and the caller turns that into a refusal. Defaulting
 * an absent field to `true` is the bug this replaces: it makes an unreported check indistinguishable
 * from a passed one, which is worse than no check because the customer can quote it back.
 */
export function readCompiledWorldValidationChecks(value: unknown): CompiledWorldValidationChecks | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const checks = {} as CompiledWorldValidationChecks;
  for (const name of COMPILED_WORLD_VALIDATION_CHECKS) {
    const field = record[name];
    if (typeof field !== "boolean") return null;
    checks[name] = field;
  }
  return checks;
}

/** The reasons a set of checks contributes, sorted so an artifact is byte-stable. */
export function validationCheckReviewReasons(checks: CompiledWorldValidationChecks): string[] {
  return COMPILED_WORLD_VALIDATION_CHECKS
    .filter((name) => !checks[name])
    .map((name) => VALIDATION_CHECK_REVIEW_REASON[name])
    .sort();
}
