import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  adaptWorldForPicture,
  fallbackGraphics,
  findObjects,
  pictureAriaLabel,
  PICTURE_LIVE_MIN_WIDTH,
  PICTURE_LIVE_QUERY,
  homeWorldKey,
  pickHomeWorld,
  pictureBranch,
  pictureScreenStatus,
  readHomeWorldModel,
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

describe("the screen tag follows the page's active World, not the model's own snapshot", () => {
  const snapshotActive = model({ objects: [], status: "active", revision: { state: "read", value: 3 } }); // manifest sha256:x, fetched while it was active
  const snapshotCandidate = model({ objects: [], status: "candidate" });
  it("is active iff the model's manifest is the active World's manifest, with the active revision", () => {
    expect(pictureScreenStatus(snapshotActive, { manifestDigest: "sha256:x", revision: 5 })).toEqual({ tone: "ok", label: "World v5 active" });
  });
  it("activation: a model read as a candidate reads active once the page's active World is its manifest", () => {
    expect(pictureScreenStatus(snapshotCandidate, { manifestDigest: "sha256:x", revision: 4 })).toEqual({ tone: "ok", label: "World v4 active" });
  });
  it("rollback: a model read as active is not active once the page's active World is another manifest", () => {
    expect(pictureScreenStatus(snapshotActive, { manifestDigest: "sha256:other", revision: 2 })).toEqual({ tone: "waiting", label: "Candidate, not active" });
  });
  it("no active World: never active, whatever the snapshot says", () => {
    expect(pictureScreenStatus(snapshotActive, null)).toEqual({ tone: "waiting", label: "Candidate, not active" });
    expect(pictureScreenStatus(snapshotCandidate, null)).toEqual({ tone: "waiting", label: "Candidate, not active" });
  });
  it("an active World with no usable revision says active without a number", () => {
    expect(pictureScreenStatus(snapshotActive, { manifestDigest: "sha256:x", revision: 0 })).toEqual({ tone: "ok", label: "World active" });
  });
  it("the page passes the active World to both screens", () => {
    const page = readFileSync(new URL("../app/workspace/page.tsx", import.meta.url), "utf8");
    expect(page.split("pictureScreenStatus(worldReadModel, activeWorld)")).toHaveLength(3);
    expect(page).not.toContain("pictureScreenStatus(worldReadModel)");
  });
});

