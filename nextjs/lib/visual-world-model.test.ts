import { describe, expect, it } from "vitest";
import { exploreSampleDocuments, exploreSampleWorld } from "./explore-sample";
import {
  FOCUS_MAX,
  FOCUS_MIN,
  STAGE_HEIGHT,
  STAGE_WIDTH,
  layoutVisualWorld,
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

  it("labels an object with the compiler's own label, except a source bundle", () => {
    const labelById = new Map(exploreSampleWorld.objects.map((object) => [object.id, object.label] as const));
    const filenames = new Set(exploreSampleDocuments.map((document) => document.filename));
    for (const node of model.nodes) {
      if (node.kind === "Evidence") {
        // The one rewrite this module makes: a storage key becomes the filename of the document
        // its regions came from. It must be a file that is actually in the repository.
        expect(filenames.has(node.label), node.id).toBe(true);
      } else {
        expect(node.label).toBe(labelById.get(node.id));
      }
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

  it("draws claims and their sources, and no heuristic entity label", () => {
    const kindOf = new Map(model.nodes.map((node) => [node.id, node.kind] as const));
    const kinds = new Set(model.focus.map((id) => kindOf.get(id)));
    expect(kinds.has("Claim")).toBe(true);
    expect(kinds.has("Evidence")).toBe(true);
    expect(kinds.has("Entity")).toBe(false);
  });

  it("does not draw a claim that only repeats its document's title", () => {
    const labelOf = new Map(model.nodes.map((node) => [node.id, node.label] as const));
    const documentLabels = new Set(
      exploreSampleWorld.objects.filter((object) => object.type === "Document").map((object) => object.label),
    );
    for (const id of model.focus) {
      if (!id.startsWith("claim-")) continue;
      expect(documentLabels.has(labelOf.get(id) ?? ""), id).toBe(false);
    }
  });

  it("keeps every source in the composition when the budget forces a cut", () => {
    const tight = toVisualWorldModel(exploreSampleWorld, exploreSampleDocuments, { focusLimit: 8 });
    const kindOf = new Map(tight.nodes.map((node) => [node.id, node.kind] as const));
    const sources = tight.focus.filter((id) => kindOf.get(id) === "Evidence");
    expect(tight.focus.length).toBeLessThanOrEqual(8);
    expect(sources.length).toBe(model.focus.filter((id) => kindOf.get(id) === "Evidence").length);
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

  it("gives each source a column and hangs its claims on it", () => {
    const roles = new Map(layout.placements.map((placement) => [placement.id, placement] as const));
    const hubs = layout.placements.filter((placement) => placement.role === "hub");
    expect(hubs.length).toBeGreaterThan(1);
    expect(new Set(hubs.map((hub) => hub.column)).size).toBe(hubs.length);
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
