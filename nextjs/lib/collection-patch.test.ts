import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { applyCandidatePatch } from "./collection-patch";
import {
  advertisedOntologyRelations,
  compileCollectionCandidate,
  type CollectionOcrInput,
} from "./collection-compiler";
import { validateReviewableCollectionArtifact } from "./collection-download";

/*
  A reviewer's correction, checked for the two things that make it a correction rather than
  vandalism: the new artifact is internally consistent, and the old one still exists.

  The interesting failure is not "the label did not change". It is a patched artifact that
  still validates while its graph and its RDF disagree -- four package files embed a label, and
  rewriting three of them produces something that passes every check and is wrong.
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

function stored() {
  const base = compileCollectionCandidate([
    input("contract-a", "a".repeat(64), "ACME Corporaton shall pay every valid invoice within 30 calendar days."),
    input("contract-b", "b".repeat(64), "ACME Corporaton requires written approval before changing payment terms."),
  ]);
  return {
    ...base,
    coreExecution: {
      status: "completed" as const,
      runtime: "tavonel-python-core-v2",
      worldStateId: "world-state-1",
      receipt: { requestId: "patch-test", outputSha256: `sha256:${"c".repeat(64)}`, candidatePromotion: false as const },
    },
  };
}

const context = { evidenceId: "evidence-1", actorUserId: "11111111-1111-4111-8111-111111111111", patchedAt: "2026-09-03T00:00:00.000Z" };

function entityNode(artifact: ReturnType<typeof stored>) {
  return artifact.ontology.nodes.find((node) => node.kind === "Entity")!;
}

describe("correcting a compiled label", () => {
  it("produces a new candidate and leaves the reviewed one untouched", () => {
    const artifact = stored();
    const target = entityNode(artifact);
    const before = artifact.manifestDigest;
    const result = applyCandidatePatch(artifact, { objectId: target.id, before: target.label, after: "ACME Corporation" }, context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifact.manifestDigest).not.toBe(before);
    // The input object is not mutated: it lands under its own key and stays readable.
    expect(artifact.manifestDigest).toBe(before);
    expect(entityNode(artifact).label).toBe(target.label);
  });

  it("rewrites every package file that embeds the label, not some of them", () => {
    const artifact = stored();
    const target = entityNode(artifact);
    const result = applyCandidatePatch(artifact, { objectId: target.id, before: target.label, after: "ACME Corporation" }, context);
    if (!result.ok) throw new Error(result.code);

    const fileOf = (path: string) => result.artifact.package.files.find((file) => file.path === path)!;

    /*
      Checked per representation, against this node, rather than by searching for the old
      string anywhere in the file.

      A blunt "the misspelling is gone" would fail correctly and for the wrong reason: the
      Claim node's label is the whole sentence and still contains it, which is right -- the
      claim was not the thing corrected. Four files, four different serialisations of the same
      node, and each has to agree with the others or the artifact validates while lying.
    */
    const canonical = JSON.parse(fileOf("canonical/model.json").content) as {
      nodes: Array<{ id: string; label: string }>;
    };
    expect(canonical.nodes.find((node) => node.id === target.id)?.label).toBe("ACME Corporation");

    expect(fileOf("ontology/knowledge.ttl").content)
      .toContain(`<urn:tavonel:${target.id}> a tav:Entity ; rdfs:label "ACME Corporation" .`);

    const jsonld = JSON.parse(fileOf("ontology/knowledge.jsonld").content) as {
      "@graph": Array<{ "@id": string; label: string }>;
    };
    expect(jsonld["@graph"].find((node) => node["@id"] === `urn:tavonel:${target.id}`)?.label).toBe("ACME Corporation");

    const row = fileOf("graph/nodes.csv").content.split("\n").find((line) => line.startsWith(`"${target.id}"`));
    expect(row).toContain('"ACME Corporation"');

    // And the package entry's own size and digest move with the content, or a consumer
    // verifying the package finds a file that does not match its own manifest.
    for (const path of ["canonical/model.json", "ontology/knowledge.ttl", "ontology/knowledge.jsonld", "graph/nodes.csv"]) {
      const before = artifact.package.files.find((file) => file.path === path)!;
      expect(fileOf(path).sizeBytes).toBe(Buffer.byteLength(fileOf(path).content, "utf8"));
      expect(fileOf(path).sha256).not.toBe(before.sha256);
    }
  });

  it("does not rewrite what the page said", () => {
    const artifact = stored();
    const target = entityNode(artifact);
    const result = applyCandidatePatch(artifact, { objectId: target.id, before: target.label, after: "ACME Corporation" }, context);
    if (!result.ok) throw new Error(result.code);
    // The excerpt is evidence of the source. A corrected label is an assertion about it.
    const chunks = result.artifact.package.files.find((file) => file.path === "rag/chunks.jsonl")!;
    expect(chunks.content).toContain("ACME Corporaton");
    expect(chunks.sha256).toBe(artifact.package.files.find((file) => file.path === "rag/chunks.jsonl")!.sha256);
  });

  it("leaves evidence bindings exactly as they were", () => {
    const artifact = stored();
    const target = entityNode(artifact);
    const result = applyCandidatePatch(artifact, { objectId: target.id, before: target.label, after: "ACME Corporation" }, context);
    if (!result.ok) throw new Error(result.code);
    expect(result.artifact.ontology.edges).toEqual(artifact.ontology.edges);
    expect(result.artifact.sourceDocuments).toEqual(artifact.sourceDocuments);
    for (const node of result.artifact.ontology.nodes) {
      const original = artifact.ontology.nodes.find((item) => item.id === node.id)!;
      expect(node.evidenceIds).toEqual(original.evidenceIds);
    }
  });

  it("still validates as a reviewable candidate", () => {
    const artifact = stored();
    const target = entityNode(artifact);
    const result = applyCandidatePatch(artifact, { objectId: target.id, before: target.label, after: "ACME Corporation" }, context);
    if (!result.ok) throw new Error(result.code);
    expect(validateReviewableCollectionArtifact(result.artifact, artifact.collectionId)).not.toBeNull();
  });

  it("records who changed what, and what came out", () => {
    const artifact = stored();
    const target = entityNode(artifact);
    const result = applyCandidatePatch(artifact, { objectId: target.id, before: target.label, after: "ACME Corporation" }, context);
    if (!result.ok) throw new Error(result.code);
    expect(result.artifact.reviewPatch).toEqual({
      schemaVersion: "tavonel.review_patch.v1",
      derivedFromManifestDigest: artifact.manifestDigest,
      objectId: target.id,
      before: target.label,
      after: "ACME Corporation",
      evidenceId: context.evidenceId,
      actorUserId: context.actorUserId,
      patchedAt: context.patchedAt,
    });
  });

  it("stops the Core receipt from attesting content the Core never produced", () => {
    const artifact = stored();
    const target = entityNode(artifact);
    const result = applyCandidatePatch(artifact, { objectId: target.id, before: target.label, after: "ACME Corporation" }, context);
    if (!result.ok) throw new Error(result.code);
    expect(result.artifact.coreExecution!.runtime).toBe("tavonel-python-core-v2+human-review");
    expect(result.artifact.coreExecution!.receipt.outputSha256).toBe(result.artifact.manifestDigest);
    expect(result.artifact.coreExecution!.receipt.derivedFromManifestDigest).toBe(artifact.manifestDigest);
  });
});

