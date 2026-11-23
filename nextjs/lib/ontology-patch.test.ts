import { describe, expect, it } from "vitest";
import { applyCandidatePatch, applyOntologyPatch, evaluateOntologyPatch } from "./collection-patch";
import {
  advertisedOntologyRelations,
  canonicalize,
  compileCollectionCandidate,
  materializeLabelDerivedFiles,
  sha256,
  type CollectionCandidateArtifact,
  type CollectionOcrInput,
} from "./collection-compiler";
import { validatePromotableCollectionArtifact, validateReviewableCollectionArtifact } from "./collection-download";
import { filesFromArtifact, validateCompiledWorldPackage } from "../scripts/compiled-world/validate.mjs";

/*
  WO-KS-3: typed ontology patch ops and their dry-run (knowledge-steward.md §5, invariants K-5, K-7).

  Every case goes through the real compiler output: `compileCollectionCandidate` builds the base,
  the patch runs the compiler's materializer, and `validate.mjs` and the promotion gate read the
  package files the patch wrote.
*/

function input(documentId: string, digest: string, text: string, bbox1000: [number, number, number, number] = [80, 120, 920, 320]): CollectionOcrInput {
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
      bbox1000,
      confidence: 0.99,
      authority: "contractual",
    }],
  };
}

type Stored = CollectionCandidateArtifact & { coreExecution: { status: "completed"; runtime: string; worldStateId: string; receipt: { requestId: string; outputSha256: string; candidatePromotion: false } } };

function fallback(): Stored {
  const base = compileCollectionCandidate([
    input("contract-a", "a".repeat(64), "ACME Corporaton shall pay every valid invoice within 30 calendar days."),
    input("contract-b", "b".repeat(64), "ACME Corporaton requires written approval before changing payment terms."),
  ]);
  return {
    ...base,
    coreExecution: {
      status: "completed",
      runtime: "tavonel-python-core-v2",
      worldStateId: "world-state-1",
      receipt: { requestId: "ontology-patch-test", outputSha256: `sha256:${"c".repeat(64)}`, candidatePromotion: false },
    },
  };
}

/*
  A Core V2-shaped candidate: the live engine's edge vocabulary (no Topic edge, `mentions`,
  `contradicts`), one claim bound to two evidence regions, and package files re-materialized so the
  base itself is a consistent package. The projection that produces such an artifact is tested in
  core-runtime-v2.test.ts; what is under test here is the patch over it.
*/
function coreShaped(): Stored {
  const base = fallback();
  const [claimA, claimB] = base.ontology.nodes.filter((node) => node.kind === "Claim");
  const [evidenceA, evidenceB] = base.ontology.nodes.filter((node) => node.kind === "Evidence");
  const entity = base.ontology.nodes.find((node) => node.kind === "Entity")!;
  const edges: CollectionCandidateArtifact["ontology"]["edges"] = [
    { id: `relation-${"1".repeat(32)}`, type: "supported_by", from: claimA.id, to: evidenceA.id, evidenceIds: [evidenceA.id] },
    { id: `relation-${"2".repeat(32)}`, type: "supported_by", from: claimA.id, to: evidenceB.id, evidenceIds: [evidenceB.id] },
    { id: `relation-${"3".repeat(32)}`, type: "supported_by", from: claimB.id, to: evidenceB.id, evidenceIds: [evidenceB.id] },
    { id: `relation-${"4".repeat(32)}`, type: "mentions", from: claimA.id, to: entity.id, evidenceIds: [evidenceA.id] },
    { id: `relation-${"5".repeat(32)}`, type: "contradicts", from: claimA.id, to: claimB.id, evidenceIds: [evidenceA.id, evidenceB.id], reason: "numeric_disagreement" },
  ];
  const blueprint = { ...base.blueprint, ontologyRelations: advertisedOntologyRelations(edges) };
  const derived = materializeLabelDerivedFiles({
    collectionId: base.collectionId,
    nodes: base.ontology.nodes,
    edges,
    blueprint,
    inputBinding: base.sourceDocuments.map((document) => ({
      documentId: document.documentId,
      versionKey: document.versionKey,
      inputSha256: document.inputSha256,
      sourceImmutableKey: document.sanitizedKey,
    })),
  });
  const counts = { ...base.validation.counts, relations: edges.length };
  const report = base.package.files.find((file) => file.path === "validation/report.json")!;
  const reportContent = JSON.stringify({ ...JSON.parse(report.content), counts }, null, 2) + "\n";
  const replaced = new Map<string, (typeof base.package.files)[number]>(
    [derived.canonicalModel, derived.turtle, derived.jsonld, derived.nodeCsv, derived.edgeCsv].map((file) => [file.path, file]),
  );
  replaced.set(report.path, { ...report, content: reportContent, sizeBytes: Buffer.byteLength(reportContent), sha256: `sha256:${sha256(reportContent)}` });
  return {
    ...base,
    blueprint,
    ontology: { nodes: base.ontology.nodes, edges },
    package: { ...base.package, files: base.package.files.map((file) => replaced.get(file.path) ?? file) },
    validation: { ...base.validation, counts },
  };
}

