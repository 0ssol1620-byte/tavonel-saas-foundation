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
  /**
   * The compiled regions this object is bound to, stating region first.
   *
   * In a bounded model (`boundVisualWorld`) this is the shipped prefix of that list, and
   * `evidenceCount` still reports how many the compiler bound. The two are equal in the full
   * model, and a renderer that shows a total must read `evidenceCount`.
   */
  evidenceRefs: string[];
  evidenceCount: number;
  /** Degree in the whole compiled World, not in the focus subgraph: how connected this object is. */
  degree: number;
};

export type VisualEdge = {
  id: string;
  from: string;
  to: string;
  predicate: string;
  state: VisualState;
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
  sourceLabel?: string;
  accession?: string;
  officialHref?: string;
  secHref?: string;
  /** How many of the document's pages this World compiled. Equal to `pageCount` when all of them. */
  compiledPageCount?: number;
  /* §11.3: which bytes the region was read out of, and the acquired original beside them. */
  form?: string;
  filingDate?: string;
  representationKind?: "original" | "reference_render";
  sourceFilename?: string;
  sourceHref?: string;
  originalSha256?: string;
  renderProfile?: string;
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
  /**
   * What the compiled World holds, which is not what this model carries once it is bounded.
   *
   * Every count a reader is shown -- "SHOWING 12 OF 4,982 COMPILED OBJECTS" -- reads this, so
   * that shipping less to the browser can never quietly shrink a published number.
   */
  totals: { objects: number; relations: number; regions: number };
};

/**
 * One committed filing behind a World, as `lib/explore-sample.ts` describes it.
 *
 * `filename`, `digest` and `href` always name the bytes the compiler actually read. When
 * `representationKind` is `reference_render` those are not the acquired original: the original
 * is `sourceFilename` / `originalSha256` / `sourceHref`, and the two are shown side by side
 * rather than one standing in for the other (§11.3).
 */
