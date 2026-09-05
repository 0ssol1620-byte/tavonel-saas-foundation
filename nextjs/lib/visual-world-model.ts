import type { WorldObject, WorldReadModel } from "./world-read-model";

/*
  The adapter boundary between a compiled World and anything that draws one.

  Blueprint §26 asks for exactly one place that reads `WorldReadModel`, so that the renderers
  keep working when the compiler's read model grows a field and so that the same renderers can
  later draw a workspace World without being rewritten. This is that place. Everything below
  the line -- `components/world-visual/*`, `components/explore/*` -- reads `VisualWorldModel`
  and nothing else.

  The rule this file exists to enforce is narrower than "convert one type to another": nothing
  here may invent a node, an edge, a label or a state. Every node is an object the compiler
  emitted, every edge is a relation it emitted, and the one label this module rewrites -- an
  Evidence node's storage key, replaced by the filename of the document its regions came from --
  is a rewrite of the same fact into the words a reader can use, with the original still printed
  in the technical drawer.
*/

export type VisualState = "current" | "changed" | "affected" | "unresolved" | "candidate" | "dim";
export type VisualKind = "Claim" | "Entity" | "Document" | "Topic" | "Evidence";

export type VisualNode = {
  id: string;
  label: string;
  kind: VisualKind;
  state: VisualState;
  evidenceRefs: string[];
  /** Degree in the whole compiled World, not in the focus subgraph: how connected this object is. */
  degree: number;
};

export type VisualEdge = {
  id: string;
  from: string;
  to: string;
  predicate: string;
  state: VisualState;
  evidenceRefs: string[];
};

export type VisualEvidence = {
  id: string;
  sourceId: string;
  filename: string;
  href: string;
  page: number;
  pageCount: number;
  bbox1000: [number, number, number, number];
  excerpt: string;
  sourceVersionId: string;
  digest: string;
  authority: string;
};

export type VisualRevision = {
  id: string;
  label: string;
  manifestDigest: string;
  status: "sample" | "candidate" | "active" | "superseded";
  sourceRevisions: string[];
};

export type VisualWorldModel = {
  worldId: string;
  status: "sample" | "candidate" | "active";
  manifestDigest: string;
  nodes: VisualNode[];
  edges: VisualEdge[];
  evidence: VisualEvidence[];
  revisions: VisualRevision[];
  /** The 7-12 node ids Act 1 draws. Derived, never a hand-typed list -- see `chooseFocus`. */
  focus: string[];
};

/** One committed source file behind a World, as `lib/explore-sample.ts` describes it. */
export type ExploreDocument = {
  documentId: string;
  filename: string;
  href: string;
  digest: string;
  pageCount: number;
  regionCount: number;
};

export type ExploreDocuments = ReadonlyArray<ExploreDocument>;

export const FOCUS_MIN = 7;
export const FOCUS_MAX = 12;

function stateOf(world: WorldReadModel): VisualState {
  return world.world.status === "active" ? "current" : "candidate";
}

/**
 * The source document an Evidence object's regions belong to.
 *
 * `null` unless every region under it names the same source and that source is one of the
 * committed documents. A partial answer here would put a filename under a node whose regions
 * came from somewhere else, which is the kind of small lie that is impossible to see.
 */
function sourceOfEvidenceNode(
  object: WorldObject,
  world: WorldReadModel,
  documents: ExploreDocuments,
): ExploreDocument | null {
  const regions = world.evidence.filter((item) => object.evidenceRefs.includes(item.id));
  if (regions.length === 0) return null;
  const sourceIds = new Set(regions.map((item) => item.sourceId));
  if (sourceIds.size !== 1) return null;
  return documents.find((document) => document.documentId === regions[0].sourceId) ?? null;
}

