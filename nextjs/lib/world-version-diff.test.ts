import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyCandidatePatch } from "./collection-patch";
import { compileCollectionCandidate, type CollectionOcrInput } from "./collection-compiler";
import { buildWorldReadModel, type WorldReadModel } from "./world-read-model";
import { countChanges, diffWorldVersions } from "./world-version-diff";

/*
  Two real versions, compared.

  The left-hand side here is produced by actually correcting the right-hand side, which is the
  case the panel exists for: someone is about to roll back a correction and needs to see what
  comes back. A hand-written pair of fixtures would test the diff function; this tests the diff
  a customer will actually be shown.
*/

function input(documentId: string, digest: string, text: string): CollectionOcrInput {
  return {
    documentId,
    versionKey: digest,
    sanitizedKey: `immutable/ws/ws/documents/${documentId}/${digest}/sanitized.pdf`,
    ocrJsonKey: `immutable/ws/ws/documents/${documentId}/${digest}/ocr.json`,
    pageCount: 1,
    text,
    inputSha256: `sha256:${digest}`,
    sourceImmutableKey: `immutable/ws/ws/documents/${documentId}/${digest}/sanitized.pdf`,
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

function withCore(base: ReturnType<typeof compileCollectionCandidate>) {
  return {
    ...base,
    coreExecution: {
      status: "completed" as const,
      runtime: "tavonel-python-core-v2",
      worldStateId: "world-state-1",
      receipt: { requestId: "diff-test", outputSha256: `sha256:${"c".repeat(64)}`, candidatePromotion: false as const },
    },
  };
}

const original = withCore(compileCollectionCandidate([
  input("contract-a", "a".repeat(64), "ACME Corporaton shall pay every valid invoice within 30 calendar days."),
]));

const entity = original.ontology.nodes.find((node) => node.kind === "Entity")!;
const patched = (() => {
  const result = applyCandidatePatch(
    original,
    { objectId: entity.id, before: entity.label, after: "ACME Corporation" },
    { evidenceId: "e1", actorUserId: "11111111-1111-4111-8111-111111111111", patchedAt: "2026-09-03T00:00:00.000Z" },
  );
  if (!result.ok) throw new Error(result.code);
  return result.artifact;
})();

const before = buildWorldReadModel(original, original.collectionId, { origin: "deterministic_sample" })!;
const after = buildWorldReadModel(patched, original.collectionId, { origin: "deterministic_sample" })!;

describe("comparing two versions of a World", () => {
  it("finds the object that changed, and says what about it changed", () => {
    const diff = diffWorldVersions(before, after);
    expect(diff.objects.added).toEqual([]);
    expect(diff.objects.removed).toEqual([]);
    expect(diff.objects.changed).toHaveLength(1);
    const [changed] = diff.objects.changed;
    expect(changed.id).toBe(entity.id);
    expect(changed.changes).toEqual([{ field: "label", before: entity.label, after: "ACME Corporation" }]);
  });

  it("reports the package files that were rewritten", () => {
    const diff = diffWorldVersions(before, after);
    // The four serialisations that embed a label, and nothing else.
    expect(diff.files.changed.sort()).toEqual([
      "canonical/model.json",
      "graph/nodes.csv",
      "ontology/knowledge.jsonld",
      "ontology/knowledge.ttl",
    ]);
    expect(diff.files.added).toEqual([]);
    expect(diff.files.removed).toEqual([]);
  });

  it("shows that a correction touched no evidence and no relation", () => {
    const diff = diffWorldVersions(before, after);
    expect(diff.evidence.added).toEqual([]);
    expect(diff.evidence.removed).toEqual([]);
    expect(diff.evidence.changed).toEqual([]);
    expect(diff.relations.added).toEqual([]);
    expect(diff.relations.removed).toEqual([]);
    expect(diff.relations.changed).toEqual([]);
    expect(diff.sourceRevisions.added).toEqual([]);
    expect(diff.sourceRevisions.removed).toEqual([]);
  });

  it("calls a version identical to itself identical", () => {
    const diff = diffWorldVersions(before, before);
    expect(diff.identical).toBe(true);
    expect(countChanges(diff)).toBe(0);
  });

  it("notices a moved bounding box even when the words are the same", () => {
    /*
      The dangerous change, and the reason evidence is compared on geometry rather than on its
      excerpt. A quote that still reads correctly and no longer points at where it came from
      is worse than one that visibly broke.
    */
    const moved: WorldReadModel = {
      ...after,
      evidence: after.evidence.map((item, index) => (index === 0 ? { ...item, bbox: [10, 20, 30, 40] as [number, number, number, number] } : item)),
    };
    const diff = diffWorldVersions(after, moved);
    expect(diff.evidence.changed).toHaveLength(1);
    expect(diff.evidence.changed[0].changes.map((change) => change.field)).toContain("bbox");
  });

  it("does not report a promotion as a change to every object", () => {
    // `status` flips from candidate to active when a version is promoted. That is a fact about
    // the version, not a change to the objects, and reporting it would bury the one real line.
    const promoted: WorldReadModel = {
      ...after,
      objects: after.objects.map((object) => ({ ...object, status: "active" as const })),
    };
    const diff = diffWorldVersions(after, promoted);
    expect(diff.objects.changed).toEqual([]);
  });
});

describe("where the comparison is shown", () => {
  const studio = readFileSync(new URL("../components/world-studio-ultimate.tsx", import.meta.url), "utf8");
  const panel = readFileSync(new URL("../components/world-version-diff.tsx", import.meta.url), "utf8");
  const workspace = readFileSync(new URL("../app/workspace/page.tsx", import.meta.url), "utf8");

  it("replaces the version list with the comparison", () => {
    expect(studio).toContain("<WorldVersionDiffPanel");
    expect(studio).not.toContain("className={styles.historyList}");
  });

  it("reads both sides from the API rather than comparing against a summary", () => {
    expect(panel).toContain("?manifest=");
    expect(panel).toContain("/api/v1/reviews?collectionId=");
  });

  it("puts the rollback button under the diff it is confirming", () => {
    expect(panel).toContain("reverses every change listed above");
    expect(workspace).toContain("onRollback={rollbackReason.trim().length >= 8");
  });
});