/*
  The compiler's own `review_required` output: a region box that leaves the page frame, which
  validate.mjs reports as COORDINATE_OUT_OF_RANGE and the compiler records as a review reason
  (collection-compiler.ts, `errorCodes` -> `reviewReasons`). A legitimate stored candidate.
*/
function outOfRange(): Stored {
  const base = compileCollectionCandidate([
    input("contract-a", "a".repeat(64), "ACME Corporaton shall pay every valid invoice within 30 calendar days.", [80, 120, 1200, 320]),
    input("contract-b", "b".repeat(64), "ACME Corporaton requires written approval before changing payment terms."),
  ]);
  return {
    ...base,
    coreExecution: {
      status: "review_required",
      runtime: "tavonel-python-core-v2",
      worldStateId: "world-state-1",
      receipt: { requestId: "ontology-patch-test", outputSha256: `sha256:${"c".repeat(64)}`, candidatePromotion: false },
    },
  } as unknown as Stored;
}

/* A base recorded `passed` whose graph files validate.mjs refuses: mentions_entity is not declared. */
function undeclared(): Stored {
  const base = fallback();
  const blueprint = { ...base.blueprint, ontologyRelations: ["discusses_topic", "supported_by"] };
  const derived = materializeLabelDerivedFiles({
    collectionId: base.collectionId,
    nodes: base.ontology.nodes,
    edges: base.ontology.edges,
    blueprint,
    inputBinding: base.sourceDocuments.map((document) => ({
      documentId: document.documentId,
      versionKey: document.versionKey,
      inputSha256: document.inputSha256,
      sourceImmutableKey: document.sanitizedKey,
    })),
  });
  const replaced = new Map([derived.canonicalModel, derived.turtle, derived.jsonld, derived.nodeCsv, derived.edgeCsv].map((file) => [file.path, file]));
  return { ...base, blueprint, package: { ...base.package, files: base.package.files.map((file) => replaced.get(file.path) ?? file) } };
}

const ALL = { readableDocumentIds: new Set(["contract-a", "contract-b"]) };
const ACTOR = { ...ALL, actorUserId: "11111111-1111-4111-8111-111111111111", patchedAt: "2026-11-23T00:00:00.000Z" };
const node = (artifact: Stored, kind: string, index = 0) => artifact.ontology.nodes.filter((item) => item.kind === kind)[index];
const edgesOf = (artifact: Stored, type: string) => artifact.ontology.edges.filter((edge) => edge.type === type);
const errors = (artifact: unknown) => validateCompiledWorldPackage(filesFromArtifact(artifact)).errors;
const codes = (artifact: unknown) => [...new Set(errors(artifact).map((error) => String(error.code)))].sort();
const findingSet = (artifact: unknown) => new Set(errors(artifact).map((error) => JSON.stringify([error.code, error.path ?? null, error.detail ?? null])));
const reportOf = (artifact: { package: Stored["package"] }) => JSON.parse(artifact.package.files.find((file) => file.path === "validation/report.json")!.content);
/** Retype the entity a retrieval chunk names: validate.mjs then raises ENTITY_DANGLING, an error the base did not have. */
function danglingEntity(artifact: Stored) {
  const entity = node(artifact, "Entity");
  return [
    ...edgesOf(artifact, "mentions_entity").map((edge) => ({ op: "remove_relation", edgeId: edge.id })),
    { op: "retype", objectId: entity.id, from: "Entity", to: "Topic" },
    { op: "add_relation", from: node(artifact, "Document").id, to: entity.id, type: "discusses_topic", evidenceIds: [node(artifact, "Evidence").id] },
  ];
}

function addTopic(base: Stored, label = "Payment terms") {
  return [
    { op: "add_object", tempId: "t1", kind: "Topic", label, evidenceIds: [node(base, "Evidence").id] },
    { op: "add_relation", from: node(base, "Document").id, to: "t1", type: "discusses_topic", evidenceIds: [node(base, "Evidence").id] },
  ];
}

