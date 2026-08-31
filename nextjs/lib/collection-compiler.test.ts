import { describe, expect, it } from "vitest";
import { compileCollectionCandidate, validateCollectionOcrInput, type CollectionOcrInput, type CollectionOcrRegion } from "./collection-compiler";
import { answerGroundedQuestion } from "./grounded-ask";

const WS = "pilot-proof";

function input(documentId: string, versionKey: string, text: string): CollectionOcrInput {
  const sanitizedKey = `immutable/${WS}/${WS}/${documentId}/${versionKey}/sanitized.pdf`;
  return {
    documentId,
    versionKey,
    sanitizedKey,
    ocrJsonKey: `immutable/${WS}/${WS}/${documentId}/${versionKey}/ocr.json`,
    pageCount: 1,
    text,
    inputSha256: `sha256:${versionKey}`,
    sourceImmutableKey: sanitizedKey,
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

  it("rejects missing immutable OCR bindings and unsafe collection cardinality", () => {
    expect(validateCollectionOcrInput({ documentId: "doc", text: "unbound" })).toBeNull();
    expect(() => compileCollectionCandidate([input("one", "a".repeat(64), "Only one.")])).toThrow(
      "collection_document_count_out_of_bounds",
    );
  });

  it("accepts only page-bound OCR evidence regions with real positive-area coordinates", () => {
    const source = input("region-doc", "c".repeat(64), "Region-bound evidence.");
    const regions = [{
      regionId: "native-p0001",
      pageIndex0: 0,
      pageNumber1: 1,
      order: 0,
      blockType: "paragraph",
      text: source.text,
      bbox1000: [100, 100, 900, 200],
      confidence: 1,
      authority: "informal",
    }];
    expect(validateCollectionOcrInput({ ...source, regions })).not.toBeNull();
    expect(validateCollectionOcrInput({
      ...source,
      regions: [{ ...regions[0], bbox1000: [100, 100, 100, 200] }],
    })).toBeNull();
  });

  it("emits page/bbox-bound rag chunks from OCR regions that grounded-ask can actually cite, and abstains for region-less documents", () => {
    // Regression: the compiler used to emit one whole-document rag chunk with no
    // page/bbox, which grounded-ask's parseChunk always rejects (it requires
    // pageNumber1 + bbox1000) — every compiled document produced zero usable
    // chunks. Chunks must come from OCR regions, one per region, or not at all.
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
    const financeInput: CollectionOcrInput = {
      ...input("doc-finance-regions", "d".repeat(64), financeRegions.map((region) => region.text).join("\n")),
      pageCount: 2,
      regions: financeRegions,
    };
    const securityInput = input("doc-security-noregions", "e".repeat(64), "Security access control protects private research evidence.");

    const candidate = compileCollectionCandidate([financeInput, securityInput]);
    const chunksFile = candidate.package.files.find((file) => file.path === "rag/chunks.jsonl");
    expect(chunksFile).toBeDefined();
    const chunkRows = chunksFile!.content.split("\n").filter(Boolean).map((row) => JSON.parse(row));

    // Only the region-bound document contributes chunks; the region-less one abstains honestly.
    expect(chunkRows).toHaveLength(2);
    expect(chunkRows.every((chunk) => chunk.sourceId === "doc-finance-regions")).toBe(true);
    expect(chunkRows.map((chunk) => chunk.pageNumber1).sort()).toEqual([1, 2]);
    for (const chunk of chunkRows) {
      expect(Array.isArray(chunk.bbox1000)).toBe(true);
      expect(typeof chunk.authority).toBe("string");
    }

    const groundedAnswer = answerGroundedQuestion(candidate, "governance compliance policy");
    expect(groundedAnswer?.status).toBe("grounded");
    expect(groundedAnswer?.citations[0]?.sourceId).toBe("doc-finance-regions");
    expect(groundedAnswer?.citations[0]?.pageNumber1).toBe(2);
    expect(groundedAnswer?.citations[0]?.bbox1000).toEqual([100, 400, 900, 600]);

    const abstainedAnswer = answerGroundedQuestion(candidate, "security access control research");
    expect(abstainedAnswer?.status).toBe("abstained");
    expect(abstainedAnswer?.reason).toBe("NO_REGION_BOUND_EVIDENCE_MATCH");
  });
});
