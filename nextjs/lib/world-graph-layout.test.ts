import { describe, expect, it } from "vitest";
import { compileCollectionCandidate, type CollectionOcrInput } from "./collection-compiler";
import {
  connectedEdgeIds,
  filterGraph,
  fitViewBox,
  layoutWorldGraph,
  projectLod,
  type FilteredGraph,
  type GraphEdge,
  type GraphLayout,
  type GraphNode,
} from "./world-graph-layout";
import { buildWorldReadModel, type WorldReadModel } from "./world-read-model";

/*
  The graph layout, against a real compile rather than a fixture.

  Running the actual compiler means the shape under test is the shape a customer gets, and a
  change to how the compiler binds topics to documents shows up here as a changed cluster
  count rather than as a fixture that quietly stopped resembling anything.
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

function modelOf(documents: ReadonlyArray<[string, string, string]>) {
  const base = compileCollectionCandidate(documents.map(([id, digest, text]) => input(id, digest, text)));
  const source = {
    ...base,
    coreExecution: {
      status: "completed" as const,
      runtime: "tavonel-python-core-v2",
      worldStateId: "world-state-1",
      receipt: { requestId: "graph-test", outputSha256: `sha256:${"c".repeat(64)}`, candidatePromotion: false as const },
    },
  };
  return buildWorldReadModel(source, source.collectionId, { origin: "deterministic_sample" })!;
}

const TWO_LINKED = modelOf([
  ["contract-a", "a".repeat(64), "ACME Corporation shall pay every valid invoice within 30 calendar days."],
  ["contract-b", "b".repeat(64), "ACME Corporation requires written approval before changing payment terms."],
]);

describe("laying out a compiled world", () => {
  it("is a pure function of the model, so the same World always draws the same picture", () => {
    const first = layoutWorldGraph(TWO_LINKED);
    const second = layoutWorldGraph(TWO_LINKED);
    expect(second.nodes).toEqual(first.nodes);
    expect(second.edges).toEqual(first.edges);
  });

  it("places every compiled object and draws every compiled relation", () => {
    const layout = layoutWorldGraph(TWO_LINKED);
    expect(layout.nodes).toHaveLength(TWO_LINKED.objects.length);
    expect(layout.edges).toHaveLength(TWO_LINKED.relations.length);
    expect(layout.edges.length).toBeGreaterThan(0);
  });

  it("carries the evidence each relation is bound to, so a line can be clicked through", () => {
    const layout = layoutWorldGraph(TWO_LINKED);
    const bound = layout.edges.filter((edge) => edge.evidenceRefs.length > 0);
    expect(bound.length).toBeGreaterThan(0);
    for (const edge of bound) {
      for (const reference of edge.evidenceRefs) {
        expect(TWO_LINKED.evidence.some((item) => item.id === reference)).toBe(true);
      }
    }
  });

  it("clusters by what the compiler actually connected", () => {
    /*
      Checked against an independent traversal rather than against a number.

      A hard-coded cluster count would be asserting this compiler's current topic assignment
      -- every document currently lands on a shared "General" topic, so two unrelated
      documents share a component. That is the compiler's business and may change. What must
      not change is that the layout's clusters *are* the connected components of the relation
      graph, which is what this recomputes.
    */
    const layout = layoutWorldGraph(TWO_LINKED);
    const neighbours = new Map<string, string[]>();
    for (const relation of TWO_LINKED.relations) {
      neighbours.set(relation.subject, [...(neighbours.get(relation.subject) ?? []), relation.object]);
      neighbours.set(relation.object, [...(neighbours.get(relation.object) ?? []), relation.subject]);
    }
    const seen = new Set<string>();
    let components = 0;
    for (const node of layout.nodes) {
      if (seen.has(node.id)) continue;
      components += 1;
      const queue = [node.id];
      while (queue.length > 0) {
        const current = queue.pop()!;
        if (seen.has(current)) continue;
        seen.add(current);
        for (const next of neighbours.get(current) ?? []) if (!seen.has(next)) queue.push(next);
      }
    }
    expect(layout.clusters).toBe(components);
    // And it is a real partition, not one cluster with everything in it.
    expect(layout.clusters).toBeGreaterThan(1);
  });

  it("gives every node in a component the same cluster id", () => {
    const layout = layoutWorldGraph(TWO_LINKED);
    const clusterOf = new Map(layout.nodes.map((node) => [node.id, node.cluster] as const));
    for (const edge of layout.edges) {
      expect(clusterOf.get(edge.from)).toBe(clusterOf.get(edge.to));
    }
  });

  it("returns an empty layout rather than throwing when there is nothing compiled", () => {
    const layout = layoutWorldGraph(null);
    expect(layout).toEqual({ nodes: [], edges: [], clusters: 0, bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } });
  });

  it("fits to the content it actually has", () => {
    const layout = layoutWorldGraph(TWO_LINKED);
    const box = fitViewBox(layout);
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
    for (const node of layout.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(box.x);
      expect(node.x).toBeLessThanOrEqual(box.x + box.width);
      expect(node.y).toBeGreaterThanOrEqual(box.y);
      expect(node.y).toBeLessThanOrEqual(box.y + box.height);
    }
  });
});

