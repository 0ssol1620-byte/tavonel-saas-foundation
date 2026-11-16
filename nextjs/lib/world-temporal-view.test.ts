import { describe, expect, it } from "vitest";
import { compileCollectionCandidate, type CollectionOcrInput } from "./collection-compiler";
import { buildWorldReadModel } from "./world-read-model";
import { datesRecorded, filterBySourceRevision, sourceRevisions, versionOptions } from "./world-temporal-view";

function input(documentId: string, digest: string, text: string): CollectionOcrInput {
  return {
    documentId, versionKey: digest, pageCount: 1, text, inputSha256: `sha256:${digest}`,
    sanitizedKey: `immutable/ws/ws/documents/${documentId}/${digest}/sanitized.pdf`,
    ocrJsonKey: `immutable/ws/ws/documents/${documentId}/${digest}/ocr.json`,
    sourceImmutableKey: `immutable/ws/ws/documents/${documentId}/${digest}/sanitized.pdf`,
    regions: [{ regionId: `${documentId}-p1-b1`, pageIndex0: 0, pageNumber1: 1, order: 0, blockType: "paragraph", text, bbox1000: [80, 120, 920, 320], confidence: 0.99, authority: "contractual" }],
  };
}
const base = compileCollectionCandidate([
  input("doc-a", "a".repeat(64), "Acme Corp signed the Master Services Agreement with Globex Ltd."),
  input("doc-b", "b".repeat(64), "Globex Ltd renewed the Master Services Agreement with Acme Corp."),
]);
const source = { ...base, coreExecution: { status: "completed" as const, runtime: "tavonel-python-core-v2", worldStateId: "ws-1", receipt: { requestId: "t", outputSha256: `sha256:${"c".repeat(64)}`, candidatePromotion: false as const } } };
const model = buildWorldReadModel(source, source.collectionId, { origin: "deterministic_sample" })!;

describe("world temporal view", () => {
  it("keeps only objects, relations and evidence bound to the revision", () => {
    const revs = sourceRevisions(model);
    expect(revs.length).toBeGreaterThan(1);
    const view = filterBySourceRevision(model, revs[0]);
    expect(view.objects.length).toBeGreaterThan(0);
    expect(view.objects.every((o) => o.sourceVersions.includes(revs[0]))).toBe(true);
    const ids = new Set(view.objects.map((o) => o.id));
    expect(view.relations.every((r) => ids.has(r.subject) && ids.has(r.object))).toBe(true);
    expect(view.evidence.every((e) => e.sourceVersionId === revs[0])).toBe(true);
  });

  it("an unknown revision yields an empty view without throwing", () => {
    const view = filterBySourceRevision(model, "no-such-revision");
    expect([view.objects.length, view.relations.length, view.evidence.length]).toEqual([0, 0, 0]);
  });

  it("reports dates as not recorded for a real read model", () => {
    expect(datesRecorded(model)).toBe(false);
  });

  it("marks the current version", () => {
    const options = versionOptions(model.history, model.world.manifestDigest);
    expect(options.filter((o) => o.current)).toHaveLength(1);
    expect(options.find((o) => o.current)?.manifestDigest).toBe(model.world.manifestDigest);
  });
});
