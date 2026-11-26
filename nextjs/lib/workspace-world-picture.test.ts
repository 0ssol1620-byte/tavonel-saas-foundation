import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  adaptWorldForPicture,
  fallbackGraphics,
  PICTURE_LIVE_MIN_WIDTH,
  PICTURE_LIVE_QUERY,
  pictureBranch,
  pictureScreenStatus,
  showingLine,
} from "./workspace-world-picture";
import { KIND_COLORS, layoutWorld } from "./v34/world-geometry";
import type { WorldReadModel } from "./world-read-model";

/*
  WO-WS-5: the adapter from the World read model to the renderer's corpus, the cap, the legend, the branch decisions.
  Every case reads a hand-built read model; nothing here is a sample the workspace could draw.
*/

type Obj = { id: string; type: WorldReadModel["objects"][number]["type"]; evidenceRefs?: string[] };
const object = ({ id, type, evidenceRefs = [] }: Obj): WorldReadModel["objects"][number] => ({
  id, stableKey: id, label: `label ${id}`, type, status: "active", aliases: { state: "not_yet", reason: "x" }, claims: [], relations: [],
  evidenceRefs, sourceVersions: [], firstSeen: { state: "not_yet", reason: "x" }, lastChanged: { state: "not_yet", reason: "x" }, readState: "read",
});
const relation = (id: string, subject: string, objectId: string): WorldReadModel["relations"][number] =>
  ({ id, subject, predicate: "mentions", object: objectId, evidenceRefs: [], version: "v1", status: "active" });
const evidence = (id: string): WorldReadModel["evidence"][number] =>
  ({ id, sourceId: "doc-1", sourceVersionId: "ver-1", page: 1, bbox: [0, 0, 10, 10], blockId: "b1", excerpt: "x", authority: "a", digest: "d" });

const model = (parts: { objects: WorldReadModel["objects"]; relations?: WorldReadModel["relations"]; evidence?: WorldReadModel["evidence"]; status?: "active" | "candidate"; revision?: WorldReadModel["world"]["revision"] }): WorldReadModel =>
  ({
    world: { id: "w", manifestDigest: "sha256:x", status: parts.status ?? "active", revision: parts.revision ?? { state: "read", value: 3 } },
    objects: parts.objects, relations: parts.relations ?? [], evidence: parts.evidence ?? [],
  }) as unknown as WorldReadModel;

const small = model({
  objects: [object({ id: "d1", type: "Document" }), object({ id: "t1", type: "Topic" }), object({ id: "e1", type: "Entity", evidenceRefs: ["ev1", "gone"] }), object({ id: "c1", type: "Claim" }), object({ id: "v1", type: "Evidence", evidenceRefs: ["nope"] })],
  relations: [relation("r1", "d1", "t1"), relation("r2", "t1", "e1"), relation("r3", "e1", "c1"), relation("r4", "c1", "missing")],
  evidence: [evidence("ev1")],
});

describe("the adapter reads only what the World holds", () => {
  it("maps each object type to a renderer kind and keeps every real relation", () => {
    const p = adaptWorldForPicture(small);
    expect(p.corpus.nodes.map((n) => [n.id, n.kind])).toEqual([["c1", "Claim"], ["d1", "Source"], ["e1", "Entity"], ["t1", "Concept"], ["v1", "Change"]]);
    expect(p.corpus.edges).toEqual([
      { a: "d1", b: "t1", relation: "mentions" },
      { a: "t1", b: "e1", relation: "mentions" },
      { a: "e1", b: "c1", relation: "mentions" },
    ]);
    expect(p.corpus.sources).toEqual({});
  });

  it("does not draw a relation to an object the World lacks, and counts it", () => {
    const p = adaptWorldForPicture(small);
    expect(p.unresolvedRelations).toBe(1);
    expect(p.totals).toEqual({ objects: 5, relations: 4 });
    expect(p.drawn).toEqual({ objects: 5, relations: 3 });
    expect(showingLine(p)).toBe("Showing all 5 objects and 3 relations. 1 relation names an object this World does not hold and is not drawn.");
  });

  it("is the same for the same World whatever order it arrives in", () => {
    const reversed = { ...small, objects: [...small.objects].reverse(), relations: [...small.relations].reverse() } as WorldReadModel;
    expect(adaptWorldForPicture(reversed).corpus).toEqual(adaptWorldForPicture(small).corpus);
  });

  it("refuses two objects with one id instead of dropping one", () => {
    expect(() => adaptWorldForPicture(model({ objects: [object({ id: "a", type: "Topic" }), object({ id: "a", type: "Claim" })] }))).toThrow("world_picture_duplicate_object:a");
  });

  it("its corpus is one the renderer's layout accepts, and an empty World draws nothing", () => {
    const layout = layoutWorld(adaptWorldForPicture(small).corpus, "world");
    expect(layout.nodes).toHaveLength(5);
    expect(layout.edges).toHaveLength(3);
    const empty = adaptWorldForPicture(model({ objects: [] }));
    expect(empty.drawn).toEqual({ objects: 0, relations: 0 });
    expect(showingLine(empty)).toBe("Showing all 0 objects and 0 relations.");
  });
});

