import { KIND_COLORS, WORLD_KINDS } from "./v34/world-geometry";
import type { CorpusEdge, CorpusNode, WorldCorpus, WorldKind } from "./v34/world-geometry";
import type { ScreenStatus } from "../components/v34/ui/screen";
import { worldScreenStatus } from "../app/workspace/screen-status";
import type { WorldObjectType, WorldReadModel } from "./world-read-model";
import { worldReadFailureCode } from "./review-queue";
import type { ActiveWorldDiscovery } from "../components/workspace/in-page-choices";
import type { ActiveWorldSummary } from "./world-store";

/*
  WO-WS-5: the workspace draws its World with the renderer the public pages use.

  Pure functions, no DOM. Everything drawn is read from the World read model the workspace already
  holds (the compiled artifact's objects, relations and evidence); nothing is sampled, inferred or
  filled in. A relation whose endpoint is not an object of this World is not drawn and is counted,
  and a World larger than the caps is cut by a stated rule and says so ("Showing N of M"), never
  silently.

  The renderer's five kinds are the public corpus's. Here they are named for what the compiled
  World holds, so the legend never uses a word the picture does not mean: Document is the first
  layer, Topic the third, and Evidence takes the orange kind that the public corpus uses for
  changes. Line hue is the renderer's decoration and says nothing; the legend says so.
*/

/** Above these the picture is cut, by degree, and the "Showing N of M" line says so. */
export const PICTURE_NODE_CAP = 1500;
export const PICTURE_EDGE_CAP = 6000;
/** The live canvas mounts only from this width; below it the workspace shows the list (founder, phones are not given a live canvas). */
export const PICTURE_LIVE_MIN_WIDTH = 900;
export const PICTURE_LIVE_QUERY = `(min-width: ${PICTURE_LIVE_MIN_WIDTH}px)`;
export const PICTURE_SUMMARY_ROWS = 8;
/** The find box lists at most this many matches, and says how many matched. */
export const PICTURE_FIND_ROWS = 20;

const KIND_OF: Readonly<Record<WorldObjectType, WorldKind>> = {
  Document: "Source",
  Topic: "Concept",
  Entity: "Entity",
  Claim: "Claim",
  Evidence: "Change",
};

export const PICTURE_TYPE_LABEL: Readonly<Record<WorldKind, string>> = {
  Source: "Documents",
  Entity: "Entities",
  Concept: "Topics",
  Claim: "Claims",
  Change: "Evidence",
};

const SINGULAR: Readonly<Record<WorldKind, string>> = {
  Source: "Document",
  Entity: "Entity",
  Concept: "Topic",
  Claim: "Claim",
  Change: "Evidence",
};

export type PictureNodeInfo = {
  id: string;
  label: string;
  typeLabel: string;
  relationCount: number;
  evidenceCount: number;
  /** The first evidence record of this object that the World holds, or null: the reader opens this one. */
  evidenceId: string | null;
};

