import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compileCollectionCandidate, type CollectionOcrInput } from "./collection-compiler";
import { buildWorldReadModel } from "./world-read-model";

/*
  The two lenses that were showing something adjacent to the truth.

  The directory lens grouped compiled objects by `object.type` and drew folders. It looked
  like a directory and was a different object: it could not show a path, could not show a root
  the compile left empty, and could not say which documents a folder came from. The compiler
  emits all three in `directoryPlan`, and the read model now carries them.

  The ontology lens listed distinct type strings and distinct predicate strings. What an
  ontology view has to answer is what classes exist, what properties relate them, what those
  properties actually connect, and how much of it is evidence-backed. The first two were
  there; the last two were not.
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

const source = (() => {
  const base = compileCollectionCandidate([
    input("contract-a", "a".repeat(64), "ACME Corporation shall pay every valid invoice within 30 calendar days."),
    input("contract-b", "b".repeat(64), "ACME Corporation requires written approval before changing payment terms."),
  ]);
  return {
    ...base,
    coreExecution: {
      status: "completed" as const,
      runtime: "tavonel-python-core-v2",
      worldStateId: "world-state-1",
      receipt: { requestId: "lens-test", outputSha256: `sha256:${"c".repeat(64)}`, candidatePromotion: false as const },
    },
  };
})();

const model = buildWorldReadModel(source, source.collectionId, { origin: "deterministic_sample" })!;

describe("the compiled directory", () => {
  it("is the compiler's plan, path for path", () => {
    expect(model.directory.length).toBe(source.directoryPlan.length);
    const planned = new Set(source.directoryPlan.map((entry) => entry.path));
    for (const entry of model.directory) expect(planned.has(entry.path)).toBe(true);
  });

  it("carries the paths and kinds that a type grouping could not produce", () => {
    // A leaf under a root, with the compiler's own kind. Grouping objects by `type` produces
    // neither: there is no path to group by and no kind other than the object's own.
    const leaf = model.directory.find((entry) => entry.path.startsWith("Sources/") && entry.kind === "document");
    expect(leaf).toBeDefined();
    expect(leaf!.sourceIds.length).toBeGreaterThan(0);
  });

  it("keeps a root the compile left empty", () => {
    // `Assets` is planned and this corpus produces nothing under it. That is a fact about the
    // World; dropping it would present the compile as having produced something it did not.
    const roots = model.directory.filter((entry) => entry.kind === "root").map((entry) => entry.path);
    expect(roots).toContain("Assets");
    expect(model.directory.some((entry) => entry.path.startsWith("Assets/"))).toBe(false);
  });

  it("accumulates sources for a path two documents both wrote", () => {
    // Both documents mention the same entity, so the entity's planned path is derived from
    // both. A last-write-wins merge would drop one and misattribute the folder.
    const shared = model.directory.filter((entry) => entry.sourceIds.length > 1);
    expect(shared.length).toBeGreaterThan(0);
  });

  it("is ordered, so two renders of the same World agree", () => {
    const paths = model.directory.map((entry) => entry.path);
    expect(paths).toEqual([...paths].sort((left, right) => left.localeCompare(right)));
  });
});

describe("the compiled ontology", () => {
  it("counts instances and evidence coverage per class", () => {
    for (const entry of model.ontology.classes) {
      expect(entry.instances).toBe(model.objects.filter((object) => object.type === entry.name).length);
      expect(entry.withEvidence).toBeLessThanOrEqual(entry.instances);
    }
    expect(model.ontology.classes.length).toBeGreaterThan(1);
  });

  it("reports the domain and range each property was actually used between", () => {
    const property = model.ontology.properties.find((entry) => entry.name === "discusses_topic");
    expect(property).toBeDefined();
    // Observed, not declared: this is what the compile produced, and the viewer labels it so.
    expect(property!.domain).toEqual(["Document"]);
    expect(property!.range).toEqual(["Topic"]);
    expect(property!.usages).toBe(model.relations.filter((relation) => relation.predicate === "discusses_topic").length);
  });

  it("refuses to invent a class hierarchy the artifact does not contain", () => {
    // The compiler emits no subclass axioms. A plausible tree here would be structure the
    // customer would then reason about, which is exactly the fabrication that is forbidden.
    expect(model.ontology.hierarchy.state).toBe("not_yet");
  });

  it("names where the ontology leaves the product", () => {
    const paths = model.ontology.exports.map((file) => file.path);
    expect(paths).toContain("ontology/knowledge.ttl");
    expect(paths).toContain("ontology/knowledge.jsonld");
    expect(paths).toContain("graph/nodes.csv");
    for (const file of model.ontology.exports) expect(file.sha256).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});

describe("the lenses that render them", () => {
  const studio = readFileSync(new URL("../components/world-studio-ultimate.tsx", import.meta.url), "utf8");

  it("no longer draws the graph as a grid of cards", () => {
    expect(studio).toContain("<WorldGraphCanvas");
    expect(studio).not.toContain("aria-label=\"Compiled relations\"");
  });

  it("no longer groups objects by type and calls it a directory", () => {
    expect(studio).toContain("<WorldDirectoryTree");
    expect(studio).not.toContain("model.objects.map((object) => object.type)");
  });

  it("renders the ontology from the read model rather than from distinct strings", () => {
    expect(studio).toContain("<WorldOntologyViewer");
    expect(studio).not.toContain("model.relations.map((relation) => relation.predicate)");
  });
});
