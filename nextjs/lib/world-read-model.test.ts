import { describe, expect, it } from "vitest";
import { compileCollectionCandidate, type CollectionOcrInput } from "./collection-compiler";
import { buildWorldReadModel, selectWorldEvidence } from "./world-read-model";

function input(documentId: string, digest: string, text: string): CollectionOcrInput {
  return {
    documentId,
    versionKey: digest,
    sanitizedKey: `immutable/ws-ultimate/ws-ultimate/documents/${documentId}/${digest}/sanitized.pdf`,
    ocrJsonKey: `immutable/ws-ultimate/ws-ultimate/documents/${documentId}/${digest}/ocr.json`,
    pageCount: 1,
    text,
    inputSha256: `sha256:${digest}`,
    sourceImmutableKey: `immutable/ws-ultimate/ws-ultimate/documents/${documentId}/${digest}/sanitized.pdf`,
    regions: [{
      regionId: `${documentId}-p1-b1`,
      pageIndex0: 0,
      pageNumber1: 1,
      order: 0,
      blockType: "paragraph",
      text,
      bbox1000: [80, 120, 920, 320],
      confidence: 0.99,
      authority: "contractual",
    }],
  };
}

function artifact() {
  const base = compileCollectionCandidate([
    input("contract-a", "a".repeat(64), "ACME Corporation shall pay every valid invoice within 30 calendar days."),
    input("contract-b", "b".repeat(64), "ACME Corporation requires written approval before changing payment terms."),
  ]);
  return {
    ...base,
    coreExecution: {
      status: "completed",
      runtime: "tavonel-python-core-v2",
      worldStateId: "world-state-12",
      receipt: {
        requestId: "core-test-ultimate",
        outputSha256: `sha256:${"c".repeat(64)}`,
        candidatePromotion: false,
      },
    },
  };
}

describe("WorldReadModel", () => {
  it("exposes only compiled nodes, relations, and exact page+bbox evidence", () => {
    const source = artifact();
    const model = buildWorldReadModel(source, source.collectionId, { origin: "deterministic_sample" });
    expect(model?.contract).toEqual({
      origin: "deterministic_sample",
      deterministicSample: true,
      realObjectsOnly: true,
      missingData: "not_yet",
    });
    expect(model?.objects.map((object) => object.id).sort()).toEqual(source.ontology.nodes.map((node) => node.id).sort());
    expect(model?.relations.map((relation) => relation.id).sort()).toEqual(source.ontology.edges.map((edge) => edge.id).sort());
    expect(model?.evidence).toHaveLength(2);
    expect(model?.evidence[0]).toMatchObject({ page: 1, bbox: [80, 120, 920, 320], digest: `sha256:${"a".repeat(64)}` });
    expect(model?.world.status).toBe("candidate");
    expect(model?.world.revision.state).toBe("not_yet");
    expect(model?.signature.state).toBe("not_yet");
  });

  it("marks the exact artifact active only when the active manifest binding matches", () => {
    const source = artifact();
    const model = buildWorldReadModel(source, source.collectionId, {
      activeManifestDigest: source.manifestDigest,
      activeRevision: 12,
    });
    expect(model?.world.status).toBe("active");
    expect(model?.world.revision).toEqual({ state: "read", value: 12 });
    expect(model?.objects.every((object) => object.status === "active")).toBe(true);
  });

  it("fails closed on a fabricated relation endpoint", () => {
    const source = artifact();
    const canonical = source.package.files.find((file) => file.path === "canonical/model.json");
    if (!canonical) throw new Error("canonical fixture missing");
    const parsed = JSON.parse(canonical.content);
    parsed.edges[0].to = "fabricated-node";
    canonical.content = `${JSON.stringify(parsed, null, 2)}\n`;
    expect(buildWorldReadModel(source, source.collectionId)).toBeNull();
  });

  it("fails closed when evidence loses its source page bbox", () => {
    const source = artifact();
    const chunks = source.package.files.find((file) => file.path === "rag/chunks.jsonl");
    if (!chunks) throw new Error("chunks fixture missing");
    const lines = chunks.content.trim().split("\n").map((line) => JSON.parse(line));
    delete lines[0].bbox1000;
    chunks.content = `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`;
    expect(buildWorldReadModel(source, source.collectionId)).toBeNull();
  });

  it("keeps review impact and receipts not-yet when no persisted decision exists", () => {
    const source = artifact();
    const model = buildWorldReadModel(source, source.collectionId);
    expect(model?.review.state).toBe("not_yet");
    expect(model?.review.impact.researchImpactPath.status).toBe("research");
    expect(model?.review.receipt.state).toBe("not_yet");
  });

  it("returns the selected evidence with its exact source page and bbox contract", () => {
    const source = artifact();
    const model = buildWorldReadModel(source, source.collectionId);
    if (!model) throw new Error("world read model missing");

    expect(selectWorldEvidence(model, model.evidence[0].id)).toEqual({
      id: model.evidence[0].id,
      sourceId: "contract-a",
      sourceVersionId: "a".repeat(64),
      page: 1,
      bbox: [80, 120, 920, 320],
      blockId: model.evidence[0].blockId,
      digest: `sha256:${"a".repeat(64)}`,
    });
    expect(model.evidence[0].blockId).toMatch(/^chunk-[a-f0-9]{32}$/);
    expect(selectWorldEvidence(model, "fabricated-evidence")).toBeNull();
    expect(selectWorldEvidence(null, model.evidence[0].id)).toBeNull();
  });
});