describe("what a click can open", () => {
  it("names the first evidence record the World holds, and null when none is", () => {
    const p = adaptWorldForPicture(small);
    expect(p.info.get("e1")).toMatchObject({ evidenceId: "ev1", evidenceCount: 1, relationCount: 2, typeLabel: "Entity" });
    expect(p.info.get("v1")).toMatchObject({ evidenceId: null, evidenceCount: 0 });
  });
});

describe("the cap says what it cut", () => {
  const many = model({
    objects: ["a", "b", "c", "d"].map((id) => object({ id, type: "Topic" })),
    relations: [relation("1", "a", "b"), relation("2", "a", "c"), relation("3", "a", "d"), relation("4", "b", "c")],
  });

  it("keeps the most connected objects, then only the relations between them", () => {
    const p = adaptWorldForPicture(many, { nodes: 2 });
    expect(p.corpus.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(p.corpus.edges).toEqual([{ a: "a", b: "b", relation: "mentions" }]);
    expect(p.capped).toBe(true);
    expect(showingLine(p)).toBe("Showing 2 of 4 objects (the most connected) and 1 of 4 relations.");
    expect(p.legend.find((l) => l.label === "Topics")).toMatchObject({ drawn: 2, total: 4 });
  });

  it("cuts relations on their own cap too", () => {
    const p = adaptWorldForPicture(many, { edges: 2 });
    expect(p.drawn).toEqual({ objects: 4, relations: 2 });
    expect(p.capped).toBe(true);
    expect(showingLine(p)).toContain("Showing 4 of 4 objects (the most connected) and 2 of 4 relations.");
  });

  it("a World within the caps is not marked as cut", () => {
    expect(adaptWorldForPicture(many).capped).toBe(false);
  });
});

describe("the legend", () => {
  it("names each colour for what the compiled World holds, in the renderer's own colours", () => {
    const { legend } = adaptWorldForPicture(small);
    expect(legend.map((l) => [l.label, l.color, l.total])).toEqual([
      ["Documents", KIND_COLORS.Source, 1],
      ["Entities", KIND_COLORS.Entity, 1],
      ["Topics", KIND_COLORS.Concept, 1],
      ["Claims", KIND_COLORS.Claim, 1],
      ["Evidence", KIND_COLORS.Change, 1],
    ]);
  });
});

describe("which picture a reader gets", () => {
  it("no live canvas under 900 px; reduced motion keeps the frame still", () => {
    expect(PICTURE_LIVE_MIN_WIDTH).toBe(900);
    expect(PICTURE_LIVE_QUERY).toBe("(min-width: 900px)");
    expect(pictureBranch({ wide: false, reducedMotion: false })).toEqual({ live: false, orbit: false });
    expect(pictureBranch({ wide: false, reducedMotion: true })).toEqual({ live: false, orbit: false });
    expect(pictureBranch({ wide: true, reducedMotion: false })).toEqual({ live: true, orbit: true });
    expect(pictureBranch({ wide: true, reducedMotion: true })).toEqual({ live: true, orbit: false });
  });

  it("falls WebGL, then Canvas2D, then the list", () => {
    expect(fallbackGraphics("webgl")).toBe("canvas2d");
    expect(fallbackGraphics("canvas2d")).toBe("summary");
    expect(fallbackGraphics("summary")).toBe("summary");
  });
});

describe("the screen tag", () => {
  it("says the revision of an active World and that a candidate is not active", () => {
    expect(pictureScreenStatus(small)).toEqual({ tone: "ok", label: "World v3 active" });
    expect(pictureScreenStatus(model({ objects: [], status: "candidate" }))).toEqual({ tone: "waiting", label: "Candidate, not active" });
    expect(pictureScreenStatus(model({ objects: [], revision: { state: "not_yet", reason: "x" } }))).toEqual({ tone: "ok", label: "World active" });
  });
});

describe("the page and the component stay on real data", () => {
  const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  it("Home draws only the active World's own model; no sample or corpus file is read", () => {
    const page = read("app/workspace/page.tsx");
    expect(page).toContain("activeWorld && worldReadModel && worldReadModel.world.manifestDigest === activeWorld.manifestDigest");
    const component = read("components/workspace/world-picture.tsx");
    for (const forbidden of ["public-corpus", "explore-sample", "demo-world", "fetch("]) expect(component, forbidden).not.toContain(forbidden);
  });

  it("the sheet animates nothing, paints no focus ring of its own, and hides the stage under 900 px", () => {
    const css = read("components/workspace/world-picture.module.css").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).not.toMatch(/\b(?:animation|transition|@keyframes)\b/);
    expect(css).not.toMatch(/\boutline(-\w+)?\s*:/);
    expect(css).not.toContain(":hover");
    expect(css).toMatch(/@media \(max-width: 899px\) \{ \.stage \{ display: none; \} \}/);
  });
});