describe("applying an ontology patch", () => {
  it("adds an object and a relation as a new candidate that passes the compiler's validator and the promotion gate", () => {
    const base = fallback();
    const before = JSON.stringify(base);
    const result = applyOntologyPatch(base, addTopic(base), ACTOR);
    if (!result.ok) throw new Error(result.refusal.code);
    const patched = result.artifact;

    expect(JSON.stringify(base), "the base is not mutated").toBe(before);
    expect(patched.manifestDigest).not.toBe(base.manifestDigest);
    const topic = patched.ontology.nodes.find((item) => item.label === "Payment terms")!;
    expect(topic).toMatchObject({ kind: "Topic", evidenceIds: [node(base, "Evidence").id] });
    expect(topic.id).toMatch(/^topic-[a-f0-9]{32}$/);
    expect(patched.ontology.edges.at(-1)).toMatchObject({ type: "discusses_topic", from: node(base, "Document").id, to: topic.id });

    // validate.mjs reads the files: predicate allowlist, four serialisations agreeing, report counts.
    expect(errors(patched)).toEqual([]);
    expect(validatePromotableCollectionArtifact(patched, base.collectionId)).not.toBeNull();
    const report = JSON.parse(patched.package.files.find((file) => file.path === "validation/report.json")!.content);
    expect(report.counts).toMatchObject({ topics: 2, entities: 1, relations: 7 });
    expect(patched.validation.counts).toMatchObject({ topics: 2, entities: 1, relations: 7 });
    expect(patched.package.files.find((file) => file.path === "ontology/knowledge.ttl")!.content)
      .toContain(`<urn:tavonel:${topic.id}> a tav:Topic ; rdfs:label "Payment terms" .`);

    // What the page said is not rewritten.
    const chunks = (artifact: { package: Stored["package"] }) => artifact.package.files.find((file) => file.path === "rag/chunks.jsonl")!.sha256;
    expect(chunks(patched)).toBe(chunks(base));
    expect(patched.ontologyPatch).toMatchObject({
      schemaVersion: "tavonel.ontology_patch.v1",
      derivedFromManifestDigest: base.manifestDigest,
      actorUserId: ACTOR.actorUserId,
      patchedAt: ACTOR.patchedAt,
    });
    expect(patched.coreExecution!.receipt.outputSha256).toBe(patched.manifestDigest);
  });

  it("K-7: the same ops on the same base write byte-identical files and digest", () => {
    const base = fallback();
    const ops = addTopic(base);
    const first = applyOntologyPatch(base, ops, ACTOR);
    const second = applyOntologyPatch(fallback(), structuredClone(ops), ACTOR);
    if (!first.ok || !second.ok) throw new Error("patch refused");
    expect(JSON.stringify(second.artifact)).toBe(JSON.stringify(first.artifact));
    expect(second.artifact.manifestDigest).toBe(first.artifact.manifestDigest);
    // Ids are derived from the op, so a different label is a different object.
    const other = applyOntologyPatch(base, addTopic(base, "Invoices"), ACTOR);
    if (!other.ok) throw new Error(other.refusal.code);
    expect(other.artifact.ontology.nodes.at(-1)!.id).not.toBe(first.artifact.ontology.nodes.at(-1)!.id);
  });

  it("retypes a Topic to an Entity under a new stable id, and later ops may still name the old id", () => {
    const base = fallback();
    const topic = node(base, "Topic");
    const ops = [
      ...edgesOf(base, "discusses_topic").map((edge) => ({ op: "remove_relation", edgeId: edge.id })),
      { op: "retype", objectId: topic.id, from: "Topic", to: "Entity" },
      { op: "add_relation", from: node(base, "Document").id, to: topic.id, type: "mentions_entity", evidenceIds: [node(base, "Evidence").id] },
    ];
    const evaluation = evaluateOntologyPatch(base, ops, { ...ALL, questions: null });
    expect(evaluation).toMatchObject({ valid: true, refusals: [], loss: { edgesRemoved: 2, evidenceOrphaned: 0 } });
    const result = applyOntologyPatch(base, ops, ACTOR);
    if (!result.ok) throw new Error(result.refusal.code);
    const retyped = result.artifact.ontology.nodes.find((item) => item.label === "General")!;
    expect(retyped.kind).toBe("Entity");
    expect(retyped.id).toMatch(/^entity-[a-f0-9]{32}$/);
    expect(result.artifact.ontology.nodes.some((item) => item.id === topic.id)).toBe(false);
    expect(result.artifact.ontology.edges.at(-1)).toMatchObject({ type: "mentions_entity", to: retyped.id });
    expect(evaluation.affectedObjectIds).toEqual(expect.arrayContaining([topic.id, retyped.id]));
    expect(result.artifact.validation.counts).toMatchObject({ topics: 0, entities: 2, relations: 5 });
    expect(errors(result.artifact)).toEqual([]);
  });

  it("keeps a Core V2 candidate's declared predicates (K01) and its own validation", () => {
    const base = coreShaped();
    expect(errors(base)).toEqual([]);
    const ops = [{ op: "add_relation", from: node(base, "Claim", 1).id, to: node(base, "Entity").id, type: "mentions", evidenceIds: [node(base, "Evidence", 1).id] }];
    const result = applyOntologyPatch(base, ops, ACTOR);
    if (!result.ok) throw new Error(result.refusal.code);
    const canonical = JSON.parse(result.artifact.package.files.find((file) => file.path === "canonical/model.json")!.content);
    expect(canonical.blueprint.ontologyRelations).toEqual(["contradicts", "mentions", "supported_by"]);
    expect(canonical.blueprint.ontologyRelations).not.toContain("discusses_topic");
    expect(errors(result.artifact)).toEqual([]);
  });
});

