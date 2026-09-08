import { describe, expect, it } from "vitest";
import { exploreSampleDocuments, exploreSampleWorld } from "./explore-sample";
import {
  FOCUS_MAX,
  FOCUS_MIN,
  PRESENTATION_OBJECTS,
  PRESENTATION_OBJECT_KIND,
  STAGE_HEIGHT,
  STAGE_WIDTH,
  layoutVisualWorld,
  resolvePresentationObjects,
  toVisualWorldModel,
} from "./visual-world-model";

/*
  The adapter is the only place that reads a compiled World, so it is the only place that could
  quietly invent one. Every test here is a version of the same question: is what the renderer
  will draw still what the compiler emitted?

  The focus rule gets the most attention because it is the rule most likely to be replaced by a
  list of ids the day someone wants a nicer-looking opening frame. A hand-typed list would pass
  a "the composition looks right" review and would be a fabricated view of a real World.
*/

const model = toVisualWorldModel(exploreSampleWorld, exploreSampleDocuments);

describe("the adapter reports the World and nothing else", () => {
  it("carries every compiled object across, and no others", () => {
    expect(model.nodes.map((node) => node.id).sort()).toEqual(
      exploreSampleWorld.objects.map((object) => object.id).sort(),
    );
    expect(model.edges.map((edge) => edge.id).sort()).toEqual(
      exploreSampleWorld.relations.map((relation) => relation.id).sort(),
    );
    expect(model.evidence.map((item) => item.id).sort()).toEqual(
      exploreSampleWorld.evidence.map((item) => item.id).sort(),
    );
  });

  it("keeps each edge between two objects that exist", () => {
    const ids = new Set(model.nodes.map((node) => node.id));
    for (const edge of model.edges) {
      expect(ids.has(edge.from), edge.id).toBe(true);
      expect(ids.has(edge.to), edge.id).toBe(true);
    }
  });

  it("labels an object with the compiler's own label, except a source bundle and a filing", () => {
    /*
      Two rewrites, and both restate the same fact in words a reader can use.

      An Evidence node's storage key becomes the filename of the document its regions came from,
      and a Document node's first-line-of-text title becomes the filing it is. Neither invents
      anything: the filename has to be a file in the repository, and the filing label has to be
      the form and filing date of a source record. Every other label is the compiler's, verbatim.
    */
    const labelById = new Map(exploreSampleWorld.objects.map((object) => [object.id, object.label] as const));
    const filenames = new Set(exploreSampleDocuments.map((document) => document.filename));
    const filingLabels = new Set(
      exploreSampleDocuments.map((document) => `${document.form} · filed ${document.filingDate}`),
    );
    for (const node of model.nodes) {
      if (node.kind === "Evidence") expect(filenames.has(node.label), node.id).toBe(true);
      else if (node.kind === "Document") expect(filingLabels.has(node.label), node.id).toBe(true);
      else expect(node.label).toBe(labelById.get(node.id));
    }
  });

  it("binds every region to a committed document", () => {
    const byId = new Map(exploreSampleDocuments.map((document) => [document.documentId, document] as const));
    for (const region of model.evidence) {
      const document = byId.get(region.sourceId);
      expect(document, region.id).toBeTruthy();
      expect(region.filename).toBe(document!.filename);
      expect(region.href).toBe(document!.href);
      expect(region.pageCount).toBe(document!.pageCount);
      expect(region.page).toBeLessThanOrEqual(region.pageCount);
    }
  });

  it("leads each claim with the region that states it, and drops none of the others", () => {
    /*
      The compiler binds a claim to every region of its document, so the first ref is otherwise
      whichever line the extractor read first -- the title. The Evidence act opens the first ref
      and draws a tether to it, which would point at a line that does not contain the claim.
      Ordering is allowed here. Losing a ref, or inventing one, is not.
    */
    const objectById = new Map(exploreSampleWorld.objects.map((object) => [object.id, object] as const));
    const excerptOf = new Map(exploreSampleWorld.evidence.map((item) => [item.id, item.excerpt] as const));
    let checked = 0;
    for (const node of model.nodes) {
      expect([...node.evidenceRefs].sort()).toEqual([...objectById.get(node.id)!.evidenceRefs].sort());
      if (node.kind !== "Claim") continue;
      const stating = node.evidenceRefs.filter((id) => (excerptOf.get(id) ?? "").includes(node.label));
      if (stating.length !== 1) continue;
      expect(node.evidenceRefs[0], node.label).toBe(stating[0]);
      checked += 1;
    }
    // The rule would be worth nothing if this fixture never exercised it.
    expect(checked).toBeGreaterThan(0);
  });

  it("declares a deterministic sample as a sample, not as a pending candidate", () => {
    expect(model.status).toBe("sample");
    expect(model.revisions.every((revision) => revision.status === "sample")).toBe(true);
    expect(model.manifestDigest).toBe(exploreSampleWorld.world.manifestDigest);
  });
});