describe("what a correction may not do", () => {
  const artifact = stored();

  it("refuses a stale before, because someone else got there first", () => {
    const target = entityNode(artifact);
    const result = applyCandidatePatch(artifact, { objectId: target.id, before: "something else", after: "ACME Corporation" }, context);
    expect(result).toEqual({ ok: false, code: "PATCH_BEFORE_MISMATCH" });
  });

  it("refuses to rewrite a Document title or an Evidence key", () => {
    for (const kind of ["Document", "Evidence"] as const) {
      const node = artifact.ontology.nodes.find((item) => item.kind === kind)!;
      const result = applyCandidatePatch(artifact, { objectId: node.id, before: node.label, after: "anything" }, context);
      expect(result).toEqual({ ok: false, code: "PATCH_TARGET_NOT_EDITABLE" });
    }
  });

  it("refuses an empty, oversized or control-character label", () => {
    const target = entityNode(artifact);
    for (const after of ["", "   ", "x".repeat(501), `bad${String.fromCharCode(9)}tab`]) {
      const result = applyCandidatePatch(artifact, { objectId: target.id, before: target.label, after }, context);
      expect(result.ok).toBe(false);
    }
  });

  it("refuses a patch that changes nothing", () => {
    const target = entityNode(artifact);
    const result = applyCandidatePatch(artifact, { objectId: target.id, before: target.label, after: target.label }, context);
    expect(result).toEqual({ ok: false, code: "PATCH_NO_CHANGE" });
  });

  it("refuses an object that is not in this World", () => {
    const result = applyCandidatePatch(artifact, { objectId: "entity-does-not-exist", before: "x", after: "y" }, context);
    expect(result).toEqual({ ok: false, code: "PATCH_TARGET_NOT_FOUND" });
  });

  it("does not clear a review requirement", () => {
    const flagged = { ...stored(), lifecycle: "review_required" as const, reviewReasons: ["low confidence region"] };
    const target = entityNode(flagged);
    const result = applyCandidatePatch(flagged, { objectId: target.id, before: target.label, after: "ACME Corporation" }, context);
    if (!result.ok) throw new Error(result.code);
    // A human fixing a spelling has not resolved whatever made the compiler ask for review.
    expect(result.artifact.lifecycle).toBe("review_required");
    expect(result.artifact.reviewReasons).toEqual(["low confidence region"]);
    expect(result.artifact.candidatePromotion).toBe(false);
  });
});