export type ExploreDocument = {
  documentId: string;
  filename: string;
  href: string;
  digest: string;
  pageCount: number;
  regionCount: number;
  sourceLabel?: string;
  accession?: string;
  officialHref?: string;
  secHref?: string;
  /** How many of the document's pages this World compiled, and which ones when it is a slice. */
  compiledPageCount?: number;
  declaredPages?: number[];
  form?: string;
  filingDate?: string;
  reportDate?: string;
  authority?: string;
  representationKind?: "original" | "reference_render";
  sourceFilename?: string;
  sourceHref?: string;
  originalSha256?: string;
  renderProfile?: string;
  sliceRationale?: string;
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
  THE PRESENTATION SUBSET Act 1 draws (§11.4). This is a presentation subset and nothing more.

  The public corpus compiles to 476 objects. Drawing them is the hairball §11.4 forbids, so the
  opening composition is two declared halves:

    left    every compiled Document -- one node per public filing, oldest first, so the column
            reads as the corpus's timeline
    right   the objects named in `PRESENTATION_OBJECTS` below

  The right half used to be declared as a *kind* (the four compiled Topics), which had the
  property that nothing was hand-picked and the cost that the World read as a document index:
  "Security", "Research" and "Finance" are bound to all 97 regions of the corpus, so three of the
  four nodes were interchangeable and none of them was about anything a reader of these filings
  came for. §11.4's own candidate list is semantic -- Apple, Services, the reportable segments,
  tariffs, legal/regulatory, privacy and data security -- so the mapping is now declared object
  by object.

  The rules that keep a declared mapping honest, all three enforced by
  `visual-world-model.test.ts`:

    1. Every entry names an object the compiler actually emitted, matched on kind and on the
       compiler's own label, verbatim. Nothing here writes a label, invents a node, or reaches
       for an object id that is a hash of content nobody can read.
    2. A label that stops resolving fails the unit test and therefore the build. If the corpus
       changes underneath this list, the list is wrong loudly rather than quietly short.
    3. What is left out is out of the opening frame, not out of the World: the other 464 objects
       are still in the model, in the technical drawer, in Ask, and reachable from the accessible
       object list below the canvas.

  These labels come from the compiler's capitalised-token entity heuristic, which the technical
  drawer discloses in those words. Choosing seven of them for the opening frame is a presentation
  choice about *which* real objects to draw first; it is not a claim that the heuristic is a
  resolver, and the disclosure stays where a reader will meet it.
*/
export const PRESENTATION_OBJECT_KIND: VisualKind = "Entity";

/** Compiled object labels, verbatim, in reading order. See the block above before editing. */
export const PRESENTATION_OBJECTS: readonly string[] = [
  "Apple",         // the company the corpus is about; 2 filings
  "Services",      // the revenue category all five filings report
  "Risk Factors",  // legal / regulatory, carried by the 10-K and all three 10-Qs
  "Americas",      // reportable segment
  "Greater China", // reportable segment
  "Tariffs",       // supply-chain and trade risk
  "Privacy",       // the proxy's privacy and data security oversight
];

function chooseFocus(
  world: WorldReadModel,
  focusLimit: number,
  filingDateOf: (object: WorldObject) => string | undefined,
): string[] {
  const degree = degreeMap(world);
  const budget = Math.min(FOCUS_MAX, Math.max(FOCUS_MIN, focusLimit));
  const byDegree = (left: WorldObject, right: WorldObject) =>
    (degree.get(right.id) ?? 0) - (degree.get(left.id) ?? 0) || left.id.localeCompare(right.id);
  /* Filings read oldest first, so the column is the corpus's timeline rather than a ranking. */
  const byFilingDate = (left: WorldObject, right: WorldObject) =>
    (filingDateOf(left) ?? "").localeCompare(filingDateOf(right) ?? "") || byDegree(left, right);
  const focus: string[] = [];
  const add = (id: string | undefined) => {
    if (id && !focus.includes(id) && focus.length < budget) focus.push(id);
  };

  for (const object of world.objects.filter((object) => object.type === "Document").sort(byFilingDate)) {
    add(object.id);
  }
  for (const id of resolvePresentationObjects(world)) add(id);

  // A corpus too small to fill the composition from the subset alone is topped up by degree.
  for (const object of [...world.objects].sort(byDegree)) {
    if (focus.length >= FOCUS_MIN) break;
    // An unmapped heuristic entity is never promoted into the frame by a fallback rule.
    if (object.type === PRESENTATION_OBJECT_KIND) continue;
    add(object.id);
  }
  return focus;
}

/**
 * The mapped objects, in declared order, as ids in this compiled World.
 *
 * Exported so the unit test can assert that every declared label still resolves -- which is the
 * whole guarantee: a mapping that silently stopped matching would shrink the composition without
 * anyone noticing. An entry that matches nothing is dropped here and caught there.
 */
export function resolvePresentationObjects(world: WorldReadModel): string[] {
  return PRESENTATION_OBJECTS
    .map((label) =>
      world.objects.find((object) => object.type === PRESENTATION_OBJECT_KIND && object.label === label)?.id)
    .filter((id): id is string => Boolean(id));
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
function refsStatingFirst(
  object: WorldObject,
  excerptOf: ReadonlyMap<string, string>,
): string[] {
  const refs = [...object.evidenceRefs];
  if (object.type !== "Claim" || refs.length < 2) return refs;
  // Indexed rather than scanned. The linear scan this replaces was O(claims x refs x evidence),
  // which on the 1,169-region corpus was seven seconds of build time for the same answer.
  const stating = refs.filter((id) => (excerptOf.get(id) ?? "").includes(object.label));
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

  /*
    A Document node is named by the filing it is, not by its first line of text.

    The compiler titles a Document node from the opening text of the document, which for an SEC
    proxy statement is the running "Table of Contents Summary Governance Directors ..." header --
    true, and useless as a name. The same rewrite the Evidence nodes already get applies here:
    the form and the filing date, both read out of the acquisition record beside the file, with
    the compiler's own title still printed in the technical drawer. Nothing is invented, and a
    document with no source record keeps the compiler's label.
  */
  const filingLabel = (document: ExploreDocument | undefined) =>
    document?.form && document.filingDate ? `${document.form} · filed ${document.filingDate}` : null;
  /* Indexed once. Both lookups below used to scan `world.evidence` per object. */
  const excerptOf = new Map(world.evidence.map((item) => [item.id, item.excerpt] as const));
  const sourceIdOf = new Map(world.evidence.map((item) => [item.id, item.sourceId] as const));
  const filingOf = (object: WorldObject) =>
    documents.find((document) =>
      object.evidenceRefs.some((ref) => sourceIdOf.get(ref) === document.documentId));

  const nodes: VisualNode[] = world.objects.map((object) => {
    const source = object.type === "Evidence" ? sourceOfEvidenceNode(object, world, documents) : null;
    const filing = object.type === "Document" ? filingOf(object) : undefined;
    return {
      id: object.id,
      label: source ? source.filename : filingLabel(filing) ?? object.label,
      kind: object.type,
      state,
      evidenceRefs: refsStatingFirst(object, excerptOf),
      evidenceCount: object.evidenceRefs.length,
      degree: degree.get(object.id) ?? 0,
    };
  });

  /*
    `relation.evidenceRefs` is deliberately not carried across.

    Nothing on the stage reads it, and this compiler binds a relation to every region of the
    document it was derived from -- so on the 1,169-region corpus that one unread field was
    139MB of the model, serialized straight into the page's RSC payload (§24). The relation's
    evidence is still in the artifact and still in the technical drawer's counts.
  */
  const edges: VisualEdge[] = world.relations.map((relation) => ({
    id: relation.id,
    from: relation.subject,
    to: relation.object,
    predicate: relation.predicate,
    state,
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
      sourceLabel: document?.sourceLabel,
      accession: document?.accession,
      officialHref: document?.officialHref,
      secHref: document?.secHref,
      compiledPageCount: document?.compiledPageCount,
      form: document?.form,
      filingDate: document?.filingDate,
      representationKind: document?.representationKind,
      sourceFilename: document?.sourceFilename,
      sourceHref: document?.sourceHref,
      originalSha256: document?.originalSha256,
      renderProfile: document?.renderProfile,
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
    totals: { objects: nodes.length, relations: edges.length, regions: evidence.length },
    focus: chooseFocus(world, focusLimit, (object) => filingOf(object)?.filingDate),
  };
}

/* ------------------------------------------------------------------- bounding */

/*
  What the page sends to the browser (§24).

  `toVisualWorldModel` is the whole compiled World, and the whole compiled World does not belong
  in an RSC payload. Measured on this corpus: the unbounded model of the five filings serializes
  to about 245MB, because every object and every relation carries a reference to every region of
  the document it was read from -- O(objects x regions), a shape that gets worse exactly as the
  corpus proof gets better. Even the earlier 97-region slice shipped 2.1MB of it.

  So the server keeps the full model -- the counts, Ask, the Change diff and the technical drawer
  are all computed from it -- and hands the stage a projection of what the stage can actually
  reach:

    - every drawn object, and up to RELATION_BOUND of each drawn object's relations;
    - the objects on the other end of those relations, so a relation list can name them;
    - up to REGION_BOUND regions per shipped object, plus every region on the same page as one of
      them, because the source sheet draws the page rather than the line;
    - anything `keepRegionIds` names -- the Ask citations -- and the objects that own them.

  Two rules keep this honest rather than merely smaller. `totals` is carried through untouched,
  so every published count still describes the compiled World. And `evidenceCount` on each node
  stays the compiler's number while `evidenceRefs` shrinks, so a renderer can say "12 of 502
  shown" and never pass off the bound as the fact.
*/
export const RELATION_BOUND = 24;
export const REGION_BOUND = 12;

export function boundVisualWorld(
  model: VisualWorldModel,
  drawnIds: readonly string[],
  keepRegionIds: readonly string[] = [],
): VisualWorldModel {
  const nodeById = new Map(model.nodes.map((node) => [node.id, node] as const));
  const evidenceById = new Map(model.evidence.map((item) => [item.id, item] as const));
  const drawn = new Set(drawnIds.filter((id) => nodeById.has(id)));

  const keptNodeIds = new Set<string>(drawn);
  const keptEdgeIds = new Set<string>();
  const spent = new Map<string, number>();
  for (const edge of model.edges) {
    for (const [end, other] of [[edge.from, edge.to], [edge.to, edge.from]] as const) {
      if (!drawn.has(end)) continue;
      const used = spent.get(end) ?? 0;
      if (used >= RELATION_BOUND) continue;
      if (!nodeById.has(other)) continue;
      spent.set(end, used + 1);
      keptEdgeIds.add(edge.id);
      keptNodeIds.add(other);
    }
  }
  for (const regionId of keepRegionIds) {
    const owner = model.nodes.find((node) => node.evidenceRefs.includes(regionId));
    if (owner) keptNodeIds.add(owner.id);
  }

  const keptRegionIds = new Set<string>(keepRegionIds.filter((id) => evidenceById.has(id)));
  for (const id of keptNodeIds) {
    for (const ref of nodeById.get(id)!.evidenceRefs.slice(0, REGION_BOUND)) keptRegionIds.add(ref);
  }
  // The source sheet renders a page, so a region without its page-mates would render a gap.
  const pages = new Set([...keptRegionIds].map((id) => {
    const item = evidenceById.get(id);
    return item ? `${item.sourceId}#${item.page}` : "";
  }));
  for (const item of model.evidence) {
    if (pages.has(`${item.sourceId}#${item.page}`)) keptRegionIds.add(item.id);
  }

  return {
    ...model,
    nodes: model.nodes
      .filter((node) => keptNodeIds.has(node.id))
      .map((node) => ({ ...node, evidenceRefs: node.evidenceRefs.filter((ref) => keptRegionIds.has(ref)) })),
    edges: model.edges.filter((edge) => keptEdgeIds.has(edge.id)),
    evidence: model.evidence.filter((item) => keptRegionIds.has(item.id)),
  };
}

/* ------------------------------------------------------------------ geometry */

/*
  Where the focus objects sit, computed once on the server and identical on every device.

  The stage is 16:10 (§28) and the coordinates below are in that box, so the renderer can place
  a node with a percentage and never measure anything. That is the whole reason this is a pure
  function rather than a force simulation: a layout that settles differently per device cannot
  be compared against the landing film's last frame, and §29 asks for exactly that comparison.

  Composition: one column per kind in the focused graph, in the order the focus set first reaches
  that kind -- which is the presentation subset's own order, so nothing here has to know what the
  subset contains. On this corpus that reads directly: five filings down the left, the seven
  mapped objects down the right, one edge per compiled relation between them. It stays readable
  as the corpus grows, which the previous orbit composition did not -- nine objects in one
  connected component collapsed into a single ring with every relation drawn as a chord across
  the middle of it.

  Columns are also the keyboard map. Left and right move between kinds, up and down move within
  one, and the narrow layout stacks the same columns in the same order, so one arrangement
  serves the canvas, the keyboard and the phone.

  No physics, no orbit, no animation loop: this is a pure function of the focus set, so two
  devices draw the same composition and §29's comparison against the landing film's last frame
  is a comparison of two identical geometries.
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

export function layoutVisualWorld(model: VisualWorldModel, ids: readonly string[] = model.focus): VisualLayout {
  const inFocus = new Set(ids);
  const focusedEdges = model.edges.filter((edge) => inFocus.has(edge.from) && inFocus.has(edge.to));
  const kindOf = new Map(model.nodes.map((node) => [node.id, node.kind] as const));
  // Column order and the order inside a column are both the focus order: `chooseFocus` already
  // put the filings in filing-date order ahead of the mapped objects in declared order, and
  // re-sorting here by degree would turn the corpus's timeline into a ranking.
  const columns = [...new Set(ids.map((id) => kindOf.get(id)))]
    .map((kind) => ids.filter((id) => kindOf.get(id) === kind));

  const placements: VisualPlacement[] = [];
  columns.forEach((members, index) => {
    const count = columns.length;
    const x = count === 1 ? STAGE_WIDTH / 2 : 200 + (600 * index) / (count - 1);
    // A stack centred on the stage, spread to fill it without letting two nodes touch.
    const step = Math.min(120, (STAGE_HEIGHT - 150) / Math.max(1, members.length - 1));
    const top = STAGE_HEIGHT / 2 - (step * (members.length - 1)) / 2;
    members.forEach((id, tier) => {
      placements.push({
        id,
        x,
        y: top + step * tier,
        // The strongest node of each column reads as its head; the rest of the column follows it.
        role: tier === 0 ? "hub" : "leaf",
        column: index,
        tier,
      });
    });
  });

  const at = new Map(placements.map((placement) => [placement.id, placement] as const));
  const edges: VisualLayoutEdge[] = focusedEdges
    .map((edge) => {
      const from = at.get(edge.from)!;
      const to = at.get(edge.to)!;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      return {
        id: edge.id,
        from: edge.from,
        to: edge.to,
        d: `M ${round(from.x)} ${round(from.y)} C ${round(from.x + dx * 0.35)} ${round(from.y + dy * 0.08)}, ${round(to.x - dx * 0.35)} ${round(to.y - dy * 0.08)}, ${round(to.x)} ${round(to.y)}`,
      };
    });

  return { width: STAGE_WIDTH, height: STAGE_HEIGHT, placements, edges };
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}