describe("filtering the graph", () => {
  const layout = layoutWorldGraph(TWO_LINKED);

  it("hides a type when asked, and drops the edges that would dangle", () => {
    const filtered = filterGraph(layout, { query: "", types: new Set(["Document"]), predicates: new Set() });
    expect(filtered.nodes.every((node) => node.type === "Document")).toBe(true);
    // Not "some edges are hidden" -- no edge may survive with an endpoint that is not drawn.
    for (const edge of filtered.edges) {
      expect(filtered.nodes.some((node) => node.id === edge.from)).toBe(true);
      expect(filtered.nodes.some((node) => node.id === edge.to)).toBe(true);
    }
  });

  it("marks what a search matched instead of hiding everything else", () => {
    const label = layout.nodes[0].label;
    const filtered = filterGraph(layout, { query: label, types: new Set(), predicates: new Set() });
    expect(filtered.matched.size).toBeGreaterThan(0);
    // A node's neighbours are most of what makes a graph worth looking at.
    expect(filtered.nodes).toHaveLength(layout.nodes.length);
  });

  it("filters by relation predicate", () => {
    const predicate = layout.edges[0].predicate;
    const filtered = filterGraph(layout, { query: "", types: new Set(), predicates: new Set([predicate]) });
    expect(filtered.edges.every((edge) => edge.predicate === predicate)).toBe(true);
    expect(filtered.edges.length).toBeGreaterThan(0);
  });
});

describe("highlighting what a node is connected to", () => {
  it("returns every edge touching it, in either direction", () => {
    const layout = layoutWorldGraph(TWO_LINKED);
    const busiest = [...layout.nodes].sort((left, right) => right.relationCount - left.relationCount)[0];
    const connected = connectedEdgeIds(layout.edges, busiest.id);
    const expected = layout.edges.filter((edge) => edge.from === busiest.id || edge.to === busiest.id);
    expect(connected.size).toBe(expected.length);
    expect(connected.size).toBeGreaterThan(0);
  });

  it("is empty when nothing is selected", () => {
    expect(connectedEdgeIds(layoutWorldGraph(TWO_LINKED).edges, null).size).toBe(0);
  });
});

describe("balance of the cluster grid", () => {
  const singles = (count: number) => ({
    objects: Array.from({ length: count }, (_, index) => ({
      id: `o${String(index).padStart(4, "0")}`, label: `o${index}`, type: "Topic", evidenceRefs: [], relations: [],
    })),
    relations: [],
  }) as unknown as WorldReadModel;

  it("keeps the cluster grid square-ish", () => {
    for (let count = 1; count <= 400; count += 1) {
      const layout = layoutWorldGraph(singles(count));
      const columns = new Set(layout.nodes.map((node) => node.x)).size;
      const rows = new Set(layout.nodes.map((node) => node.y)).size;
      expect([0, 1], `${count} clusters: ${columns}x${rows}`).toContain(columns - rows);
      expect(columns / rows).toBeLessThanOrEqual(2);
      // Two clusters are one row of two cells by construction; the drawn box is only compared from three up.
      if (count >= 3) {
        const width = layout.bounds.maxX - layout.bounds.minX;
        const height = layout.bounds.maxY - layout.bounds.minY;
        expect(Math.max(width / height, height / width)).toBeLessThanOrEqual(2);
      }
    }
  });
});

