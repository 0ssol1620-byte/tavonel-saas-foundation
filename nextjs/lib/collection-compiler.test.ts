import { describe, expect, it } from "vitest";
import { compileCollectionCandidate, validateCollectionOcrInput, type CollectionOcrInput } from "./collection-compiler";

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
});
