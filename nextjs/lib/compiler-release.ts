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
  - engineRelease and modelSha256: the reader's own /health fields, as the hard-proof run receipts
    recorded them before their POST (`reader.engineRelease`, `reader.modelSha256` in
    public/proof-collection/specimens/nasa-sp-5079-p039.run.json and -p074.run.json, 2026-10-27,
    the same image digest), byte for byte: the model hashes are bare hex there and stay bare hex
    here. lib/brand-copy.test.ts holds both pins equal to both receipts. The two 2026-10-19 receipts
    predate the field and are historical evidence; they are not rewritten.

  LEFT OUT, AND WHY
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
    engineRelease: "rapidocr-3.9.2-ko-pass-nocls-v3-selftest",
    modelSha256: {
      "general-det": "090f04abcd9d9a7498bc4ebf677e4cb9bdce1fe4197ddb7e529f1ef44e1ff94f",
      "general-rec": "6f327246b50388f3c176ae304bd95767ea6dc0c9ae92153ef8cbe210b3c14884",
      "korean-rec": "cd6e2ea50f6943ca7271eb8c56a877a5a90720b7047fe9c41a2e541a25773c9b",
    },
  },
  digest: "sha256:8787ecf9279cea444ab06835653efe168d42a1a15a29091234f8760983091a80",
} as const;

export type CompilerReleaseId = typeof COMPILER_RELEASE.id;

/**
 * The definition, printed on the first mention of the name on a page (NAMING-T1 §4, revised
 * 2026-10-27; EN 25 words, KO 17 어절). It names only what `pins` holds: the reader image (with the
 * reader's engine release and model hashes) and the Core release. The earlier sentence also named
 * routing policy, recovery, validation and "every receipt", none of which this record pins
 * (orchestrator decision under the 2026-10-17 delegation). Founder veto open on both.
 */
export const COMPILER_RELEASE_DEFINITION = {
  en: "Compiler 1 is a pinned TAVONEL compiler release, not a model: the reader image and the Core release it ran with, named by one digest.",
  ko: "Compiler 1은 모델이 아니라 고정된 TAVONEL 컴파일러 릴리스입니다. 판독기 이미지와 그때 실행된 Core 릴리스를 다이제스트 하나로 가리킵니다.",
} as const;

/** The release a run report or a changelog entry names, or null for a name that is not one. */
export function compilerRelease(id: unknown): typeof COMPILER_RELEASE | null {
  return id === COMPILER_RELEASE.id ? COMPILER_RELEASE : null;
}