describe("the opening composition is chosen, not written", () => {
  it("names only objects the World contains", () => {
    const ids = new Set(exploreSampleWorld.objects.map((object) => object.id));
    expect(model.focus.length).toBeGreaterThan(0);
    for (const id of model.focus) expect(ids.has(id), id).toBe(true);
    expect(new Set(model.focus).size).toBe(model.focus.length);
  });

  it("stays inside the 7-12 band the stage is designed for", () => {
    expect(model.focus.length).toBeGreaterThanOrEqual(FOCUS_MIN);
    expect(model.focus.length).toBeLessThanOrEqual(FOCUS_MAX);
  });

  it("resolves every declared presentation object against the compiled artifact", () => {
    /*
      The guarantee behind a declared mapping (§11.4).

      A hand-written list of labels is only honest while every entry still names a real compiled
      object. If the corpus, the page slice or the extractor moves under it, an entry stops
      matching and the composition quietly loses a node -- so this is the test that has to fail
      the build, not a rendering that has to look wrong.
    */
    const byId = new Map(exploreSampleWorld.objects.map((object) => [object.id, object] as const));
    const resolved = resolvePresentationObjects(exploreSampleWorld);
    expect(resolved.length, PRESENTATION_OBJECTS.join(", ")).toBe(PRESENTATION_OBJECTS.length);
    resolved.forEach((id, index) => {
      const object = byId.get(id);
      expect(object, PRESENTATION_OBJECTS[index]).toBeTruthy();
      // Kind and label both, verbatim: the node label a reader sees is the compiler's own.
      expect(object!.type).toBe(PRESENTATION_OBJECT_KIND);
      expect(object!.label).toBe(PRESENTATION_OBJECTS[index]);
      expect(object!.evidenceRefs.length, PRESENTATION_OBJECTS[index]).toBeGreaterThan(0);
    });
    // Each label names one object, so the mapping cannot silently pick a different one.
    for (const label of PRESENTATION_OBJECTS) {
      const matches = exploreSampleWorld.objects.filter(
        (object) => object.type === PRESENTATION_OBJECT_KIND && object.label === label,
      );
      expect(matches.length, label).toBe(1);
    }
  });

  it("draws the filings and the mapped objects, and nothing else", () => {
    const kindOf = new Map(model.nodes.map((node) => [node.id, node.kind] as const));
    const mapped = new Set(resolvePresentationObjects(exploreSampleWorld));
    for (const id of model.focus) {
      // Every drawn node is either a compiled filing or a declared entry -- never a heuristic
      // entity that a fallback rule promoted into the opening frame.
      expect(kindOf.get(id) === "Document" || mapped.has(id), id).toBe(true);
    }
    expect(model.focus.filter((id) => mapped.has(id))).toEqual([...mapped]);
  });

  it("gives every drawn node real evidence and a real relation count", () => {
    // The two numbers the composition prints under a node, checked against the artifact: a
    // filing shows its own regions, a mapped object shows how many compiled relations reach it.
    const regionIds = new Set(exploreSampleWorld.evidence.map((item) => item.id));
    for (const id of model.focus) {
      const node = model.nodes.find((item) => item.id === id)!;
      expect(node.evidenceRefs.length, node.label).toBeGreaterThan(0);
      for (const ref of node.evidenceRefs) expect(regionIds.has(ref), ref).toBe(true);
      expect(node.degree, node.label).toBe(
        exploreSampleWorld.relations.filter(
          (relation) => relation.subject === id || relation.object === id,
        ).length,
      );
      expect(node.degree, node.label).toBeGreaterThan(0);
    }
  });

  it("draws every compiled filing exactly once", () => {
    /*
      The corpus is five separate public filings, and the whole point of the composition is that
      it shows them as five separate objects rather than as one blurred "source". A filing that
      silently dropped out of the opening frame would be a picture of a smaller corpus.
    */
    const documents = exploreSampleWorld.objects.filter((object) => object.type === "Document");
    expect(documents.length).toBe(exploreSampleDocuments.length);
    for (const document of documents) expect(model.focus, document.id).toContain(document.id);
  });

  it("keeps both halves of the subset when the budget forces a cut", () => {
    const tight = toVisualWorldModel(exploreSampleWorld, exploreSampleDocuments, { focusLimit: 8 });
    const kindOf = new Map(tight.nodes.map((node) => [node.id, node.kind] as const));
    expect(tight.focus.length).toBeLessThanOrEqual(8);
    // A budget that cannot hold the whole subset still has to show both what the sources are and
    // what the World says about them -- every filing, then as much of the mapping as fits.
    expect(tight.focus.filter((id) => kindOf.get(id) === "Document").length).toBeGreaterThan(0);
    expect(tight.focus.filter((id) => kindOf.get(id) === PRESENTATION_OBJECT_KIND).length).toBeGreaterThan(0);
  });

  it("returns the same composition every time it is asked", () => {
    expect(toVisualWorldModel(exploreSampleWorld, exploreSampleDocuments).focus).toEqual(model.focus);
  });
});

