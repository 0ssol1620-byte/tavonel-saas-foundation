import { describe, expect, it } from "vitest";
import { exploreSampleSnapshots, exploreSampleWorld } from "./explore-sample";
import {
  SAMPLE_ARRIVAL,
  SAMPLE_FILINGS,
  SHARED_ENTITIES,
  WORLD_SEED,
  buildWorldGraph,
  nodeBudget,
  share,
} from "./world-graph";

const graph = buildWorldGraph(360);
const count = (state: string) => graph.nodes.filter((node) => node.state === state).length;

/*
  The artifact, read the way the field claims to read it.

  `world-graph.ts` pins five claim counts, ten shared-entity counts and one arrival because the
  landing canvas may not ship 6,310 objects to a browser. Pinned numbers rot, so every one of
  them is re-derived here from `lib/explore-sample` -- which is the compiled artifact itself --
  and a recompile that moves any of them fails this file instead of quietly publishing a
  fabricated proportion behind the hero.

  A Document object and the Evidence object of the same filing share their hash suffix, which is
  the only link in the read model from a graph node back to a source document id.
*/
function sourceIdOfDocumentObject(): Map<string, string> {
  const bySuffix = new Map<string, string>();
  for (const region of exploreSampleWorld.evidence) {
    const suffix = region.id.replace(/^evidence-/, "").split(":")[0];
    bySuffix.set(suffix, region.sourceId);
  }
  const map = new Map<string, string>();
  for (const object of exploreSampleWorld.objects) {
    if (object.type !== "Document") continue;
    const sourceId = bySuffix.get(object.id.replace(/^document-/, ""));
    if (sourceId) map.set(object.id, sourceId);
  }
  return map;
}

describe("the sample the field draws", () => {
  it("splits the clusters by the claim count each filing actually contributed", () => {
    const claimsBySource = new Map<string, number>();
    for (const entry of exploreSampleWorld.directory) {
      if (entry.kind !== "claim") continue;
      for (const sourceId of entry.sourceIds) {
        claimsBySource.set(sourceId, (claimsBySource.get(sourceId) ?? 0) + 1);
      }
    }
    for (const filing of SAMPLE_FILINGS) {
      expect(claimsBySource.get(filing.documentId as string), filing.documentId).toBe(filing.claims);
    }
    expect(SAMPLE_FILINGS.reduce((sum, filing) => sum + filing.claims, 0)).toBe(
      exploreSampleWorld.objects.filter((object) => object.type === "Claim").length,
    );
  });

  it("bridges only pairs of filings that share an entity, at the measured count", () => {
    const documents = sourceIdOfDocumentObject();
    const index = new Map<string, number>(
      SAMPLE_FILINGS.map((filing, position) => [filing.documentId, position]),
    );
    const areasOfEntity = new Map<string, Set<number>>();
    for (const relation of exploreSampleWorld.relations) {
      if (relation.predicate !== "mentions_entity") continue;
      const sourceId = documents.get(relation.subject);
      const area = sourceId === undefined ? undefined : index.get(sourceId);
      if (area === undefined) continue;
      const seen = areasOfEntity.get(relation.object) ?? new Set<number>();
      seen.add(area);
      areasOfEntity.set(relation.object, seen);
    }

    const measured = new Map<string, number>();
    for (const areas of areasOfEntity.values()) {
      for (const a of areas) for (const b of areas) {
        if (a >= b) continue;
        const key = `${a}-${b}`;
        measured.set(key, (measured.get(key) ?? 0) + 1);
      }
    }

    expect(SHARED_ENTITIES.length).toBe(measured.size);
    for (const [a, b, shared] of SHARED_ENTITIES) {
      expect(measured.get(`${a}-${b}`), `${a}-${b}`).toBe(shared);
    }
  });

  it("describes the fifth filing's arrival as the artifact records it", () => {
    const w3 = exploreSampleSnapshots[3].world;
    const before = new Set(w3.objects.map((object) => object.id));
    const arrived = exploreSampleWorld.objects.filter((object) => !before.has(object.id));
    expect(arrived.filter((object) => object.type === "Claim").length).toBe(SAMPLE_ARRIVAL.claims);
    expect(arrived.filter((object) => object.type === "Entity").length).toBe(SAMPLE_ARRIVAL.newEntities);
    expect(w3.objects.filter((object) => object.type === "Entity").length).toBe(SAMPLE_ARRIVAL.entitiesBefore);
    expect(exploreSampleWorld.objects.filter((object) => object.type === "Entity").length).toBe(
      SAMPLE_ARRIVAL.entitiesAfter,
    );
    expect(SAMPLE_FILINGS[SAMPLE_ARRIVAL.area].claims).toBe(SAMPLE_ARRIVAL.claims);
  });
});