export type WorldPicture = {
  /** What the renderer is given. Its nodes and edges are the drawn ones. */
  corpus: WorldCorpus;
  totals: { objects: number; relations: number };
  drawn: { objects: number; relations: number };
  /** Relations naming an object the World does not hold: not drawn, counted. */
  unresolvedRelations: number;
  capped: boolean;
  legend: { kind: WorldKind; label: string; color: string; drawn: number; total: number }[];
  info: ReadonlyMap<string, PictureNodeInfo>;
};

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Throws `world_picture_duplicate_object:<id>` when two objects share an id: a defect to show, not a record to drop. */
export function adaptWorldForPicture(model: WorldReadModel, caps: { nodes?: number; edges?: number } = {}): WorldPicture {
  const nodeCap = caps.nodes ?? PICTURE_NODE_CAP;
  const edgeCap = caps.edges ?? PICTURE_EDGE_CAP;

  const objectById = new Map<string, WorldReadModel["objects"][number]>();
  for (const object of model.objects) {
    if (objectById.has(object.id)) throw new Error(`world_picture_duplicate_object:${object.id}`);
    objectById.set(object.id, object);
  }
  const resolved = model.relations.filter((relation) => objectById.has(relation.subject) && objectById.has(relation.object));
  const degree = new Map<string, number>();
  for (const relation of resolved) {
    degree.set(relation.subject, (degree.get(relation.subject) ?? 0) + 1);
    degree.set(relation.object, (degree.get(relation.object) ?? 0) + 1);
  }

  // Most connected first, then id: the same World always keeps the same objects.
  const ranked = [...model.objects].sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || byText(a.id, b.id));
  const kept = ranked.slice(0, nodeCap);
  const keptIds = new Set(kept.map((object) => object.id));
  // The renderer's layout is seeded by id, not by order, so the drawn order only has to be stable.
  const nodes: CorpusNode[] = [...kept].sort((a, b) => byText(a.id, b.id)).map((object) => ({
    id: object.id,
    label: object.label,
    kind: KIND_OF[object.type],
    domain: object.type,
    source: "",
    note: "",
    status: object.status,
  }));
  const keptEdges = resolved
    .filter((relation) => keptIds.has(relation.subject) && keptIds.has(relation.object))
    .sort((a, b) => byText(a.id, b.id));
  const edges: CorpusEdge[] = keptEdges.slice(0, edgeCap).map((relation) => ({ a: relation.subject, b: relation.object, relation: relation.predicate }));

  const evidenceIds = new Set(model.evidence.map((item) => item.id));
  const info = new Map<string, PictureNodeInfo>();
  for (const object of kept) {
    info.set(object.id, {
      id: object.id,
      label: object.label,
      typeLabel: SINGULAR[KIND_OF[object.type]],
      relationCount: degree.get(object.id) ?? 0,
      evidenceCount: object.evidenceRefs.filter((ref) => evidenceIds.has(ref)).length,
      evidenceId: object.evidenceRefs.find((ref) => evidenceIds.has(ref)) ?? null,
    });
  }

  const total = new Map<WorldKind, number>();
  for (const object of model.objects) total.set(KIND_OF[object.type], (total.get(KIND_OF[object.type]) ?? 0) + 1);
  const drawnKind = new Map<WorldKind, number>();
  for (const node of nodes) drawnKind.set(node.kind as WorldKind, (drawnKind.get(node.kind as WorldKind) ?? 0) + 1);

  return {
    corpus: { sources: {}, nodes, edges },
    totals: { objects: model.objects.length, relations: model.relations.length },
    drawn: { objects: nodes.length, relations: edges.length },
    unresolvedRelations: model.relations.length - resolved.length,
    capped: nodes.length < model.objects.length || edges.length < resolved.length,
    legend: WORLD_KINDS.map((kind) => ({ kind, label: PICTURE_TYPE_LABEL[kind], color: KIND_COLORS[kind], drawn: drawnKind.get(kind) ?? 0, total: total.get(kind) ?? 0 })),
    info,
  };
}

const n = (value: number) => value.toLocaleString("en-US");

/** The line under the picture. Always printed; it states a cut and an unresolved relation when there is one. */
export function showingLine(picture: WorldPicture): string {
  const { totals, drawn } = picture;
  const base = picture.capped
    ? `Showing ${n(drawn.objects)} of ${n(totals.objects)} objects (the most connected) and ${n(drawn.relations)} of ${n(totals.relations)} relations.`
    : `Showing all ${n(totals.objects)} objects and ${n(drawn.relations)} relations.`;
  return picture.unresolvedRelations > 0
    ? `${base} ${n(picture.unresolvedRelations)} ${picture.unresolvedRelations === 1 ? "relation names" : "relations name"} an object this World does not hold and ${picture.unresolvedRelations === 1 ? "is" : "are"} not drawn.`
    : base;
}

/** The legend's colour meanings, in words. Line hue is the renderer's decoration, so the legend does not give it a meaning. */
export const PICTURE_LINE_NOTE = "Each line is one relation. Line colour carries no meaning, except the orange lines of the selected object.";

export type Graphics = "webgl" | "canvas2d" | "summary";

/** The live canvas mounts on a wide viewport only; reduced motion keeps the frame still (no orbit), a pick still works. */
export function pictureBranch(input: { wide: boolean; reducedMotion: boolean }): { live: boolean; orbit: boolean } {
  return { live: input.wide, orbit: input.wide && !input.reducedMotion };
}

