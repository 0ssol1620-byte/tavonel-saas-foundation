/*
  TAVONEL Compiler 1: the name of a pinned compiler release, never of a model (hard-proof
  2026-10-27, FINAL-SPEC-HARD-PROOF §1; the naming record is NAMING-T1.md in the Core receipts
  directory). TAVONEL trains no model, and the readers it runs are replaceable workers; what the
  name identifies is the set of pins below, by one digest.

  ONE record. Every pin is a value read from a receipt, never typed from memory, and a pin that
  cannot be read is left out rather than filled in.

  PINNED
  - ocrImageDigest: the deployed foundation-ocr-gpu image every committed specimen run names
    (`QUALIFIED_OCR_IMAGE_DIGESTS` in lib/specimen-sources.ts, `reader.imageDigest` in both
    public/proof-collection/specimens/*.run.json). Built from Foundation aa6b85dd.
  - coreReleaseDigest: the live Core /health `coreReleaseDigest`, read 2026-10-27 and re-derived by
    re-hashing the 134 files of the staged release (hard-proof research/OCR-STAGE-RECIPE.md §3.0).
    It appears nowhere else in this repository.

  LEFT OUT, AND WHY
  - engineRelease and modelSha256: neither committed specimen receipt records the worker's /health
    fields, and docs/evidence/ocr does not carry them. The source of aa6b85dd declares them
    (workers/foundation-ocr-gpu/app.py), but source is not a receipt of what ran. The next reader
    runs record /health in their run.json; these two pins are added from those receipts.
  - routerPolicy: the adaptive router's policy id and digest are control-plane rows, read per
    request by lib/adaptive-router-control-plane-store.ts; nextjs/lib holds no static policy id or
    digest. `tavonel.adaptive_router.v1` is a schema and `retrieval-route-policy/v1` a retrieval
    route version, and neither is a policy digest.
  - recoveryRecipeId: nextjs/lib holds no recovery recipe id.

  A DISCREPANCY, RECORDED AND NOT EDITED
  docs/evidence/ocr/release.json still names the 2026-08-29 qualification image
  sha256:3d1845563c7d80bad01d6a050be4e9d7b2c34dbee7ccbe90cb246255194f47a8 (asia-northeast3
  Artifact Registry), not the RunPod image pinned here. That file is historical evidence and is not
  rewritten; which image serves production is the one the specimen receipts name.

  THE DIGEST
  `digest` is the sha256 of the canonical JSON of `pins` (sorted keys, the same `canonicalize` as
  lib/collection-compiler.ts); lib/brand-copy.test.ts recomputes it and prints the value it found.
  A pin added or changed moves the digest. A new name on the same pins is not a new release.

  This module holds constants only, with no Node import, because the changelog's client island
  reads it.
*/

export const COMPILER_RELEASE = {
  id: "compiler-1",
  name: "Compiler 1",
  pins: {
    ocrImageDigest: "sha256:8e6f6fa777fd9949745ce67b25d04f0a1aa74dfbf791204baf2b6b16c3931bd8",
    coreReleaseDigest: "sha256:ceed3860d3da5efad5b6dab199f131fa4925aa48a60c0ad62805d6b1958f211e",
  },
  digest: "sha256:6ea72f7d10641f0f9bc99348f6ab032971dc5283316943a8181e97d79b0e1781",
} as const;

export type CompilerReleaseId = typeof COMPILER_RELEASE.id;

/**
 * The definition, printed on the first mention of the name on a page (NAMING-T1 §4; EN 25 words,
 * KO 21 어절). Founder veto open on both.
 */
export const COMPILER_RELEASE_DEFINITION = {
  en: "Compiler 1 is a pinned TAVONEL compiler release, not a model: fixed readers, routing policy, recovery and validation, identified by one digest on every receipt.",
  ko: "Compiler 1은 모델이 아니라 고정된 TAVONEL 컴파일러 릴리스입니다. 판독기, 라우팅 정책, 복구, 검증을 한 묶음으로 고정하고 모든 영수증에 같은 다이제스트로 표시합니다.",
} as const;

/** The release a run report or a changelog entry names, or null for a name that is not one. */
export function compilerRelease(id: unknown): typeof COMPILER_RELEASE | null {
  return id === COMPILER_RELEASE.id ? COMPILER_RELEASE : null;
}