/*
  Which objects Act 1 draws.

  Blueprint §18 asks for 7-12 curated objects and forbids a hairball, and §1 of the lane
  contract forbids a hand-typed id list. So the curation is a rule over the compiled graph:

    1. A claim is a leaf. It is the only object type in this World whose label is a sentence a
       reader can judge, and it is what the product is for.
    2. A claim whose label is identical to a Document's label is that document's title line. It
       is already on the stage as its source, and drawing it twice says nothing new.
    3. A leaf's hub is whatever it points at. In this compiler that is the Evidence bundle its
       `supported_by` relation names, but the rule does not name a predicate -- an object's hub
       is simply the object it is the subject of a relation to.
    4. Hubs come first, ordered by how many leaves they carry; leaves follow their hub, so the
       DOM order is also the stacked order a phone reads top to bottom.
    5. If that set overflows `focusLimit`, leaves are dropped from the largest hub first, in
       rotation, so no source disappears from the composition. If it underflows `FOCUS_MIN`,
       the highest-degree objects left in the World fill the remainder.

  What this deliberately does not do is show Entity objects. This World's entities come from a
  capitalised-token heuristic and include "The", "Before" and "Confirm"; §49 moves that
  disclosure to the technical drawer, and putting the tokens themselves in the opening
  composition would be the page arguing against itself. They remain in `nodes`, addressable by
  every other act.
*/
function chooseFocus(world: WorldReadModel, focusLimit: number): string[] {
  const byId = new Map(world.objects.map((object) => [object.id, object] as const));
  const documentLabels = new Set(
    world.objects.filter((object) => object.type === "Document").map((object) => object.label),
  );

  const hubOf = new Map<string, string>();
  for (const relation of world.relations) {
    const subject = byId.get(relation.subject);
    if (!subject || subject.type !== "Claim") continue;
    if (documentLabels.has(subject.label)) continue;
    if (!byId.has(relation.object)) continue;
    if (!hubOf.has(subject.id)) hubOf.set(subject.id, relation.object);
  }

  const leavesByHub = new Map<string, string[]>();
  for (const [leaf, hub] of [...hubOf.entries()].sort((left, right) => left[0].localeCompare(right[0]))) {
    leavesByHub.set(hub, [...(leavesByHub.get(hub) ?? []), leaf]);
  }

  const hubs = [...leavesByHub.entries()].sort((left, right) =>
    right[1].length - left[1].length || left[0].localeCompare(right[0]));

  // Drop leaves from the largest hub first, one at a time, so the composition thins evenly
  // instead of losing a whole source.
  const budget = Math.max(FOCUS_MIN, focusLimit);
  const kept = new Map<string, string[]>(hubs.map(([hub, leaves]) => [hub, [...leaves]]));
  const size = () => kept.size + [...kept.values()].reduce((total, leaves) => total + leaves.length, 0);
  while (size() > budget) {
    const fullest = [...kept.entries()].sort((left, right) =>
      right[1].length - left[1].length || left[0].localeCompare(right[0]))[0];
    if (!fullest || fullest[1].length === 0) break;
    fullest[1].pop();
  }

  const focus: string[] = [];
  for (const [hub] of hubs) {
    focus.push(hub);
    focus.push(...(kept.get(hub) ?? []));
  }

  if (focus.length < FOCUS_MIN) {
    const degree = degreeMap(world);
    const filler = world.objects
      .filter((object) => !focus.includes(object.id))
      .sort((left, right) =>
        (degree.get(right.id) ?? 0) - (degree.get(left.id) ?? 0) || left.id.localeCompare(right.id));
    for (const object of filler) {
      if (focus.length >= FOCUS_MIN) break;
      focus.push(object.id);
    }
  }
  return focus;
}

/*
  Which of an object's regions states it, first.

  This compiler binds a claim to every region of the document it was read from, so
  `evidenceRefs[0]` is whichever region the extractor read first -- on this fixture, the manual's
  title line. Opening a claim onto its document's title and drawing a tether to it says "this
  sentence came from here" about a line that does not contain the sentence.

  The region that does contain it is not a guess: the claim's own label appears verbatim in
  exactly one region's text. So the refs are ordered, never rewritten -- every region the
  compiler attached is still in the list, and the one that states the object leads it. If no
  region states it, or more than one does, the compiler's order stands and nothing is asserted.
*/
function refsStatingFirst(object: WorldObject, world: WorldReadModel): string[] {
  const refs = [...object.evidenceRefs];
  if (object.type !== "Claim" || refs.length < 2) return refs;
  const stating = refs.filter((id) =>
    world.evidence.some((item) => item.id === id && item.excerpt.includes(object.label)));
  if (stating.length !== 1) return refs;
  return [stating[0], ...refs.filter((id) => id !== stating[0])];
}