describe("world graph", () => {
  it("labels every cluster with a filing, and nothing invented", () => {
    expect(graph.labels).toEqual(["10-K 2025", "10-Q Q1 2026", "DEF 14A 2026", "10-Q Q2 2026", "10-Q Q3 2026"]);
    expect(graph.byArea.length).toBe(graph.labels.length);
  });

  it("marks the whole arriving filing as the change, and nothing outside it", () => {
    expect(count("changed")).toBe(graph.byArea[SAMPLE_ARRIVAL.area].length);
    for (const node of graph.nodes.filter((item) => item.state === "changed")) {
      expect(node.area).toBe(SAMPLE_ARRIVAL.area);
      expect(node.depth).toBe(0);
    }
  });

  it("reaches every earlier filing through shared identity, one hop and no further", () => {
    for (let area = 0; area < graph.labels.length; area += 1) {
      if (area === SAMPLE_ARRIVAL.area) {
        expect(graph.reachByArea[area]).toBe(0);
        continue;
      }
      expect(graph.reachByArea[area], graph.labels[area]).toBeGreaterThan(0);
    }
    for (const node of graph.nodes.filter((item) => item.state === "affected")) expect(node.depth).toBe(1);
    expect(graph.nodes.some((node) => node.depth > 1)).toBe(false);
  });

  it("leaves everything the arrival did not touch alone", () => {
    expect(count("kept")).toBe(graph.nodes.length - count("changed") - count("affected"));
  });

  it("holds nothing back, because the sample records no pending review", () => {
    // The old field held one "fact with two readings" out of the world. The published artifact
    // records no pending review at all, so the picture cannot show one.
    expect(exploreSampleWorld.review.state).toBe("not_yet");
    expect(graph.nodes.some((node) => (node.state as string) === "held")).toBe(false);
  });

  it("is identical on every device for a given size", () => {
    const again = buildWorldGraph(360, WORLD_SEED);
    expect(again.nodes.map((node) => [node.x, node.y, node.state])).toEqual(
      graph.nodes.map((node) => [node.x, node.y, node.state]),
    );
  });

  it("holds its claims at both ends of the node budget", () => {
    for (const total of [190, 560]) {
      const g = buildWorldGraph(total);
      expect(g.nodes.length).toBe(total);
      expect(g.nodes.filter((node) => node.state === "changed").length).toBe(g.byArea[SAMPLE_ARRIVAL.area].length);
      for (let area = 0; area < g.labels.length; area += 1) {
        if (area === SAMPLE_ARRIVAL.area) continue;
        expect(g.reachByArea[area], `${total} budget, ${g.labels[area]}`).toBeGreaterThan(0);
      }
    }
  });

  it("spends the whole budget in the corpus's own proportions", () => {
    const counts = share(360);
    expect(counts.reduce((sum, value) => sum + value, 0)).toBe(360);
    // DEF 14A carries the most claims (1,481) and the 2026 Q1 10-Q the fewest (314).
    expect(counts.indexOf(Math.max(...counts))).toBe(2);
    expect(counts.indexOf(Math.min(...counts))).toBe(1);
  });

  it("keeps the smallest filing drawable at the smallest budget", () => {
    for (const total of [190, 560]) {
      for (const cluster of buildWorldGraph(total).byArea) expect(cluster.length).toBeGreaterThanOrEqual(8);
    }
  });

  it("clamps the node budget at both extremes", () => {
    expect(nodeBudget(320, 480)).toBe(190);
    expect(nodeBudget(3840, 2160)).toBe(560);
    expect(nodeBudget(1440, 900)).toBeGreaterThan(190);
  });
});