describe("what an ontology patch refuses", () => {
  const base = fallback();
  const core = coreShaped();
  const evidenceA = node(base, "Evidence").id;
  const documentA = node(base, "Document").id;
  const refused = (artifact: Stored, ops: unknown, opIndex: number | null, code: string, context = ACTOR) => {
    expect(applyOntologyPatch(artifact, ops, context)).toEqual({ ok: false, refusal: { opIndex, code } });
    expect(evaluateOntologyPatch(artifact, ops, { ...context, questions: null })).toEqual({
      valid: false,
      refusals: [{ opIndex, code }],
      loss: { edgesRemoved: 0, evidenceOrphaned: 0 },
      affectedObjectIds: [],
      coverage: { before: [], after: [] },
      validation: null,
    });
  };

  it("PATCH_OP_INVALID: anything that is not exactly one of the five shapes, or a wrong op count", () => {
    refused(base, [], null, "PATCH_OP_INVALID");
    refused(base, "ops", null, "PATCH_OP_INVALID");
    refused(base, Array.from({ length: 21 }, () => ({ op: "remove_relation", edgeId: "x" })), null, "PATCH_OP_INVALID");
    const relabel = { op: "relabel", objectId: node(base, "Entity").id, before: node(base, "Entity").label, after: "ACME Corporation" };
    for (const bad of [
      { ...relabel, extra: true },
      { ...relabel, op: "delete_object" },
      { ...relabel, after: 7 },
      { ...relabel, objectId: "x".repeat(129) },
      JSON.parse(`{"op":"remove_relation","edgeId":"x","__proto__":{}}`),
      { op: "add_object", tempId: "t1", kind: "Claim", label: "x", evidenceIds: [evidenceA] },
      { op: "add_object", tempId: "t 1", kind: "Topic", label: "x", evidenceIds: [evidenceA] },
      { op: "add_object", tempId: "t1", kind: "Topic", label: "x", evidenceIds: [] },
      { op: "add_object", tempId: "t1", kind: "Topic", label: "x", evidenceIds: Array.from({ length: 17 }, (_, i) => `e${i}`) },
      { op: "add_object", tempId: "t1", kind: "Topic", label: "x", evidenceIds: [evidenceA, evidenceA] },
      { op: "add_relation", from: documentA, to: node(base, "Topic").id, type: "Discusses", evidenceIds: [evidenceA] },
      { op: "retype", objectId: node(base, "Topic").id, from: "Topic", to: "Claim" },
      null,
      [],
    ]) refused(base, [relabel, bad], 1, "PATCH_OP_INVALID");
    // A tempId may not shadow an existing id.
    refused(base, [{ op: "add_object", tempId: documentA, kind: "Topic", label: "x", evidenceIds: [evidenceA] }], 0, "PATCH_OP_INVALID");
    // A predicate between kinds it does not join.
    refused(base, [{ op: "add_relation", from: node(base, "Claim").id, to: node(base, "Topic").id, type: "discusses_topic", evidenceIds: [evidenceA] }], 0, "PATCH_OP_INVALID");
  });

  it("PATCH_TARGET_NOT_FOUND: an id that is not in this World", () => {
    refused(base, [{ op: "relabel", objectId: "entity-missing", before: "x", after: "y" }], 0, "PATCH_TARGET_NOT_FOUND");
    refused(base, [{ op: "remove_relation", edgeId: "relation-missing" }], 0, "PATCH_TARGET_NOT_FOUND");
    refused(base, [{ op: "add_relation", from: documentA, to: "t9", type: "discusses_topic", evidenceIds: [evidenceA] }], 0, "PATCH_TARGET_NOT_FOUND");
    refused(base, [{ op: "retype", objectId: "topic-missing", from: "Topic", to: "Entity" }], 0, "PATCH_TARGET_NOT_FOUND");
  });

  it("PATCH_TARGET_NOT_EDITABLE: Documents, Evidence, Claims' kind, evidence bindings and held conflicts", () => {
    for (const kind of ["Document", "Evidence"]) {
      const target = node(base, kind);
      refused(base, [{ op: "relabel", objectId: target.id, before: target.label, after: "anything" }], 0, "PATCH_TARGET_NOT_EDITABLE");
    }
    refused(base, [{ op: "retype", objectId: node(base, "Claim").id, from: "Topic", to: "Entity" }], 0, "PATCH_TARGET_NOT_EDITABLE");
    refused(base, [{ op: "add_relation", from: node(base, "Claim", 1).id, to: evidenceA, type: "supported_by", evidenceIds: [evidenceA] }], 0, "PATCH_TARGET_NOT_EDITABLE");
    refused(core, [{ op: "remove_relation", edgeId: edgesOf(core, "contradicts")[0].id }], 0, "PATCH_TARGET_NOT_EDITABLE");
    refused(core, [{ op: "add_relation", from: node(core, "Claim", 1).id, to: node(core, "Claim").id, type: "contradicts", evidenceIds: [evidenceA] }], 0, "PATCH_TARGET_NOT_EDITABLE");
  });

  it("PATCH_BEFORE_MISMATCH and PATCH_LABEL_INVALID, as for a label correction", () => {
    const entity = node(base, "Entity");
    refused(base, [{ op: "relabel", objectId: entity.id, before: "stale", after: "ACME Corporation" }], 0, "PATCH_BEFORE_MISMATCH");
    refused(base, [{ op: "retype", objectId: entity.id, from: "Topic", to: "Entity" }], 0, "PATCH_BEFORE_MISMATCH");
    refused(base, [{ op: "relabel", objectId: entity.id, before: entity.label, after: "  " }], 0, "PATCH_LABEL_INVALID");
    refused(base, [{ op: "add_object", tempId: "t1", kind: "Topic", label: "tab\there", evidenceIds: [evidenceA] }], 0, "PATCH_LABEL_INVALID");
  });

  it("PATCH_EVIDENCE_NOT_FOUND: a cited id that is not an Evidence node, or one from a document the proposer cannot read", () => {
    refused(base, [{ op: "add_object", tempId: "t1", kind: "Topic", label: "x", evidenceIds: [node(base, "Claim").id] }], 0, "PATCH_EVIDENCE_NOT_FOUND");
    refused(base, [{ op: "add_object", tempId: "t1", kind: "Topic", label: "x", evidenceIds: ["evidence-elsewhere"] }], 0, "PATCH_EVIDENCE_NOT_FOUND");
    const onlyB = { ...ACTOR, readableDocumentIds: new Set(["contract-b"]) };
    refused(base, addTopic(base), 0, "PATCH_EVIDENCE_NOT_FOUND", onlyB);
    refused(base, [{ op: "add_relation", from: node(base, "Document", 1).id, to: node(base, "Entity").id, type: "mentions_entity", evidenceIds: [evidenceA] }], 0, "PATCH_EVIDENCE_NOT_FOUND", onlyB);
    // An Evidence node with no document cannot be shown readable, so it is not.
    const anonymous = structuredClone(base);
    delete anonymous.ontology.nodes.find((item) => item.id === evidenceA)!.documentId;
    refused(anonymous, addTopic(anonymous), 0, "PATCH_EVIDENCE_NOT_FOUND");
  });

  it("PATCH_EVIDENCE_ORPHANED: a supported_by edge is never removed, even when the claim has another", () => {
    refused(base, [{ op: "remove_relation", edgeId: edgesOf(base, "supported_by")[0].id }], 0, "PATCH_EVIDENCE_ORPHANED");
    refused(core, [{ op: "remove_relation", edgeId: edgesOf(core, "supported_by")[1].id }], 0, "PATCH_EVIDENCE_ORPHANED");
  });

  it("PATCH_OBJECT_UNCONNECTED: a new object no edge of the same patch connects", () => {
    refused(base, [addTopic(base)[0]], 0, "PATCH_OBJECT_UNCONNECTED");
  });

  it("PATCH_NO_CHANGE: a relation that already exists, a retype to the same kind, an unchanged label", () => {
    const edge = edgesOf(base, "discusses_topic")[0];
    refused(base, [{ op: "add_relation", from: edge.from, to: edge.to, type: edge.type, evidenceIds: [evidenceA] }], 0, "PATCH_NO_CHANGE");
    refused(base, [{ op: "retype", objectId: node(base, "Topic").id, from: "Topic", to: "Topic" }], 0, "PATCH_NO_CHANGE");
    const entity = node(base, "Entity");
    refused(base, [{ op: "relabel", objectId: entity.id, before: entity.label, after: entity.label }], 0, "PATCH_NO_CHANGE");
  });

  it("PATCH_RETYPE_BREAKS_EDGE: a retype that leaves an incident edge joining kinds its predicate does not", () => {
    refused(base, [{ op: "retype", objectId: node(base, "Topic").id, from: "Topic", to: "Entity" }], 0, "PATCH_RETYPE_BREAKS_EDGE");
    refused(core, [{ op: "retype", objectId: node(core, "Entity").id, from: "Entity", to: "Topic" }], 0, "PATCH_RETYPE_BREAKS_EDGE");
  });

  it("PATCH_ARTIFACT_INVALID: an undeclared predicate, or a result validate.mjs refuses", () => {
    refused(base, [{ op: "add_relation", from: node(base, "Claim").id, to: node(base, "Entity").id, type: "mentions", evidenceIds: [evidenceA] }], 0, "PATCH_ARTIFACT_INVALID");
    // The entity is named by a retrieval chunk; retyped, it gets a topic id, and the chunk's
    // entity reference would dangle. The chunks are what the page said and are not rewritten.
    const entity = node(base, "Entity");
    refused(base, [
      ...edgesOf(base, "mentions_entity").map((edge) => ({ op: "remove_relation", edgeId: edge.id })),
      { op: "retype", objectId: entity.id, from: "Entity", to: "Topic" },
      { op: "add_relation", from: documentA, to: entity.id, type: "discusses_topic", evidenceIds: [evidenceA] },
    ], null, "PATCH_ARTIFACT_INVALID");
  });

  it("throws on a base that is not a valid candidate: the stored World's integrity, not the proposer's patch", () => {
    const { coreExecution: _dropped, ...unreceipted } = base;
    void _dropped;
    const promoted = { ...base, candidatePromotion: true };
    const noGraph = { ...base, ontology: { nodes: base.ontology.nodes, edges: null } };
    for (const bad of [null, "artifact", unreceipted, promoted, noGraph]) {
      expect(() => applyOntologyPatch(bad, addTopic(base), ACTOR)).toThrow("PATCH_BASE_INVALID");
      expect(() => evaluateOntologyPatch(bad, addTopic(base), { ...ALL, questions: null })).toThrow("PATCH_BASE_INVALID");
    }
  });

  it("PATCH_ARTIFACT_INVALID: a patch that fixes nothing but adds an error, on a review_required base", () => {
    const flagged = outOfRange();
    expect(codes(flagged)).toEqual(["COORDINATE_OUT_OF_RANGE"]);
    refused(flagged, danglingEntity(flagged), null, "PATCH_ARTIFACT_INVALID");
  });

  it("PATCH_ARTIFACT_INVALID: errors compared as a set of (code, locus), so a patch cannot trade one for another", () => {
    // The base has PREDICATE_UNDECLARED on each mentions_entity edge. Removing those edges clears
    // them; retyping the entity the chunks name raises ENTITY_DANGLING. No more errors than
    // before by count, and every one of them new.
    const bad = undeclared();
    const before = errors(bad);
    expect(before.every((error) => error.code === "PREDICATE_UNDECLARED")).toBe(true);
    refused(bad, danglingEntity(bad), null, "PATCH_ARTIFACT_INVALID");
  });

  it("round 1: a base recorded passed that validate.mjs refuses is patched into review_required with the base's codes, never passed", () => {
    const bad = undeclared();
    expect(validatePromotableCollectionArtifact(bad, bad.collectionId)).not.toBeNull();
    expect(codes(bad)).toEqual(["PREDICATE_UNDECLARED"]);
    const entity = node(bad, "Entity");
    for (const ops of [[{ op: "relabel", objectId: entity.id, before: entity.label, after: "ACME Corporation" }], addTopic(bad)]) {
      const result = applyOntologyPatch(bad, ops, ACTOR);
      if (!result.ok) throw new Error(result.refusal.code);
      const patched = result.artifact;
      expect(codes(patched)).toEqual(["PREDICATE_UNDECLARED"]);
      expect(patched.validation.status).toBe("review_required");
      expect(patched.validation.reviewReasons).toEqual(["PREDICATE_UNDECLARED"]);
      expect(patched.reviewReasons).toEqual(["PREDICATE_UNDECLARED"]);
      expect(patched.lifecycle).toBe("review_required");
      expect(patched.coreExecution!.status).toBe("review_required");
      expect(reportOf(patched)).toMatchObject({ status: "review_required", reviewReasons: ["PREDICATE_UNDECLARED"] });
      expect(validatePromotableCollectionArtifact(patched, bad.collectionId)).toBeNull();
      expect(validateReviewableCollectionArtifact(patched, bad.collectionId)).not.toBeNull();
      // The preview shows it, so the preview digest covers it.
      expect(evaluateOntologyPatch(bad, ops, { ...ALL, questions: null }).validation).toEqual({ status: "review_required", errorCodes: ["PREDICATE_UNDECLARED"] });
    }
  });

  it("round 2: the compiler's own review_required output (an out-of-range box) is a patchable base", () => {
    const flagged = outOfRange();
    expect(flagged.lifecycle).toBe("review_required");
    expect(validateReviewableCollectionArtifact(flagged, flagged.collectionId)).not.toBeNull();
    const result = applyOntologyPatch(flagged, addTopic(flagged), ACTOR);
    if (!result.ok) throw new Error(result.refusal.code);
    const patched = result.artifact;
    expect(codes(patched)).toEqual(["COORDINATE_OUT_OF_RANGE"]);
    // The base's reasons are kept: a patch does not clear review_required.
    expect(patched.validation.reviewReasons).toEqual(flagged.validation.reviewReasons);
    expect(patched.validation.status).toBe("review_required");
    expect(reportOf(patched).reviewReasons).toEqual(reportOf(flagged).reviewReasons);
    expect(validateReviewableCollectionArtifact(patched, flagged.collectionId)).not.toBeNull();
    expect(evaluateOntologyPatch(flagged, addTopic(flagged), { ...ALL, questions: null }).validation)
      .toEqual({ status: "review_required", errorCodes: ["COORDINATE_OUT_OF_RANGE"] });
  });

  it("a patch on a passed base that adds an error is refused", () => {
    refused(base, danglingEntity(base), null, "PATCH_ARTIFACT_INVALID");
    expect(evaluateOntologyPatch(base, addTopic(base), { ...ALL, questions: null }).validation).toEqual({ status: "passed", errorCodes: [] });
  });

  it("refuses to run without the proposer's readable documents rather than assume all of them", () => {
    expect(() => applyOntologyPatch(base, addTopic(base), { actorUserId: "u", patchedAt: "t" } as unknown as typeof ACTOR)).toThrow("PATCH_CONTEXT_INVALID");
    expect(() => evaluateOntologyPatch(base, addTopic(base), { readableDocumentIds: ["contract-a"], questions: null } as never)).toThrow("PATCH_CONTEXT_INVALID");
  });
});

