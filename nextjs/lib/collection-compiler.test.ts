import { describe, expect, it } from "vitest";
import {
  EXTRACTION_BUDGET_REACHED,
  EXTRACTION_CANDIDATE_BUDGET,
  compileCollectionCandidate,
  validateCollectionOcrInput,
  type CollectionOcrInput,
  type CollectionOcrRegion,
} from "./collection-compiler";
import { validateDownloadableCollectionArtifact, validatePromotableCollectionArtifact } from "./collection-download";
import { COMPILE_MAX_DOCUMENTS } from "./compile-limits";
import { answerGroundedQuestion } from "./grounded-ask";

const WS = "pilot-proof";

function region(text: string, index: number): CollectionOcrRegion {
  return {
    regionId: `native-p${String(index + 1).padStart(4, "0")}`,
    pageIndex0: index,
    pageNumber1: index + 1,
    order: index,
    blockType: "paragraph",
    text,
    bbox1000: [100, 100, 900, 200],
    confidence: 1,
    authority: "informal",
  };
}

/*
  The helper binds one region to the text by default.

  Extraction is per region now, so an input with none produces no claims and no entities at all --
  which is the honest abstention the contract publishes, and which the tests below assert
  deliberately rather than by accident. Passing `null` asks for a region-less document.
*/
function input(documentId: string, versionKey: string, text: string, regions?: CollectionOcrRegion[] | null): CollectionOcrInput {
  const sanitizedKey = `immutable/${WS}/${WS}/${documentId}/${versionKey}/sanitized.pdf`;
  const bound = regions === undefined ? [region(text, 0)] : regions;
  return {
    documentId,
    versionKey,
    sanitizedKey,
    ocrJsonKey: `immutable/${WS}/${WS}/${documentId}/${versionKey}/ocr.json`,
    pageCount: bound === null ? 1 : Math.max(...bound.map((item) => item.pageNumber1)),
    text: bound === null ? text : bound.map((item) => item.text).join("\n").trim(),
    inputSha256: `sha256:${versionKey}`,
    sourceImmutableKey: sanitizedKey,
    ...(bound === null ? {} : { regions: bound }),
  };
}

/** What a compiled candidate needs before the download and promote gates will look at it. */
function stored(artifact: ReturnType<typeof compileCollectionCandidate>) {
  return {
    ...artifact,
    coreExecution: {
      status: artifact.lifecycle === "review_required" ? "review_required" as const : "completed" as const,
      runtime: "tavonel-collection-compiler-ts-v1/test",
      worldStateId: null,
      receipt: {
        requestId: `test-${artifact.collectionId}`,
        outputSha256: artifact.manifestDigest,
        candidatePromotion: false as const,
      },
    },
  };
}