describe("level of detail", () => {
  const TYPE_CYCLE = ["Document", "Topic", "Entity"] as const;
  const node = (id: string, cluster: number, x: number, y: number, index = 0): GraphNode => ({
    id, label: id, type: TYPE_CYCLE[index % 3]!, x, y, radius: 9, cluster, evidenceCount: 0, relationCount: 0,
  });
  const edge = (id: string, from: GraphNode, to: GraphNode, evidenceRefs: string[]): GraphEdge => ({
    id, predicate: "mentions", from: from.id, to: to.id, evidenceRefs, x1: from.x, y1: from.y, x2: to.x, y2: to.y,
  });
  const a0 = node("a0", 0, 0, 0, 0);
  const a1 = node("a1", 0, 10, 20, 1);
  const a2 = node("a2", 0, 20, 10, 2);
  const b0 = node("b0", 1, 100, 100, 0);
  const b1 = node("b1", 1, 120, 100, 1);
  const c0 = node("c0", 2, 300, 0, 0);
  const nodes = [a0, a1, a2, b0, b1, c0];
  const edges = [
    edge("e1", a0, a1, ["ev-1"]),
    edge("e2", a1, b0, ["ev-2", "ev-1"]),
    edge("e3", a2, b1, ["ev-3", "ev-2"]),
    edge("e4", b0, b1, []),
  ];
  const layout: GraphLayout = { nodes, edges, clusters: 3, bounds: { minX: 0, minY: 0, maxX: 300, maxY: 100 } };
  const filtered: FilteredGraph = { nodes, edges, matched: new Set(), hiddenNodes: 0, hiddenEdges: 0 };
  const none = new Set<number>();

  it("projects everything when under the budget", () => {
    const projected = projectLod(filtered, layout, { budget: 6, expanded: none });
    expect(projected.aggregates).toEqual([]);
    expect(projected.nodes).toBe(filtered.nodes);
    expect(projected.edges).toBe(filtered.edges);
  });

  it("collapses each unexpanded cluster to one aggregate at its members' mean, deterministically", () => {
    const once = projectLod(filtered, layout, { budget: 2, expanded: none });
    expect(once).toEqual(projectLod(filtered, layout, { budget: 2, expanded: none }));
    expect(once.nodes).toEqual([]);
    expect(once.aggregates.map((aggregate) => aggregate.cluster)).toEqual([0, 1, 2]);
    const first = once.aggregates[0]!;
    expect([first.x, first.y, first.memberCount]).toEqual([10, 10, 3]);
    expect(first.types).toMatchObject({ Document: 1, Topic: 1, Entity: 1, Claim: 0, Evidence: 0 });
    expect(first.edgeCount).toBe(3);
  });

  it("keeps an expanded cluster's members and collapses inter-cluster edges to one per pair with the union of evidence", () => {
    const projected = projectLod(filtered, layout, { budget: 2, expanded: new Set([0]) });
    expect(projected.nodes.map((n) => n.id)).toEqual(["a0", "a1", "a2"]);
    expect(projected.aggregates.map((aggregate) => aggregate.cluster)).toEqual([1, 2]);
    const folded = projected.edges.filter((candidate) => candidate.id.startsWith("agg:"));
    expect(folded.map((candidate) => [candidate.id, candidate.evidenceRefs])).toEqual([
      ["agg:0-1", ["ev-1", "ev-2", "ev-3"]],
    ]);
    // a0-a1 lies inside the expanded cluster and stays a plain edge.
    expect(projected.edges.map((candidate) => candidate.id)).toContain("e1");
  });

  it("never drops an edge's evidence when collapsing", () => {
    const projected = projectLod(filtered, layout, { budget: 2, expanded: none });
    const inter = new Set(edges.filter((candidate) => ["e2", "e3"].includes(candidate.id)).flatMap((candidate) => candidate.evidenceRefs));
    const kept = new Set(projected.edges.flatMap((candidate) => candidate.evidenceRefs));
    expect(kept).toEqual(inter);
  });

  it("projects an empty or null model to nothing without throwing", () => {
    const empty = layoutWorldGraph(null);
    const none2 = filterGraph(empty, { query: "", types: new Set(), predicates: new Set() });
    expect(projectLod(none2, empty, { budget: 0, expanded: none })).toEqual({ nodes: [], edges: [], aggregates: [] });
  });

  it("treats a budget below 1 as 1", () => {
    const projected = projectLod(filtered, layout, { budget: -5, expanded: none });
    expect(projected.aggregates).toHaveLength(3);
    expect(projected.aggregates.every((aggregate) => Number.isFinite(aggregate.x) && Number.isFinite(aggregate.radius))).toBe(true);
    const single: FilteredGraph = { ...filtered, nodes: [a0], edges: [] };
    expect(projectLod(single, layout, { budget: 0, expanded: none }).nodes).toBe(single.nodes);
  });
});