describe("the layout is geometry, not a simulation", () => {
  const layout = layoutVisualWorld(model);

  it("places every focus object exactly once", () => {
    expect(layout.placements.map((placement) => placement.id).sort()).toEqual([...model.focus].sort());
  });

  it("keeps every object inside the 16:10 frame", () => {
    expect(layout.width / layout.height).toBeCloseTo(1.6, 5);
    for (const placement of layout.placements) {
      expect(placement.x, placement.id).toBeGreaterThan(0);
      expect(placement.x, placement.id).toBeLessThan(STAGE_WIDTH);
      expect(placement.y, placement.id).toBeGreaterThan(0);
      expect(placement.y, placement.id).toBeLessThan(STAGE_HEIGHT);
    }
  });

  it("gives each kind its own column, in the declared order", () => {
    const roles = new Map(layout.placements.map((placement) => [placement.id, placement] as const));
    const kindOf = new Map(model.nodes.map((node) => [node.id, node.kind] as const));
    const hubs = layout.placements.filter((placement) => placement.role === "hub");
    expect(hubs.length).toBeGreaterThan(1);
    expect(new Set(hubs.map((hub) => hub.column)).size).toBe(hubs.length);
    // One kind per column, and the columns run in focus order left to right -- the filings
    // first, then the mapped objects.
    const kindByColumn = new Map<number, string>();
    for (const placement of layout.placements) {
      const kind = kindOf.get(placement.id)!;
      expect(kindByColumn.get(placement.column) ?? kind).toBe(kind);
      kindByColumn.set(placement.column, kind);
    }
    expect([...kindByColumn.entries()].sort((left, right) => left[0] - right[0]).map(([, kind]) => kind))
      .toEqual(["Document", PRESENTATION_OBJECT_KIND]);
    for (const edge of layout.edges) {
      // Every drawn line is a compiled relation between two drawn objects.
      expect(model.edges.some((item) => item.id === edge.id)).toBe(true);
      expect(roles.has(edge.from) && roles.has(edge.to)).toBe(true);
    }
  });

  it("draws the same composition twice", () => {
    expect(layoutVisualWorld(model)).toEqual(layout);
  });
});