/*
  Which bases are patchable is one question with one answer (receipts/blockers/WO-KS-3.md rule 1):
  the ones a label correction is applied to. Both label paths gate the stored candidate with
  `validateReviewableCollectionArtifact` (through `loadWorldReadModel`) before `applyCandidatePatch`.
*/
describe("the ontology patch admits exactly the bases the label correction admits", () => {
  const labelPath = (artifact: unknown) => {
    if (!validateReviewableCollectionArtifact(artifact, (artifact as Stored).collectionId)) return { admitted: false as const };
    const entity = node(artifact as Stored, "Entity");
    const result = applyCandidatePatch(artifact, { objectId: entity.id, before: entity.label, after: "ACME Corporation" },
      { evidenceId: node(artifact as Stored, "Evidence").id, actorUserId: ACTOR.actorUserId, patchedAt: ACTOR.patchedAt });
    return result.ok ? { admitted: true as const, digest: result.artifact.manifestDigest } : { admitted: false as const };
  };
  const ontologyPath = (artifact: unknown) => {
    const entity = node(artifact as Stored, "Entity");
    try {
      const result = applyOntologyPatch(artifact, [{ op: "relabel", objectId: entity.id, before: entity.label, after: "ACME Corporation" }], ACTOR);
      return result.ok ? { admitted: true as const, digest: result.artifact.manifestDigest } : { admitted: false as const };
    } catch (error) {
      expect((error as Error).message).toBe("PATCH_BASE_INVALID");
      return { admitted: false as const };
    }
  };

  it("passed, review_required with a coordinate error, and structurally broken bases: accepted or refused identically", () => {
    const clean = fallback();
    const promoted = { ...clean, candidatePromotion: true };
    const reportDisagrees = structuredClone(clean);
    const report = reportDisagrees.package.files.find((file) => file.path === "validation/report.json")!;
    const content = report.content.replace('"status": "passed"', '"status": "review_required"');
    expect(content).not.toBe(report.content);
    Object.assign(report, { content, sizeBytes: Buffer.byteLength(content), sha256: `sha256:${sha256(content)}` });
    const cases: Array<[string, unknown, boolean]> = [
      ["passed", clean, true],
      ["review_required with COORDINATE_OUT_OF_RANGE", outOfRange(), true],
      ["candidatePromotion true", promoted, false],
      ["report status disagrees with the record", reportDisagrees, false],
    ];
    for (const [name, artifact, admitted] of cases) {
      const label = labelPath(artifact);
      const ontology = ontologyPath(artifact);
      expect(label.admitted, name).toBe(admitted);
      expect(ontology.admitted, name).toBe(admitted);
      // Where both accept the same relabel they write the same candidate.
      if (label.admitted && ontology.admitted) expect(ontology.digest, name).toBe(label.digest);
    }
  });
});

