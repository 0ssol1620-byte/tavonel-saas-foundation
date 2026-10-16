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

/*
  Reference lists compared as sets.

  The variants below are derived from the compiled `after` model with one controlled edit each.
  They are synthetic: the replaced ids are not real stored evidence or source bindings, and
  nothing here qualifies a World. They test that the comparison sees membership, not length.
*/
describe("comparing what an object or relation refers to", () => {
  type WorldObject = WorldReadModel["objects"][number];
  type WorldRelation = WorldReadModel["relations"][number];

  const canonical = (ids: readonly string[]) => JSON.stringify([...new Set(ids)].sort());
  const replaceLast = (ids: readonly string[], tag: string) =>
    [...ids.slice(0, -1), `${ids[ids.length - 1]}#controlled-${tag}`];
  const withObject = (model: WorldReadModel, id: string, patch: Partial<WorldObject>): WorldReadModel => ({
    ...model,
    objects: model.objects.map((object) => (object.id === id ? { ...object, ...patch } : object)),
  });
  const withRelation = (model: WorldReadModel, id: string, patch: Partial<WorldRelation>): WorldReadModel => ({
    ...model,
    relations: model.relations.map((relation) => (relation.id === id ? { ...relation, ...patch } : relation)),
  });

  it("world diff reference membership: a same-sized evidence reference replacement changes exactly that object", () => {
    const target = after.objects.find((object) => object.evidenceRefs.length > 0);
    expect(target).toBeDefined();
    const replaced = replaceLast(target!.evidenceRefs, "evidence");
    const diff = diffWorldVersions(after, withObject(after, target!.id, { evidenceRefs: replaced }));
    expect(diff.objects.added).toEqual([]);
    expect(diff.objects.removed).toEqual([]);
    expect(diff.objects.changed.map((item) => item.id)).toEqual([target!.id]);
    // The count is the same on both sides, so only the membership line appears.
    expect(diff.objects.changed[0].changes).toEqual([
      { field: "evidenceRefs", before: canonical(target!.evidenceRefs), after: canonical(replaced) },
    ]);
  });

  it("world diff reference membership: a same-sized relation replacement changes exactly that object", () => {
    const target = after.objects.find((object) => object.relations.length > 0);
    expect(target).toBeDefined();
    const replaced = replaceLast(target!.relations, "relation");
    const diff = diffWorldVersions(after, withObject(after, target!.id, { relations: replaced }));
    expect(diff.objects.changed.map((item) => item.id)).toEqual([target!.id]);
    expect(diff.objects.changed[0].changes).toEqual([
      { field: "relationRefs", before: canonical(target!.relations), after: canonical(replaced) },
    ]);
  });

  it("world diff reference membership: a same-sized claim replacement changes exactly that object", () => {
    const target = after.objects.find((object) => object.claims.length > 0);
    expect(target).toBeDefined();
    const replaced = replaceLast(target!.claims, "claim");
    const diff = diffWorldVersions(after, withObject(after, target!.id, { claims: replaced }));
    expect(diff.objects.changed.map((item) => item.id)).toEqual([target!.id]);
    expect(diff.objects.changed[0].changes).toEqual([
      { field: "claims", before: canonical(target!.claims), after: canonical(replaced) },
    ]);
  });

  it("world diff reference membership: source versions exchanged between two objects are reported per object", () => {
    // Two objects of the compiled model trade controlled source versions. The set of revisions
    // across the World is the same on both sides, which is exactly what used to hide this.
    const [first, second] = after.objects;
    expect(second).toBeDefined();
    const assign = (a: string, b: string) =>
      withObject(withObject(after, first.id, { sourceVersions: [a] }), second.id, { sourceVersions: [b] });
    const left = assign("controlled-source-version-x", "controlled-source-version-y");
    const right = assign("controlled-source-version-y", "controlled-source-version-x");
    const diff = diffWorldVersions(left, right);
    expect(diff.sourceRevisions.added).toEqual([]);
    expect(diff.sourceRevisions.removed).toEqual([]);
    expect(diff.sourceRevisions.unchanged).toBe(new Set(left.objects.flatMap((object) => object.sourceVersions)).size);
    expect(diff.objects.changed).toEqual([
      {
        id: first.id,
        label: first.label,
        type: first.type,
        changes: [{ field: "sourceVersions", before: '["controlled-source-version-x"]', after: '["controlled-source-version-y"]' }],
      },
      {
        id: second.id,
        label: second.label,
        type: second.type,
        changes: [{ field: "sourceVersions", before: '["controlled-source-version-y"]', after: '["controlled-source-version-x"]' }],
      },
    ]);
    expect(diff.identical).toBe(false);
  });

  it("world diff reference membership: a same-sized relation evidence replacement changes exactly that relation", () => {
    const target = after.relations.find((relation) => relation.evidenceRefs.length > 0);
    expect(target).toBeDefined();
    const replaced = replaceLast(target!.evidenceRefs, "relation-evidence");
    const diff = diffWorldVersions(after, withRelation(after, target!.id, { evidenceRefs: replaced }));
    expect(diff.relations.added).toEqual([]);
    expect(diff.relations.removed).toEqual([]);
    expect(diff.relations.changed).toEqual([{
      id: target!.id,
      predicate: target!.predicate,
      subject: target!.subject,
      object: target!.object,
      changes: [{ field: "evidenceRefs", before: canonical(target!.evidenceRefs), after: canonical(replaced) }],
    }]);
    expect(diff.objects.changed).toEqual([]);
  });

  it("world diff reference membership: reordering and repeating references is not a change", () => {
    // Every reference list reversed and then repeated: same members, different order, every
    // count doubled before deduplication.
    const noisy = (ids: readonly string[]) => [...ids].reverse().concat(ids);
    const reordered: WorldReadModel = {
      ...after,
      objects: after.objects.map((object) => ({
        ...object,
        evidenceRefs: noisy(object.evidenceRefs),
        relations: noisy(object.relations),
        claims: noisy(object.claims),
        sourceVersions: noisy(object.sourceVersions),
      })),
      relations: after.relations.map((relation) => ({ ...relation, evidenceRefs: noisy(relation.evidenceRefs) })),
    };
    const references = (model: WorldReadModel) => JSON.stringify({
      objects: model.objects.map((object) => [object.evidenceRefs, object.relations, object.claims, object.sourceVersions]),
      relations: model.relations.map((relation) => relation.evidenceRefs),
    });
    const afterBeforeCall = references(after);
    const reorderedBeforeCall = references(reordered);

    const diff = diffWorldVersions(after, reordered);
    expect(diff.objects.changed).toEqual([]);
    expect(diff.relations.changed).toEqual([]);
    expect(diff.identical).toBe(true);
    expect(countChanges(diff)).toBe(0);

    // The comparison sorts copies; the models it was handed are left as they were.
    expect(references(after)).toBe(afterBeforeCall);
    expect(references(reordered)).toBe(reorderedBeforeCall);

    // The existing controls still hold on top of the reordering.
    const corrected = diffWorldVersions(before, reordered);
    expect(corrected.objects.changed.map((item) => item.id)).toEqual([entity.id]);
    expect(corrected.objects.changed[0].changes).toEqual([{ field: "label", before: entity.label, after: "ACME Corporation" }]);
    const promoted: WorldReadModel = {
      ...reordered,
      objects: reordered.objects.map((object) => ({ ...object, status: "active" as const })),
    };
    expect(diffWorldVersions(after, promoted).objects.changed).toEqual([]);
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
    expect(panel).toContain("reverses the entire version comparison");
    expect(panel).toContain("all {countChanges(diff)} artifact changes, including rows hidden by filters");
    expect(panel).toContain("onRollback(diff.left.manifestDigest)");
    expect(workspace).toContain("onRollback={rollbackReason.trim().length >= 8");
  });
});