describe("Foundation collection candidate compiler", () => {
  it("builds a deterministic candidate package with directory, ontology, graph and evidence roots", () => {
    const inputs = [
      input("doc-finance", "a".repeat(64), "Quarterly financial revenue increased. The Board approved the policy."),
      input("doc-security", "b".repeat(64), "Security access control protects private research evidence."),
    ];
    const first = compileCollectionCandidate(inputs);
    const second = compileCollectionCandidate([...inputs].reverse());

    expect(first).toEqual(second);
    expect(first.executionAuthority).toBe("tavonel-foundation-core-runtime-v1");
    expect(first.lifecycle).toBe("candidate");
    expect(first.candidatePromotion).toBe(false);
    expect(first.sourceDocuments).toHaveLength(2);
    expect(first.directoryPlan.map((entry) => entry.path)).toEqual(expect.arrayContaining([
      "Sources",
      "Topics/Finance.md",
      "Topics/Security.md",
      "MOCs/Home.md",
      "Packages/knowledge-package.json",
    ]));
    expect(first.ontology.nodes.some((node) => node.kind === "Document")).toBe(true);
    expect(first.ontology.edges.some((edge) => edge.type === "discusses_topic")).toBe(true);
    expect(first.package.roots).toEqual(["source", "canonical", "obsidian", "ontology", "graph", "rag", "provenance", "validation"]);
    expect(first.package.files.map((file) => file.path)).toEqual(expect.arrayContaining([
      "ontology/knowledge.ttl",
      "ontology/knowledge.jsonld",
      "graph/nodes.csv",
      "graph/relationships.csv",
      "validation/report.json",
    ]));
    expect(first.validation.status).toBe("passed");
    expect(first.manifestDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  /*
    One document is a world.

    This test used to assert the opposite — that a single input threw
    `collection_document_count_out_of_bounds` — which is what a customer experienced as a file
    that uploaded, read, and produced nothing. The floor of two was a compiler detail with no
    product reason behind it. The ceiling is still enforced, because the synchronous compile
    route has a 60-second budget and a larger corpus needs durable job orchestration rather
    than a larger constant.
  */
  it("compiles a single document into a candidate world", () => {
    const one = compileCollectionCandidate([input("one", "a".repeat(64), "Only one.")]);
    expect(one.sourceDocuments).toHaveLength(1);
    expect(one.manifestDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("rejects missing immutable OCR bindings and a corpus past the ceiling", () => {
    expect(validateCollectionOcrInput({ documentId: "doc", text: "unbound" })).toBeNull();
    const tooMany = Array.from({ length: COMPILE_MAX_DOCUMENTS + 1 }, (_item, index) =>
      input(`doc-${index}`, String(index).padStart(64, "0"), `Document ${index}.`));
    expect(() => compileCollectionCandidate(tooMany)).toThrow(
      "collection_document_count_out_of_bounds",
    );
  });

  it("accepts only page-bound OCR evidence regions with real positive-area coordinates", () => {
    const source = input("region-doc", "c".repeat(64), "Region-bound evidence.");
    expect(validateCollectionOcrInput(source)).not.toBeNull();
    expect(validateCollectionOcrInput({
      ...source,
      regions: [{ ...source.regions![0], bbox1000: [100, 100, 100, 200] }],
    })).toBeNull();
    // A present-but-empty region list is a reader that claimed to record regions and did not.
    expect(validateCollectionOcrInput({ ...source, regions: [] })).toBeNull();
  });

  it("emits page/bbox-bound rag chunks from OCR regions that grounded-ask can actually cite", () => {
    // Regression: the compiler used to emit one whole-document rag chunk with no
    // page/bbox, which grounded-ask's parseChunk always rejects (it requires
    // pageNumber1 + bbox1000) — every compiled document produced zero usable
    // chunks. Chunks must come from OCR regions, one per region.
    const financeRegions: CollectionOcrRegion[] = [
      {
        regionId: "native-p0001",
        pageIndex0: 0,
        pageNumber1: 1,
        order: 0,
        blockType: "paragraph",
        text: "Quarterly financial revenue increased significantly across the fiscal year.",
        bbox1000: [100, 100, 900, 300],
        confidence: 1,
        authority: "official",
      },
      {
        regionId: "native-p0002",
        pageIndex0: 1,
        pageNumber1: 2,
        order: 1,
        blockType: "paragraph",
        text: "The Board approved the governance compliance policy for the organization.",
        bbox1000: [100, 400, 900, 600],
        confidence: 1,
        authority: "informal",
      },
    ];
    const financeInput = input("doc-finance-regions", "d".repeat(64), "", financeRegions);
    const securityInput = input("doc-security-regions", "e".repeat(64), "Security access control protects private research evidence.");

    const candidate = compileCollectionCandidate([financeInput, securityInput]);
    const chunksFile = candidate.package.files.find((file) => file.path === "rag/chunks.jsonl");
    expect(chunksFile).toBeDefined();
    const chunkRows = chunksFile!.content.split("\n").filter(Boolean).map((row) => JSON.parse(row));

    expect(chunkRows).toHaveLength(3);
    expect(chunkRows.filter((chunk) => chunk.sourceId === "doc-finance-regions")).toHaveLength(2);
    for (const chunk of chunkRows) {
      expect(Array.isArray(chunk.bbox1000)).toBe(true);
      expect(typeof chunk.authority).toBe("string");
    }

    const groundedAnswer = answerGroundedQuestion(candidate, "governance compliance policy");
    expect(groundedAnswer?.status).toBe("grounded");
    expect(groundedAnswer?.citations[0]?.sourceId).toBe("doc-finance-regions");
    expect(groundedAnswer?.citations[0]?.pageNumber1).toBe(2);
    expect(groundedAnswer?.citations[0]?.bbox1000).toEqual([100, 400, 900, 600]);

    // A claim is bound to the region it was read from, not to every region whose words match.
    const financeChunk = chunkRows.find((chunk) => chunk.sourceId === "doc-finance-regions" && chunk.pageNumber1 === 1)!;
    const governanceChunk = chunkRows.find((chunk) => chunk.sourceId === "doc-finance-regions" && chunk.pageNumber1 === 2)!;
    expect(financeChunk.claimIds).toHaveLength(1);
    expect(governanceChunk.claimIds).toHaveLength(1);
    expect(financeChunk.claimIds[0]).not.toBe(governanceChunk.claimIds[0]);
  });
});

/*
  D7-03 and D7-04, on the compiler's half of the split.

  A document read before region capture existed has no locator, and the compiler abstains: no
  retrieval unit, no guessed page, no guessed box -- which is the sentence `compiler-contract.ts`
  publishes. What was missing is the reporting. `evidenceCoverage: true` was a literal, so a World
  with a document contributing no evidence at all shipped as `passed` and the customer had no way
  to see which of their sources had gone in without one. The production route refuses this input
  outright (OCR_REGIONS_REQUIRED, see collection-compile-run.test.ts); the compiler is the second
  line, and it says so rather than passing.
*/
describe("a document compiled without regions", () => {
  const anchored = input("doc-anchored", "3".repeat(64), "The Board approved the governance compliance policy for the organization.");
  const unanchored = input("doc-unanchored", "4".repeat(64), "Security access control protects private research evidence.", null);
  const artifact = compileCollectionCandidate([anchored, unanchored]);

  it("contributes no retrieval unit rather than a guessed page or box", () => {
    const chunks = artifact.package.files.find((file) => file.path === "rag/chunks.jsonl")!
      .content.split("\n").filter(Boolean).map((row) => JSON.parse(row));
    expect(chunks.every((chunk) => chunk.sourceId === "doc-anchored")).toBe(true);
    expect(answerGroundedQuestion(artifact, "security access control research")?.reason)
      .toBe("NO_REGION_BOUND_EVIDENCE_MATCH");
  });

  it("reports the gap as evidenceCoverage false with a named reason", () => {
    expect(artifact.validation.evidenceCoverage).toBe(false);
    expect(artifact.validation.reviewReasons).toContain("EVIDENCE_COVERAGE_INCOMPLETE");
    expect(artifact.validation.status).toBe("review_required");
    expect(artifact.lifecycle).toBe("review_required");
    expect(validatePromotableCollectionArtifact(stored(artifact), artifact.collectionId)).toBeNull();
  });
});

/*
  D7-02. The 50,000-character slice is gone, and nothing quietly replaced it.

  `normalizeText` used to end in `.slice(0, 50_000)` and told no one. Regions were never
  truncated, so `rag/chunks.jsonl` covered a long document while the knowledge graph covered its
  first twenty pages: two surfaces of one product disagreeing about one file, reported as
  `validation.status: passed`.
*/
describe("a long document is compiled whole or refused, never quietly halved", () => {
  const longRegions = Array.from({ length: 400 }, (_item, index) =>
    region(`Observation ${index} records that the feedwater pump ran within tolerance for the whole of this reporting interval and needed no intervention.`, index));
  const longInput = input("doc-long", "f".repeat(64), "", longRegions);

  it("reads past the old bound instead of stopping at it", () => {
    expect(longInput.text.length).toBeGreaterThan(50_000);
    const artifact = compileCollectionCandidate([longInput]);
    expect(artifact.validation.status).toBe("passed");

    // The claim from the last region exists, which the 50,000-character slice made impossible.
    const claims = artifact.ontology.nodes.filter((node) => node.kind === "Claim").map((node) => node.label);
    expect(claims).toContain("Observation 399 records that the feedwater pump ran within tolerance for the whole of this reporting interval and needed no intervention.");
  });

  it("reports the character count of what it actually read", () => {
    const artifact = compileCollectionCandidate([longInput]);
    const recorded = artifact.sourceDocuments[0].textCharacters;
    // The sum of the region texts, plus the one separator between each pair.
    const fromRegions = longRegions.reduce((total, item) => total + item.text.length, 0) + longRegions.length - 1;
    expect(recorded).toBe(fromRegions);
    expect(recorded).toBeGreaterThan(50_000);
  });

  /* D7-01: claim count follows the source, rather than a constant sized for a 470-character fixture. */
  it("emits claims in proportion to the source instead of four of them", () => {
    const artifact = compileCollectionCandidate([longInput]);
    expect(artifact.validation.counts.claims).toBe(400);
    expect(artifact.validation.counts.candidatesConsidered).toBe(artifact.validation.counts.claims
      + artifact.validation.counts.entities
      + artifact.validation.counts.topics);
  });
});

/*
  D7-01. The budget that remains is visible.

  A bound is still needed -- the package is materialised in full under collection-download's
  16 MiB ceiling -- but a bound nobody is told about is indistinguishable from completeness. Going
  past it is a named reason, a lifecycle, and two numbers side by side.
*/
describe("the extraction budget is disclosed rather than silently applied", () => {
  const sentences = Array.from({ length: EXTRACTION_CANDIDATE_BUDGET + 200 }, (_item, index) =>
    `Observation number ${index} was recorded at the station on the day of the inspection.`);
  const overBudget = input("doc-over-budget", "0".repeat(64), "", [region(sentences.join(" "), 0)]);

  it("names the loss, flips the lifecycle, and refuses promotion", () => {
    const artifact = compileCollectionCandidate([overBudget]);

    expect(artifact.validation.counts.candidatesConsidered!).toBeGreaterThan(EXTRACTION_CANDIDATE_BUDGET);
    expect(artifact.validation.reviewReasons).toContain(EXTRACTION_BUDGET_REACHED);
    expect(artifact.reviewReasons).toContain(EXTRACTION_BUDGET_REACHED);
    expect(artifact.validation.status).toBe("review_required");
    expect(artifact.lifecycle).toBe("review_required");

    const emitted = artifact.validation.counts.topics + artifact.validation.counts.entities + artifact.validation.counts.claims;
    expect(emitted).toBe(EXTRACTION_CANDIDATE_BUDGET);
    expect(artifact.validation.counts.candidatesConsidered!).toBeGreaterThan(emitted);

    // The package the customer downloads says the same thing the artifact does.
    const report = JSON.parse(artifact.package.files.find((file) => file.path === "validation/report.json")!.content);
    expect(report.status).toBe("review_required");
    expect(report.reviewReasons).toContain(EXTRACTION_BUDGET_REACHED);

    const candidate = stored(artifact);
    expect(validateDownloadableCollectionArtifact(candidate, artifact.collectionId)).not.toBeNull();
    expect(validatePromotableCollectionArtifact(candidate, artifact.collectionId)).toBeNull();
  }, 60_000);

  it("cites no claim the budget refused to emit", () => {
    const artifact = compileCollectionCandidate([overBudget]);
    const emittedIds = new Set(artifact.ontology.nodes.filter((node) => node.kind === "Claim").map((node) => node.id));
    const chunks = artifact.package.files.find((file) => file.path === "rag/chunks.jsonl")!
      .content.split("\n").filter(Boolean).map((row) => JSON.parse(row));
    for (const chunk of chunks) {
      for (const claimId of chunk.claimIds) expect(emittedIds.has(claimId)).toBe(true);
    }
  }, 60_000);
});

/*
  D7-04. The four integrity properties are computed, not declared.

  They were `true as const` in the artifact and `true` in the customer's validation/report.json,
  with no check behind either. `scripts/compiled-world/validate.mjs` -- the one real checker --
  was imported by a test and by nothing on the emit path.
*/
describe("the validation record is derived from the package it describes", () => {
  const artifact = compileCollectionCandidate([
    input("doc-a", "1".repeat(64), "The pump was inspected and the reading stayed inside the governance policy limits."),
    input("doc-b", "2".repeat(64), "Security access control protects the private research evidence of the site."),
  ]);

  it("passes only when every check it names actually holds", () => {
    expect(artifact.validation.deterministicMaterialization).toBe(true);
    expect(artifact.validation.sourceCoverage).toBe(true);
    expect(artifact.validation.evidenceCoverage).toBe(true);
    expect(artifact.validation.immutableInputsOnly).toBe(true);
    expect(artifact.validation.status).toBe("passed");
    expect(artifact.validation.reviewReasons).toEqual([]);
  });

  it("writes the same verdict into the package the customer downloads", () => {
    const report = JSON.parse(artifact.package.files.find((file) => file.path === "validation/report.json")!.content);
    expect(report.status).toBe(artifact.validation.status);
    expect(report.checks).toEqual({
      deterministicMaterialization: true,
      sourceCoverage: true,
      evidenceCoverage: true,
      immutableInputsOnly: true,
    });
    expect(report.counts).toEqual(artifact.validation.counts);
  });
});