function degreeMap(world: WorldReadModel): Map<string, number> {
  const degree = new Map<string, number>();
  for (const relation of world.relations) {
    degree.set(relation.subject, (degree.get(relation.subject) ?? 0) + 1);
    degree.set(relation.object, (degree.get(relation.object) ?? 0) + 1);
  }
  return degree;
}

export function toVisualWorldModel(
  world: WorldReadModel,
  documents: ExploreDocuments,
  options: { focusLimit?: number } = {},
): VisualWorldModel {
  const focusLimit = options.focusLimit ?? FOCUS_MAX;
  const state = stateOf(world);
  const degree = degreeMap(world);
  const pageCountOf = new Map(documents.map((document) => [document.documentId, document.pageCount] as const));

  const nodes: VisualNode[] = world.objects.map((object) => {
    const source = object.type === "Evidence" ? sourceOfEvidenceNode(object, world, documents) : null;
    return {
      id: object.id,
      label: source ? source.filename : object.label,
      kind: object.type,
      state,
      evidenceRefs: refsStatingFirst(object, world),
      degree: degree.get(object.id) ?? 0,
    };
  });

  const edges: VisualEdge[] = world.relations.map((relation) => ({
    id: relation.id,
    from: relation.subject,
    to: relation.object,
    predicate: relation.predicate,
    state,
    evidenceRefs: [...relation.evidenceRefs],
  }));

  const evidence: VisualEvidence[] = world.evidence.map((item) => {
    const document = documents.find((candidate) => candidate.documentId === item.sourceId);
    return {
      id: item.id,
      sourceId: item.sourceId,
      filename: document?.filename ?? item.sourceId,
      href: document?.href ?? "",
      page: item.page,
      pageCount: pageCountOf.get(item.sourceId) ?? item.page,
      bbox1000: [...item.bbox] as [number, number, number, number],
      excerpt: item.excerpt,
      sourceVersionId: item.sourceVersionId,
      digest: item.digest,
      authority: item.authority,
    };
  });

  /*
    A revision is what the World's own history says it is.

    `status` is narrowed to "sample" for a deterministic sample: the read model calls every
    unactivated artifact a candidate, and a candidate is something a person could promote. This
    one is a fixture compiled at build time and nobody can promote it, so the word changes here
    rather than the page implying a pending decision that does not exist.
  */
  const sourceRevisions = [...new Set(world.objects.flatMap((object) => object.sourceVersions))].sort();
  const revisions: VisualRevision[] = world.history.map((entry) => ({
    id: entry.version,
    label: entry.version,
    manifestDigest: entry.manifestDigest,
    status: entry.status === "candidate" && world.contract.deterministicSample ? "sample" : entry.status,
    sourceRevisions: entry.manifestDigest === world.world.manifestDigest ? sourceRevisions : [],
  }));

  return {
    worldId: world.world.id,
    status: world.contract.deterministicSample ? "sample" : world.world.status,
    manifestDigest: world.world.manifestDigest,
    nodes,
    edges,
    evidence,
    revisions,
    focus: chooseFocus(world, focusLimit),
  };
}

/* ------------------------------------------------------------------ geometry */

/*
  Where the focus objects sit, computed once on the server and identical on every device.

  The stage is 16:10 (§28) and the coordinates below are in that box, so the renderer can place
  a node with a percentage and never measure anything. That is the whole reason this is a pure
  function rather than a force simulation: a layout that settles differently per device cannot
  be compared against the landing film's last frame, and §29 asks for exactly that comparison.

  Composition: one column per hub, leaves stacked alternately above and below it. It is the
  shape the compiled graph actually has -- three sources, each carrying the claims it supports --
  and it is the same reading order a phone gets when the same DOM lays out as a flow.
*/
export const STAGE_WIDTH = 1000;
export const STAGE_HEIGHT = 625;

