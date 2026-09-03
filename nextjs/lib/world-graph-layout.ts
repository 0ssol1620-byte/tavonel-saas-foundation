import type { WorldObjectType, WorldReadModel } from "./world-read-model";

/*
  Where each node goes, decided arithmetically rather than simulated.

  A force-directed layout would look more organic and would be the wrong choice here. This
  graph is a view of a compiled artifact whose whole promise is that the same inputs produce
  the same output: a physics simulation makes the picture depend on frame timing, so two
  people looking at the same World would see different pictures and neither could say which
  was right. Everything below is a pure function of the model.

  The clusters are real. They are the connected components of the relation graph -- a
  document, the topics it discusses and the entities those mention land together because the
  compiler bound them together, not because a spring pulled them.
*/

export type GraphNode = {
  id: string;
  label: string;
  type: WorldObjectType;
  x: number;
  y: number;
  radius: number;
  cluster: number;
  evidenceCount: number;
  relationCount: number;
};

export type GraphEdge = {
  id: string;
  predicate: string;
  from: string;
  to: string;
  /** The evidence this relation is bound to, so clicking the line can open it. */
  evidenceRefs: string[];
  /** Resolved endpoints, so the renderer never has to look a node up mid-draw. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export type GraphLayout = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  clusters: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
};

/*
  Ring order, so a cluster reads outward from what it is about.

  Documents at the centre, then the topics they discuss, the entities those mention, the
  claims and finally the evidence. This is the compiler's own dependency direction, and using
  it means the picture teaches the model rather than decorating it.
*/
const RING_ORDER: readonly WorldObjectType[] = ["Document", "Topic", "Entity", "Claim", "Evidence"];

const RING_SPACING = 130;
const CLUSTER_GAP = 160;
const NODE_RADIUS = 9;

/** Connected components over the relation graph, in a stable order. */
function componentsOf(nodeIds: readonly string[], edges: ReadonlyArray<{ from: string; to: string }>) {
  const parent = new Map(nodeIds.map((id) => [id, id] as const));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cursor = id;
    while (parent.get(cursor) !== root) {
      const next = parent.get(cursor)!;
      parent.set(cursor, root);
      cursor = next;
    }
    return root;
  };
  for (const edge of edges) {
    if (!parent.has(edge.from) || !parent.has(edge.to)) continue;
    const a = find(edge.from);
    const b = find(edge.to);
    if (a !== b) parent.set(a, b);
  }
  const groups = new Map<string, string[]>();
  for (const id of nodeIds) {
    const root = find(id);
    groups.set(root, [...(groups.get(root) ?? []), id]);
  }
  /*
    Largest first, then by root id.

    Size alone is not a total order -- two components of equal size would swap places between
    renders and the layout would stop being deterministic, which is the one property it exists
    to have.
  */
  return [...groups.entries()]
    .sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]))
    .map(([, members]) => members);
}

/** A square-ish grid, so a hundred small clusters do not become a mile-wide strip. */
function clusterGrid(count: number) {
  const columns = Math.max(1, Math.ceil(Math.sqrt(count)));
  return (index: number) => ({ column: index % columns, row: Math.floor(index / columns) });
}