/** One step down when a renderer cannot start or loses its context. The last step is the list, which is never absent. */
export function fallbackGraphics(from: Graphics): Graphics {
  return from === "webgl" ? "canvas2d" : "summary";
}

/**
  The Screen tag, from the page's active-World state and never from the read model's own snapshot: the model is fetched once per
  manifest and its status is fixed at read time, so after an activation or a rollback it would say what was true then.
  Active iff this model's manifest is the active World's manifest; anything else is not the active World.
*/
export function pictureScreenStatus(model: Pick<WorldReadModel, "world">, active: { manifestDigest: string; revision: number } | null): ScreenStatus {
  if (!active || model.world.manifestDigest !== active.manifestDigest) return { tone: "waiting", label: "Candidate, not active" };
  return Number.isInteger(active.revision) && active.revision >= 1 ? worldScreenStatus(active.revision) : { tone: "ok", label: "World active" };
}

/** Drawn objects whose label, type or id contains the query (case-insensitive), most connected first; an empty query lists the most connected. */
export function findObjects(picture: WorldPicture, query: string, limit: number = PICTURE_FIND_ROWS): { items: PictureNodeInfo[]; matched: number } {
  const q = query.trim().toLowerCase();
  const all = [...picture.info.values()]; // insertion order is the ranked order
  const hits = q === "" ? all : all.filter((item) => `${item.label} ${item.typeLabel} ${item.id}`.toLowerCase().includes(q));
  return { items: hits.slice(0, q === "" ? PICTURE_SUMMARY_ROWS : limit), matched: hits.length };
}

export function pictureAriaLabel(picture: WorldPicture): string {
  return `The World drawn as a graph: ${n(picture.drawn.objects)} objects and ${n(picture.drawn.relations)} relations. The canvas is pointer-only; the find box below it selects any drawn object.`;
}

/*
  WO-WS-5c: Home draws the active World without a collection being open.

  `pickHomeWorld` is the one World Home reads: the only active World, or with several the first of the listing Ask reads
  (most recently activated first, the ordering `discoverActiveWorlds` already applies and `homeWorldFact` already names).
  Nothing else is chosen or ordered here, and a listing that is still checking, empty or failed picks nothing.
*/
export function pickHomeWorld(found: ActiveWorldDiscovery | "checking"): ActiveWorldSummary | null {
  if (found === "checking") return null;
  if (found.kind === "one") return found.world;
  return found.kind === "several" ? found.worlds[0] ?? null : null;
}

/** The key a Home read is held under: a read for another collection or revision never reads as this one's. */
export const homeWorldKey = (world: ActiveWorldSummary | null): string => (world ? `${world.collectionId}@${world.manifestDigest}` : "");

export type HomeWorldRead =
  | { status: "ready"; model: WorldReadModel }
  | { status: "failed"; code: string | null; httpStatus: number | null };

/*
  The same request the review flow makes (`GET /api/v1/world/<id>?manifest=<digest>`), with the same session token and the
  same refusals. A refusal, a thrown fetch, a body without a model, or a model for another collection or manifest is
  `failed`: the picture is never drawn from it. An aborted read returns null and its caller drops it.
*/
export async function readHomeWorldModel(
  token: string,
  world: ActiveWorldSummary,
  signal: AbortSignal,
  fetchImpl: (input: string, init: RequestInit) => Promise<Response> = fetch,
): Promise<HomeWorldRead | null> {
  try {
    const response = await fetchImpl(`/api/v1/world/${encodeURIComponent(world.collectionId)}?manifest=${encodeURIComponent(world.manifestDigest)}`, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { authorization: `Bearer ${token}` },
      signal,
    });
    if (!response.ok) return { status: "failed", code: worldReadFailureCode(await response.json().catch(() => null)), httpStatus: response.status };
    const model = ((await response.json().catch(() => null)) as { model?: WorldReadModel | null } | null)?.model;
    if (!model || model.world?.id !== world.collectionId || model.world.manifestDigest !== world.manifestDigest) {
      return { status: "failed", code: "WORLD_READ_MODEL_MISMATCH", httpStatus: null };
    }
    return { status: "ready", model };
  } catch {
    return signal.aborted ? null : { status: "failed", code: null, httpStatus: null };
  }
}