export type VisualPlacement = { id: string; x: number; y: number; role: "hub" | "leaf"; column: number; tier: number };
export type VisualLayoutEdge = { id: string; from: string; to: string; d: string };
export type VisualLayout = {
  width: number;
  height: number;
  placements: VisualPlacement[];
  edges: VisualLayoutEdge[];
};

const COLUMN_INSET = 0.16;
const TIER_STEP = 114;
const COLUMN_LEAN = 22;

export function layoutVisualWorld(model: VisualWorldModel, ids: readonly string[] = model.focus): VisualLayout {
  const inFocus = new Set(ids);
  const parent = new Map<string, string>();
  for (const edge of model.edges) {
    if (!inFocus.has(edge.from) || !inFocus.has(edge.to)) continue;
    if (!parent.has(edge.from)) parent.set(edge.from, edge.to);
  }

  const columns = ids.filter((id) => !parent.has(id));
  const leavesOf = new Map<string, string[]>(columns.map((id) => [id, []]));
  const orphans: string[] = [];
  for (const id of ids) {
    const hub = parent.get(id);
    if (!hub) continue;
    if (leavesOf.has(hub)) leavesOf.get(hub)!.push(id);
    else orphans.push(id);
  }
  // A node whose hub fell outside the focus set still has to be drawn somewhere; it becomes its
  // own column rather than silently disappearing.
  for (const id of orphans) {
    columns.push(id);
    leavesOf.set(id, []);
  }

  const count = Math.max(1, columns.length);
  const placements: VisualPlacement[] = [];
  columns.forEach((hub, index) => {
    const t = count === 1 ? 0.5 : COLUMN_INSET + ((1 - 2 * COLUMN_INSET) * index) / (count - 1);
    const x = t * STAGE_WIDTH;
    // A dead-straight row of hubs reads as a chart axis. The stagger is small, deterministic
    // and derived from the index, not from a random seed.
    const base = STAGE_HEIGHT / 2 + (index % 2 === 0 ? -16 : 16);

    const leaves = leavesOf.get(hub) ?? [];
    const tiers = leaves.map((_, order) => (order % 2 === 0 ? -1 : 1) * (Math.floor(order / 2) + 1));
    /*
      Each column is centred on its own contents, not on its hub.

      A column with an odd number of leaves puts one more above the source than below it, and
      three columns doing that leaves the whole composition sitting in the top half of the frame
      with a band of empty stage beneath. Shifting each column by half its own extent keeps the
      hub-and-leaves group centred while the alternating order -- and so the DOM order a phone
      reads -- stays exactly as it was.
    */
    const extent = [0, ...tiers.map((tier) => tier * TIER_STEP)];
    const shift = -(Math.min(...extent) + Math.max(...extent)) / 2;
    const y = base + shift;

    placements.push({ id: hub, x, y, role: "hub", column: index, tier: 0 });
    leaves.forEach((leaf, order) => {
      const tier = tiers[order];
      placements.push({
        id: leaf,
        x: x + Math.sign(tier) * COLUMN_LEAN,
        y: y + tier * TIER_STEP,
        role: "leaf",
        column: index,
        tier,
      });
    });
  });

  const at = new Map(placements.map((placement) => [placement.id, placement] as const));
  const edges: VisualLayoutEdge[] = model.edges
    .filter((edge) => at.has(edge.from) && at.has(edge.to))
    .map((edge) => {
      const from = at.get(edge.from)!;
      const to = at.get(edge.to)!;
      const dy = to.y - from.y;
      return {
        id: edge.id,
        from: edge.from,
        to: edge.to,
        d: `M ${round(from.x)} ${round(from.y)} C ${round(from.x)} ${round(from.y + dy * 0.42)}, ${round(to.x)} ${round(to.y - dy * 0.42)}, ${round(to.x)} ${round(to.y)}`,
      };
    });

  return { width: STAGE_WIDTH, height: STAGE_HEIGHT, placements, edges };
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}