describe("evaluating an ontology patch", () => {
  const CQ = { cqId: "11111111-1111-4111-8111-111111111111", text: "When must ACME pay a valid invoice?" };

  it("reports loss, what it touches, and competency coverage before and after", () => {
    const base = fallback();
    const evaluation = evaluateOntologyPatch(base, addTopic(base), { ...ALL, questions: [CQ] });
    const applied = applyOntologyPatch(base, addTopic(base), ACTOR);
    if (!applied.ok) throw new Error(applied.refusal.code);
    const topic = applied.artifact.ontology.nodes.at(-1)!.id;

    expect(evaluation.valid).toBe(true);
    expect(evaluation.refusals).toEqual([]);
    expect(evaluation.loss).toEqual({ edgesRemoved: 0, evidenceOrphaned: 0 });
    expect(evaluation.affectedObjectIds).toEqual([node(base, "Document").id, topic].sort());
    expect(evaluation.coverage.before).toHaveLength(1);
    expect(evaluation.coverage.before[0]).toMatchObject({ cqId: CQ.cqId, status: "ANSWERABLE" });
    expect(evaluation.coverage.before[0].linkedObjectIds).not.toContain(topic);
    expect(evaluation.coverage.after[0].linkedObjectIds).toContain(topic);
    // Same input, same bytes: no clock and no randomness in the dry-run.
    expect(JSON.stringify(evaluateOntologyPatch(fallback(), addTopic(base), { ...ALL, questions: [CQ] }))).toBe(JSON.stringify(evaluation));
  });

  it("has no coverage when the World has no question set", () => {
    const base = fallback();
    expect(evaluateOntologyPatch(base, addTopic(base), { ...ALL, questions: null }).coverage).toEqual({ before: [], after: [] });
  });
});