export function layoutWorldGraph(model: WorldReadModel | null): GraphLayout {
  const empty: GraphLayout = { nodes: [], edges: [], clusters: 0, bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } };
  if (!model || model.objects.length === 0) return empty;

  const objects = [...model.objects].sort((left, right) => left.id.localeCompare(right.id));
  const components = componentsOf(objects.map((object) => object.id), model.relations.map((relation) => ({
    from: relation.subject,
    to: relation.object,
  })));

  const byId = new Map(objects.map((object) => [object.id, object] as const));
  const positioned = new Map<string, GraphNode>();
  const place = clusterGrid(components.length);

  // Every cluster is drawn in a cell of the same size, so the picture does not reflow when a
  // filter hides one. The cell is sized by the largest cluster, not by each.
  const widest = Math.max(...components.map((members) => ringRadius(members.length)), RING_SPACING);
  const cell = widest * 2 + CLUSTER_GAP;

  components.forEach((members, clusterIndex) => {
    const { column, row } = place(clusterIndex);
    const centreX = column * cell;
    const centreY = row * cell;
    const byRing = new Map<WorldObjectType, string[]>();
    for (const id of members) {
      const object = byId.get(id);
      if (!object) continue;
      byRing.set(object.type, [...(byRing.get(object.type) ?? []), id]);
    }

    let ring = 0;
    for (const type of RING_ORDER) {
      const members = byRing.get(type);
      if (!members || members.length === 0) continue;
      const radius = ring === 0 && members.length === 1 ? 0 : RING_SPACING * (ring === 0 ? 0.45 : ring);
      members.forEach((id, index) => {
        const object = byId.get(id)!;
        /*
          Half a step of rotation per ring.

          Without it every ring starts at the same angle and the nodes line up in spokes, which
          reads as structure that is not there.
        */
        const angle = (index / members.length) * Math.PI * 2 + ring * 0.4;
        positioned.set(id, {
          id,
          label: object.label,
          type: object.type,
          x: centreX + Math.cos(angle) * radius,
          y: centreY + Math.sin(angle) * radius,
          radius: NODE_RADIUS + Math.min(6, object.evidenceRefs.length),
          cluster: clusterIndex,
          evidenceCount: object.evidenceRefs.length,
          relationCount: object.relations.length,
        });
      });
      ring += 1;
    }
  });

  const nodes = [...positioned.values()];
  const edges = model.relations.flatMap((relation): GraphEdge[] => {
    const from = positioned.get(relation.subject);
    const to = positioned.get(relation.object);
    // An edge whose endpoint is not in the model is not drawn as a line into nowhere.
    if (!from || !to) return [];
    return [{
      id: relation.id,
      predicate: relation.predicate,
      from: relation.subject,
      to: relation.object,
      evidenceRefs: relation.evidenceRefs,
      x1: from.x,
      y1: from.y,
      x2: to.x,
      y2: to.y,
    }];
  });

  const padding = 40;
  const bounds = nodes.reduce(
    (accumulator, node) => ({
      minX: Math.min(accumulator.minX, node.x - node.radius - padding),
      minY: Math.min(accumulator.minY, node.y - node.radius - padding),
      maxX: Math.max(accumulator.maxX, node.x + node.radius + padding),
      maxY: Math.max(accumulator.maxY, node.y + node.radius + padding),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );

  return { nodes, edges, clusters: components.length, bounds };
}

function ringRadius(memberCount: number) {
  // Rough: a cluster's outermost ring cannot exceed one ring per node kind.
  return RING_SPACING * Math.min(RING_ORDER.length, Math.max(1, Math.ceil(memberCount / 6)));
}

export type GraphFilter = {
  query: string;
  types: ReadonlySet<WorldObjectType>;
  predicates: ReadonlySet<string>;
};

export type FilteredGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Ids that matched the text query, for highlighting rather than hiding. */
  matched: ReadonlySet<string>;
  hiddenNodes: number;
  hiddenEdges: number;
};

/**
 * Apply the filters, and keep the distinction between hidden and merely unmatched.
 *
 * A type filter removes nodes: the customer said they do not want to see claims. A search
 * does not -- it marks what matched and leaves the rest drawn, because a node's neighbours
 * are most of what makes a graph worth looking at, and hiding them turns a search into a
 * different graph.
 */
export function filterGraph(layout: GraphLayout, filter: GraphFilter): FilteredGraph {
  const query = filter.query.trim().toLowerCase();
  const nodes = layout.nodes.filter((node) => filter.types.size === 0 || filter.types.has(node.type));
  const visible = new Set(nodes.map((node) => node.id));
  const edges = layout.edges.filter((edge) =>
    (filter.predicates.size === 0 || filter.predicates.has(edge.predicate))
    && visible.has(edge.from) && visible.has(edge.to));
  const matched = new Set(
    query.length === 0
      ? []
      : nodes.filter((node) => node.label.toLowerCase().includes(query) || node.id.toLowerCase().includes(query))
        .map((node) => node.id),
  );
  return {
    nodes,
    edges,
    matched,
    hiddenNodes: layout.nodes.length - nodes.length,
    hiddenEdges: layout.edges.length - edges.length,
  };
}

/** The viewBox that shows everything, which is what a Fit button means. */
export function fitViewBox(layout: GraphLayout) {
  if (layout.nodes.length === 0) return { x: 0, y: 0, width: 100, height: 100 };
  const width = Math.max(1, layout.bounds.maxX - layout.bounds.minX);
  const height = Math.max(1, layout.bounds.maxY - layout.bounds.minY);
  return { x: layout.bounds.minX, y: layout.bounds.minY, width, height };
}

/** Every edge touching a node, which is what "highlight connected" has to mean to be useful. */
export function connectedEdgeIds(edges: readonly GraphEdge[], nodeId: string | null) {
  if (!nodeId) return new Set<string>();
  return new Set(edges.filter((edge) => edge.from === nodeId || edge.to === nodeId).map((edge) => edge.id));
}