describe("the ledger the correction is written to", () => {
  const migration = readFileSync(
    resolve(import.meta.dirname, "../../supabase/migrations/0039_foundation_review_patches.sql"),
    "utf8",
  );

  it("records the whole audit trail the masterplan names", () => {
    for (const column of ["patch_object_id", "patch_before", "patch_after", "resulting_manifest_digest"]) {
      expect(migration).toContain(column);
    }
    // Actor and timestamp were already there in 0037.
    const original = readFileSync(
      resolve(import.meta.dirname, "../../supabase/migrations/0037_foundation_review_decisions.sql"),
      "utf8",
    );
    expect(original).toContain("actor_user_id");
    expect(original).toContain("created_at");
  });

  it("refuses a half-written patch, which would look like an audit trail without being one", () => {
    expect(migration).toContain("foundation_review_decisions_patch_is_whole");
    expect(migration).toContain("action = 'edit'");
    expect(migration).toContain("patch_before is distinct from patch_after");
  });
});

/*
  A correction to a Core V2 candidate must not rewrite its blueprint into the fallback's.

  `materializeLabelDerivedFiles` defaults `blueprint` to `GENERIC_MIXED_CORPUS_BLUEPRINT`,
  whose `ontologyRelations` is the fallback's three predicates. `scripts/compiled-world/
  validate.mjs` reads that list out of `canonical/model.json` as the allowlist an edge predicate
  must be inside (PREDICATE_UNDECLARED) -- so re-materialising a Core V2 candidate with the
  default wrote a canonical model declaring predicates the artifact does not contain and
  omitting the two it does. A reviewer fixing a spelling would have invalidated the package.

  The fixture reshapes the fallback candidate into a V2-shaped one -- the artifact's own
  blueprint, and the live engine's edge vocabulary -- because what is under test here is the
  pass-through. The projection that produces such an artifact is covered in
  `core-runtime-v2.test.ts`, and reading one back in `world-read-model-core-v2.test.ts`.
*/
describe("correcting a label on a Core V2 candidate", () => {
  function coreShaped() {
    const base = stored();
    const claims = base.ontology.nodes.filter((node) => node.kind === "Claim");
    const entity = entityNode(base);
    const evidence = base.ontology.nodes.filter((node) => node.kind === "Evidence");
    if (claims.length < 2 || evidence.length < 2) throw new Error("fixture needs two claims and two evidence nodes");
    const edges = [
      { id: "relation-core-supported", type: "supported_by" as const, from: claims[0].id, to: evidence[0].id, evidenceIds: [...evidence[0].evidenceIds] },
      { id: "relation-core-mentions", type: "mentions" as const, from: claims[0].id, to: entity.id, evidenceIds: [...evidence[0].evidenceIds] },
      {
        id: "relation-core-contradicts",
        type: "contradicts" as const,
        from: claims[0].id,
        to: claims[1].id,
        evidenceIds: [...evidence[0].evidenceIds, ...evidence[1].evidenceIds],
        reason: "numeric_disagreement" as const,
      },
    ];
    return {
      ...base,
      blueprint: { ...base.blueprint, ontologyRelations: advertisedOntologyRelations(edges) },
      ontology: { nodes: base.ontology.nodes, edges },
    };
  }

  it("declares its own predicate set, not the fallback's", () => {
    const artifact = coreShaped();
    const target = entityNode(artifact);
    const result = applyCandidatePatch(artifact, { objectId: target.id, before: target.label, after: "ACME Corporation" }, context);
    if (!result.ok) throw new Error(result.code);

    const canonical = JSON.parse(
      result.artifact.package.files.find((file) => file.path === "canonical/model.json")!.content,
    ) as { blueprint: { ontologyRelations: string[] }; nodes: Array<{ id: string; label: string }>; edges: Array<{ type: string }> };

    expect(canonical.blueprint.ontologyRelations).toEqual(["contradicts", "mentions", "supported_by"]);
    expect(canonical.blueprint.ontologyRelations).toEqual(artifact.blueprint.ontologyRelations);
    // Every predicate the regenerated model contains is one the same file declares. That is the
    // property `validate.mjs` checks, and the reason the default was wrong here.
    for (const edge of canonical.edges) expect(canonical.blueprint.ontologyRelations).toContain(edge.type);
    expect(canonical.blueprint.ontologyRelations, "the live engine has no Topic object at all")
      .not.toContain("discusses_topic");
    // And the correction itself still happened.
    expect(canonical.nodes.find((node) => node.id === target.id)?.label).toBe("ACME Corporation");
  });

  it("still validates as a reviewable candidate", () => {
    const artifact = coreShaped();
    const target = entityNode(artifact);
    const result = applyCandidatePatch(artifact, { objectId: target.id, before: target.label, after: "ACME Corporation" }, context);
    if (!result.ok) throw new Error(result.code);
    expect(validateReviewableCollectionArtifact(result.artifact, artifact.collectionId)).not.toBeNull();
  });
});