/*
  K-5: no accepted patch orphans evidence. 1,000 generated patches over both fixtures, drawing
  every op kind against every id (supported_by and contradicts edges included), seeded so a failure
  replays. The Core-shaped base binds one claim to two regions, so removing one of its
  supported_by edges leaves the claim supported -- the case a "would it orphan?" check alone lets
  through, and the reason removal is refused outright.
*/
describe("K-5 property: evidenceOrphaned is 0 for every accepted patch", () => {
  function random(seed: number) {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function generate(base: Stored, next: () => number, pick: <T>(items: readonly T[]) => T, onSupportRemoval = () => {}) {
    const ids = [...base.ontology.nodes.map((item) => item.id), "t1", "t2"];
    const evidence = base.ontology.nodes.filter((item) => item.kind === "Evidence").map((item) => item.id);
    return Array.from({ length: 1 + Math.floor(next() * 4) }, (_, index) => {
      const kind = pick(["remove_relation", "remove_relation", "add_relation", "add_relation", "add_object", "relabel", "retype"] as const);
      if (kind === "remove_relation") {
        const edge = pick(base.ontology.edges);
        if (edge.type === "supported_by") onSupportRemoval();
        return { op: kind, edgeId: edge.id };
      }
      if (kind === "add_relation") {
        return { op: kind, from: pick(ids), to: pick(ids), type: pick(["discusses_topic", "mentions_entity", "mentions", "supported_by", "contradicts"]), evidenceIds: [pick(evidence)] };
      }
      if (kind === "add_object") {
        return { op: kind, tempId: pick(["t1", "t2"]), kind: pick(["Topic", "Entity"]), label: `Object ${index}`, evidenceIds: [pick(evidence)] };
      }
      const target = pick(base.ontology.nodes);
      if (kind === "relabel") return { op: kind, objectId: target.id, before: target.label, after: `Renamed ${index}` };
      return { op: kind, objectId: target.id, from: target.kind, to: target.kind === "Topic" ? "Entity" : "Topic" };
    });
  }

  /*
    The class behind both reviews: over bases that already carry validator errors (the compiler's
    own review_required output, and a base recorded passed that the checker refuses), every accepted
    patch raises no (code, locus) the base did not have, records every remaining code and every base
    reason as a reason, and is `passed` only when no reason is left -- never while the checker finds
    an error. A patch that removes exactly what the checker objected to may come out passed; the
    run has to find one, or it did not exercise that side.
  */
  it("over bases that already carry validator errors, an accepted patch adds none and never reads passed over one (1,000 runs)", () => {
    const bases = [outOfRange(), undeclared()];
    const next = random(20261124);
    const pick = <T,>(items: readonly T[]) => items[Math.floor(next() * items.length)];
    let accepted = 0;
    let repaired = 0;
    for (let run = 0; run < 1_000; run += 1) {
      const base = bases[run % 2];
      const ops = generate(base, next, pick);
      const evaluation = evaluateOntologyPatch(base, ops, { ...ALL, questions: null });
      const applied = applyOntologyPatch(base, ops, ACTOR);
      expect(applied.ok, canonicalize(ops)).toBe(evaluation.valid);
      if (!applied.ok) continue;
      accepted += 1;
      const patched = applied.artifact;
      const had = findingSet(base);
      for (const finding of findingSet(patched)) expect(had.has(finding), `${canonicalize(ops)} ${finding}`).toBe(true);
      const reasons = patched.validation.reviewReasons ?? [];
      for (const code of [...codes(patched), ...(base.validation.reviewReasons ?? [])]) expect(reasons, canonicalize(ops)).toContain(code);
      const status = reasons.length > 0 ? "review_required" : "passed";
      if (status === "passed") repaired += 1;
      expect(patched.validation.status, canonicalize(ops)).toBe(status);
      if (codes(patched).length > 0) expect(patched.validation.status, canonicalize(ops)).toBe("review_required");
      expect(reportOf(patched).status, canonicalize(ops)).toBe(status);
      const gate = status === "passed" ? validatePromotableCollectionArtifact : validateReviewableCollectionArtifact;
      expect(gate(patched, base.collectionId), canonicalize(ops)).not.toBeNull();
      expect(evaluation.validation, canonicalize(ops)).toEqual({ status, errorCodes: codes(patched) });
    }
    expect(accepted).toBeGreaterThan(50);
    expect(repaired).toBeGreaterThan(0);
  });

  it("holds over 1,000 generated patches", () => {
    const bases = [fallback(), coreShaped()];
    const next = random(20261123);
    const pick = <T,>(items: readonly T[]) => items[Math.floor(next() * items.length)];
    let accepted = 0;
    let supportRemovalsTried = 0;
    for (let run = 0; run < 1_000; run += 1) {
      const base = bases[run % 2];
      const ops = generate(base, next, pick, () => { supportRemovalsTried += 1; });
      const evaluation = evaluateOntologyPatch(base, ops, { ...ALL, questions: null });
      const applied = applyOntologyPatch(base, ops, ACTOR);
      expect(applied.ok, canonicalize(ops)).toBe(evaluation.valid);
      if (!applied.ok) continue;
      accepted += 1;
      expect(evaluation.loss.evidenceOrphaned, canonicalize(ops)).toBe(0);
      const kept = new Set(applied.artifact.ontology.edges.filter((edge) => edge.type === "supported_by").map((edge) => `${edge.id}|${edge.from}|${edge.to}`));
      for (const edge of edgesOf(base, "supported_by")) expect(kept.has(`${edge.id}|${edge.from}|${edge.to}`), canonicalize(ops)).toBe(true);
      expect(errors(applied.artifact), canonicalize(ops)).toEqual([]);
    }
    // The run is only evidence if it exercised both sides.
    expect(accepted).toBeGreaterThan(50);
    expect(supportRemovalsTried).toBeGreaterThan(100);
  });
});
