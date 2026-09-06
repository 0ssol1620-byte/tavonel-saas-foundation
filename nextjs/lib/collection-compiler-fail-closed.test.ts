import { describe, expect, it, vi } from "vitest";

/*
  D7-04, adversarially: does the compiler honour the checker, or its own optimism?

  The artifact's four integrity booleans and its `passed` status used to be literals. The one real
  checker in the repository, `scripts/compiled-world/validate.mjs`, computed EVIDENCE_DANGLING,
  ID_DUPLICATE, RELATION_DANGLING and degenerate-coordinate errors -- and was imported by a test
  and by nothing on the emit path. So a package whose evidence references pointed at objects that
  are not there shipped with a green validation/report.json, and the reviewer who is meant to
  approve it before promotion was shown a constant.

  The compiler is deterministic, so a compiled package cannot be given a dangling reference
  through its inputs; the way to ask "is the verdict honoured" is to make the checker return one.
  The mock is the fault injection, not the subject: the assertions are all about what the compiler
  then does with it.
*/
vi.mock("../scripts/compiled-world/validate.mjs", () => ({
  validateCompiledWorldPackage: () => ({
    ok: false,
    errors: [{ code: "EVIDENCE_DANGLING", detail: "claim-0000 -> evidence-0000" }],
    warnings: [],
    notices: [],
    counts: null,
  }),
}));

const { compileCollectionCandidate } = await import("./collection-compiler");
const { validateDownloadableCollectionArtifact, validatePromotableCollectionArtifact } = await import("./collection-download");

const versionKey = "9".repeat(64);
const sanitizedKey = `immutable/pilot/pilot/doc-dangling/${versionKey}/sanitized.pdf`;
const text = "The pump was inspected and the reading stayed inside the policy limits.";

const artifact = compileCollectionCandidate([{
  documentId: "doc-dangling",
  versionKey,
  sanitizedKey,
  ocrJsonKey: sanitizedKey.replace("sanitized.pdf", "ocr.json"),
  pageCount: 1,
  text,
  inputSha256: `sha256:${versionKey}`,
  sourceImmutableKey: sanitizedKey,
  regions: [{
    regionId: "native-p0001",
    pageIndex0: 0,
    pageNumber1: 1,
    order: 0,
    blockType: "paragraph",
    text,
    bbox1000: [100, 100, 900, 200],
    confidence: 1,
    authority: "informal",
  }],
}]);

const stored = {
  ...artifact,
  coreExecution: {
    status: "review_required" as const,
    runtime: "tavonel-collection-compiler-ts-v1/test",
    worldStateId: null,
    receipt: {
      requestId: `test-${artifact.collectionId}`,
      outputSha256: artifact.manifestDigest,
      candidatePromotion: false as const,
    },
  },
};

describe("a package the checker rejects", () => {
  it("compiles to review_required rather than passed", () => {
    expect(artifact.validation.status).toBe("review_required");
    expect(artifact.lifecycle).toBe("review_required");
  });

  it("names the failing check and the code that failed it", () => {
    expect(artifact.validation.evidenceCoverage).toBe(false);
    expect(artifact.validation.reviewReasons).toContain("EVIDENCE_DANGLING");
    expect(artifact.validation.reviewReasons).toContain("EVIDENCE_COVERAGE_INCOMPLETE");
    // Unrelated checks are not tarred with it: a false verdict has to say what was false.
    expect(artifact.validation.immutableInputsOnly).toBe(true);
  });

  it("says the same thing in the file the customer downloads", () => {
    const report = JSON.parse(artifact.package.files.find((file) => file.path === "validation/report.json")!.content);
    expect(report.status).toBe("review_required");
    expect(report.checks.evidenceCoverage).toBe(false);
    expect(report.reviewReasons).toEqual(artifact.validation.reviewReasons);
  });

  it("is readable for review and refused for promotion", () => {
    expect(validateDownloadableCollectionArtifact(stored, artifact.collectionId)).not.toBeNull();
    expect(validatePromotableCollectionArtifact(stored, artifact.collectionId)).toBeNull();
  });
});