describe("every drawn object has a keyboard route", () => {
  const ids = Array.from({ length: 30 }, (_, i) => `o${String(i).padStart(2, "0")}`);
  const big = model({ objects: ids.map((id) => object({ id, type: "Entity" })), relations: [relation("1", "o05", "o06"), relation("2", "o05", "o07")] });
  const picture = adaptWorldForPicture(big);

  it("an empty query lists the 8 most connected, most connected first", () => {
    const { items, matched } = findObjects(picture, "");
    expect(items).toHaveLength(8);
    expect(matched).toBe(30);
    expect(items[0]!.id).toBe("o05");
  });
  it("a query reaches any drawn object, capped with the matched count", () => {
    expect(findObjects(picture, "label o29")).toMatchObject({ matched: 1, items: [{ id: "o29" }] });
    const all = findObjects(picture, "entity");
    expect(all.matched).toBe(30);
    expect(all.items).toHaveLength(20);
    expect(findObjects(picture, "no such").items).toEqual([]);
  });
  it("the canvas name claims only what the control does", () => {
    const label = pictureAriaLabel(picture);
    expect(label).toContain("pointer-only");
    expect(label).toContain("find box");
    expect(label).not.toContain("same objects");
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

  it("lays the World out only when a canvas will draw it", () => {
    expect(read("components/workspace/world-picture.tsx")).toContain('live ? layoutWorld(picture.corpus, "world") : null');
  });

  it("the sheet animates nothing, paints no focus ring of its own, and hides the stage under 900 px", () => {
    const css = read("components/workspace/world-picture.module.css").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).not.toMatch(/\b(?:animation|transition|@keyframes)\b/);
    expect(css).not.toMatch(/\boutline(-\w+)?\s*:/);
    expect(css).not.toContain(":hover");
    expect(css).toMatch(/@media \(max-width: 899px\) \{ \.stage \{ display: none; \} \}/);
  });
});

/*
  WO-WS-5c: Home draws the active World on a fresh visit, from the listing Ask reads and the review flow's own request.
*/
describe("Home reads one active World, by the listing's own order", () => {
  const w = (n: number) => ({ collectionId: `collection-${String(n).repeat(32)}`, manifestDigest: `sha256:${String(n).repeat(64)}`, revision: n, updatedAt: "2026-11-01T00:00:00Z" });
  it("picks the only World, and the first of several (most recently activated first)", () => {
    expect(pickHomeWorld({ kind: "one", world: w(1) })).toEqual(w(1));
    expect(pickHomeWorld({ kind: "several", worlds: [w(2), w(1), w(3)] })).toEqual(w(2));
  });
  it("picks nothing while checking, with none, or after a failed listing", () => {
    expect(pickHomeWorld("checking")).toBeNull();
    expect(pickHomeWorld({ kind: "none" })).toBeNull();
    expect(pickHomeWorld({ kind: "failed", code: null, status: 503 })).toBeNull();
    expect(pickHomeWorld({ kind: "several", worlds: [] })).toBeNull();
    expect(homeWorldKey(null)).toBe("");
    expect(homeWorldKey(w(1))).toBe(`${w(1).collectionId}@${w(1).manifestDigest}`);
  });
});

describe("readHomeWorldModel: one request, the review flow's own, fail closed", () => {
  const world = { collectionId: "collection-" + "a".repeat(32), manifestDigest: "sha256:" + "b".repeat(64), revision: 2, updatedAt: "2026-11-01T00:00:00Z" };
  const own = { world: { id: world.collectionId, manifestDigest: world.manifestDigest }, objects: [], relations: [], evidence: [] };
  const reply = (status: number, body: unknown) => vi.fn(async (_input: string, _init: RequestInit) => new Response(JSON.stringify(body), { status }));
  const signal = () => new AbortController().signal;

  it("asks /api/v1/world/<id>?manifest=<digest> once, with the session token, and returns the model", async () => {
    const fetchImpl = reply(200, { model: own });
    const read = await readHomeWorldModel("tok", world, signal(), fetchImpl);
    expect(read).toEqual({ status: "ready", model: own });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(`/api/v1/world/${world.collectionId}?manifest=${encodeURIComponent(world.manifestDigest)}`);
    expect(init.headers).toEqual({ authorization: "Bearer tok" });
    expect(init.cache).toBe("no-store");
  });
  it("a refusal keeps its code and status and yields no model", async () => {
    expect(await readHomeWorldModel("tok", world, signal(), reply(403, { code: "WORKSPACE_MEMBER_SCOPE_FORBIDDEN" }))).toEqual({ status: "failed", code: "WORKSPACE_MEMBER_SCOPE_FORBIDDEN", httpStatus: 403 });
    expect(await readHomeWorldModel("tok", world, signal(), reply(500, "not json"))).toEqual({ status: "failed", code: null, httpStatus: 500 });
  });
  it("a thrown fetch, a body without a model and a model for another World or manifest are all failed", async () => {
    expect(await readHomeWorldModel("tok", world, signal(), vi.fn(async () => { throw new Error("offline"); }))).toEqual({ status: "failed", code: null, httpStatus: null });
    expect(await readHomeWorldModel("tok", world, signal(), reply(200, { model: null }))).toMatchObject({ status: "failed", code: "WORLD_READ_MODEL_MISMATCH" });
    expect(await readHomeWorldModel("tok", world, signal(), reply(200, {}))).toMatchObject({ status: "failed" });
    expect(await readHomeWorldModel("tok", world, signal(), reply(200, { model: { ...own, world: { ...own.world, manifestDigest: "sha256:" + "c".repeat(64) } } }))).toMatchObject({ status: "failed", code: "WORLD_READ_MODEL_MISMATCH" });
    expect(await readHomeWorldModel("tok", world, signal(), reply(200, { model: { ...own, world: { ...own.world, id: "collection-" + "d".repeat(32) } } }))).toMatchObject({ status: "failed", code: "WORLD_READ_MODEL_MISMATCH" });
  });
  it("an aborted read returns null so the page drops it", async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await readHomeWorldModel("tok", world, controller.signal, vi.fn(async () => { throw new DOMException("x", "AbortError"); }))).toBeNull();
  });
});

describe("the page wires Home's read without touching the open-collection picture", () => {
  const page = readFileSync(new URL("../app/workspace/page.tsx", import.meta.url), "utf8").split(String.fromCharCode(13)).join("");
  it("reads only with no collection open, on Home overview, once the listing and start-up are ready, and draws only its own key", () => {
    expect(page).toContain('const homeWorld = !activeWorld && !collectionResult && surface === "home" && tab === "overview" ? pickHomeWorld(workspaceWorlds) : null;');
    expect(page).toContain('if (!homeWorld || session !== "signed-in" || !workspaceStartupReady) return;');
    expect(page).toContain("homeWorld && homeKey === homeWorldRead.key");
    expect(page).toContain("pictureScreenStatus(homeWorldRead.read.model, homeWorld)");
  });
  it("a failed read says the World could not be opened and draws nothing", () => {
    expect(page).toContain("The active World could not be opened.</strong> {failureSentence(homeWorldRead.read.code");
  });
  it("makes no new endpoint: the picture's request is the review flow's", () => {
    expect(page).toContain("/api/v1/world/${encodeURIComponent(collectionId)}?manifest=");
  });
});
