/*
  TAVONEL Compiler 1 and Compiler 1.1: the names of pinned compiler releases, never of a model
  (hard-proof 2026-10-27, FINAL-SPEC-HARD-PROOF §1 and its §7 addendum; the naming record is
  NAMING-T1.md in the Core receipts directory). TAVONEL trains no model, and the readers it runs are
  replaceable workers; what a name identifies is the set of pins below, by one digest.

  One record per release, newest first in COMPILER_RELEASES. Every pin is a value read from a
  receipt, never typed from memory, and a pin that cannot be read is left out rather than filled in.
  NAMING-T1 §3: a change to the reader or the routing policy moves the integer (Compiler 2); a change
  to recovery or validation moves the decimal (Compiler 1.1); a new name on the same pins is not a
  new release.

  WHAT EACH PIN'S RECEIPT IS
  - ocrImageDigest (both releases): `reader.imageDigest` in the four committed run receipts,
    public/proof-collection/specimens/*.run.json, which equals `QUALIFIED_OCR_IMAGE_DIGESTS` in
    lib/specimen-sources.ts (built from Foundation aa6b85dd, as that list records). Every one of
    those runs read a research reader, never the production OCR endpoint (`reader.host`): the two
    NASA SP-5079 runs a RunPod pod created for the run, the NACA and KMA runs a temporary RunPod
    serverless endpoint deleted after it. The production endpoint's configuration is not read
    (FINAL-SPEC §4, FH-04), so no receipt here says which image production OCR serves.
  - engineRelease and modelSha256 (both releases): the reader's own /health fields as the hard-proof
    run receipts recorded them before their POST (`reader.engineRelease`, `reader.modelSha256` in
    nasa-sp-5079-p039.run.json and -p074.run.json, 2026-10-27, the same image digest), byte for byte:
    the model hashes are bare hex there and stay bare hex here. The two 2026-10-19 receipts predate
    the field and are historical evidence; they are not rewritten.
  - coreReleaseDigest, Compiler 1 (sha256:ceed3860…): no receipt in this repository. The hard-proof
    lane read it from the live Core V2 /health at 2026-10-27T08:04:58Z and wrote the value down
    without keeping the response bytes, and re-derived it by re-hashing the 134 files of the staged
    release (hard-proof research/OCR-STAGE-RECIPE.md §3.0); neither record is committed to any
    repository. It was the production Core V2 release until deployment dpl_AsvGT4RAKac6XdC88rNqomf2b2Z4 (READY 2026-10-27T09:21:44.349Z).
  - coreReleaseDigest, Compiler 1.1 (sha256:b787dd86…): the live Core V2 /health response body,
    captured with curl at 2026-10-27T09:28:53Z after that deployment and committed byte for byte as
    public/proof-collection/compiler-releases/core-v2-health-2026-10-27T09-28-53Z.json
    (public/proof-collection/PROVENANCE.md, "Compiler releases"). Its source is Core commit
    b18757607b8fc1f32e479e5d3ed8b3bc3356aad3: /v2/compile serialises the candidate through the same
    integral-float normalisation it hashes, so a region confidence of exactly 1.0 passes
    Foundation's receipt check (lib/core-runtime-v2.ts, CORE_V2_RECEIPT_INVALID).
  lib/brand-copy.test.ts holds the reader pins equal to both NASA receipts and Compiler 1.1's Core
  pin equal to the committed /health body.

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
  rewritten. Which of the two production OCR serves stays open (NAMING-T1 §2.3 P1).

  THE DIGEST
  `digest` is the sha256 of the canonical JSON of `pins` (sorted keys, the same `canonicalize` as
  lib/collection-compiler.ts); lib/brand-copy.test.ts recomputes it for every release and prints the
  value it found. A pin added or changed moves the digest.

  This module holds constants only, with no Node import, because the changelog's client island
  reads it.
*/

const COMPILER_1_PINS = {
  ocrImageDigest: "sha256:8e6f6fa777fd9949745ce67b25d04f0a1aa74dfbf791204baf2b6b16c3931bd8",
  coreReleaseDigest: "sha256:ceed3860d3da5efad5b6dab199f131fa4925aa48a60c0ad62805d6b1958f211e",
  engineRelease: "rapidocr-3.9.2-ko-pass-nocls-v3-selftest",
  modelSha256: {
    "general-det": "090f04abcd9d9a7498bc4ebf677e4cb9bdce1fe4197ddb7e529f1ef44e1ff94f",
    "general-rec": "6f327246b50388f3c176ae304bd95767ea6dc0c9ae92153ef8cbe210b3c14884",
    "korean-rec": "cd6e2ea50f6943ca7271eb8c56a877a5a90720b7047fe9c41a2e541a25773c9b",
  },
} as const;

/*
  Each definition is printed on the first mention of its name on a page (NAMING-T1 §4, revised
  2026-10-27; EN at most 25 words, KO at most 25 어절). It names only what `pins` holds: the reader
  image (with the reader's engine release and model hashes) and the Core release. Compiler 1's
  sentence is NAMING-T1 §4's, verbatim; Compiler 1.1's keeps its form, name aside, up to the colon.
  Founder veto open on all four.
*/
export const COMPILER_RELEASE = {
  id: "compiler-1",
  name: "Compiler 1",
  pins: COMPILER_1_PINS,
  digest: "sha256:8787ecf9279cea444ab06835653efe168d42a1a15a29091234f8760983091a80",
  definition: {
    en: "Compiler 1 is a pinned TAVONEL compiler release, not a model: the reader image and the Core release it ran with, named by one digest.",
    ko: "Compiler 1은 모델이 아니라 고정된 TAVONEL 컴파일러 릴리스입니다. 판독기 이미지와 그때 실행된 Core 릴리스를 다이제스트 하나로 가리킵니다.",
  },
} as const;

/* FINAL-SPEC §7 addendum: the same reader pins, and the Core release with the receipt fix. */
export const COMPILER_RELEASE_1_1 = {
  id: "compiler-1-1",
  name: "Compiler 1.1",
  pins: { ...COMPILER_1_PINS, coreReleaseDigest: "sha256:b787dd86f6f57f92b76d91dcce1cba2d8064f5a75445f24010db0cc55f4598cd" },
  digest: "sha256:3af1c5f808b44d68fe3849fdc2747cc59b953df05879784fde7e1f044573fb76",
  definition: {
    en: "Compiler 1.1 is a pinned TAVONEL compiler release, not a model: Compiler 1's reader image and a newer Core release, named by one digest.",
    ko: "Compiler 1.1은 모델이 아니라 고정된 TAVONEL 컴파일러 릴리스입니다. Compiler 1의 판독기 이미지와 그 뒤에 나온 Core 릴리스를 다이제스트 하나로 가리킵니다.",
  },
} as const;

/** Newest first. */
export const COMPILER_RELEASES = [COMPILER_RELEASE_1_1, COMPILER_RELEASE] as const;

export type CompilerRelease = (typeof COMPILER_RELEASES)[number];
export type CompilerReleaseId = CompilerRelease["id"];

/** Compiler 1's definition, under the name the GDP.pdf page and the guards first read it by. */
export const COMPILER_RELEASE_DEFINITION = COMPILER_RELEASE.definition;

/** The release a run report or a changelog entry names, or null for a name that is not one. */
export function compilerRelease(id: unknown): CompilerRelease | null {
  return COMPILER_RELEASES.find((release) => release.id === id) ?? null;
}
