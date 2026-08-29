/**
 * The background field is a claim, not decoration.
 *
 * It asserts that a change in Policy & HR reaches Finance, Operations, Legal and Support and
 * provably does not reach Engineering, Product or Customers. That has to be true of the actual
 * graph, so the graph is built here as a pure function and checked in `world-graph.test.ts`.
 * The canvas component only draws what this returns.
 *
 * Determinism matters twice over: the same field must appear on every device (so a screenshot
 * matches what a visitor sees), and the counts printed elsewhere on the page must match the
 * ones the wavefront actually produces. A seeded LCG gives both -- `Math.random` would give
 * neither.
 */

import { AREAS, CHANGE } from "./demo-world";

export type NodeState = "kept" | "changed" | "affected" | "held";

export interface WorldNode {
  x: number;
  y: number;
  area: number;
  /** Wavefront depth: -1 unreached, 0 origin, 1..n levels out. */
  depth: number;
  state: NodeState;
  radius: number;
}

export interface WorldGraph {
  nodes: WorldNode[];
  edges: [number, number][];
  /** Node indices per area, in the order they were created. */
  byArea: number[][];
  reachByArea: number[];
}

/** Numerical Recipes LCG. Small, seedable, and identical in every JS engine. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export const WORLD_SEED = 20260829;

/** Where each area sits on the ring, in degrees. */
const AREA_ANGLES = [-90, -45, 0, 45, 90, 135, 180, 225];

/**
 * Cross-area dependencies, as [fromArea, toArea, count]. Only these four pairs exist, which is
 * precisely why the last three areas are unreachable from Policy & HR. Adding a pair here
 * changes the reach counts -- and the test that pins them will say so.
 */
const BRIDGES: [number, number, number][] = [
  [0, 1, 6], // Policy & HR -> Finance
  [0, 2, 6], // Policy & HR -> Operations
  [0, 3, 4], // Policy & HR -> Legal
  [0, 4, 3], // Policy & HR -> Support
  [6, 7, 4], // Product -> Customers      (exists, but not reachable from Policy)
  [5, 6, 3], // Engineering -> Product     (likewise)
];

/** Node count scaled to viewport area, clamped so neither extreme looks wrong. */
export function nodeBudget(width: number, height: number): number {
  return Math.max(190, Math.min(560, Math.round((width * height) / 2600)));
}

export function buildWorldGraph(total: number, seed: number = WORLD_SEED): WorldGraph {
  const random = makeRandom(seed);
  const areaCount = AREAS.length;
  const nodes: WorldNode[] = [];
  const byArea: number[][] = Array.from({ length: areaCount }, () => []);

  for (let i = 0; i < total; i += 1) {
    const area = i % areaCount;
    const angle = (AREA_ANGLES[area] * Math.PI) / 180;
    // Polar jitter around the cluster centre, biased outward so clusters read as clouds
    // rather than discs. sqrt keeps the density even across the radius.
    const spread = 0.10 + Math.sqrt(random()) * 0.15;
    const swing = (random() - 0.5) * 0.62;
    const ringRadius = 0.30 + random() * 0.13;
    nodes.push({
      x: 0.5 + Math.cos(angle + swing) * ringRadius + (random() - 0.5) * spread,
      y: 0.5 + Math.sin(angle + swing) * ringRadius * 0.72 + (random() - 0.5) * spread * 0.72,
      area,
      depth: -1,
      state: "kept",
      radius: 0.7 + random() * 1.1,
    });
    byArea[area].push(i);
  }

  /* -- edges ------------------------------------------------------------------------- */

  const edges: [number, number][] = [];
  const adjacency: number[][] = Array.from({ length: total }, () => []);
  const link = (a: number, b: number) => {
    if (a === b) return;
    edges.push([a, b]);
    adjacency[a].push(b);
    adjacency[b].push(a);
  };

  // Within an area, each node links to a couple of near neighbours in creation order. That is
  // enough to make a cluster look woven without an O(n^2) proximity pass.
  for (const members of byArea) {
    for (let i = 1; i < members.length; i += 1) {
      link(members[i], members[i - 1]);
      if (i > 3 && random() < 0.45) link(members[i], members[i - 4]);
    }
  }

  for (const [from, to, count] of BRIDGES) {
    for (let i = 0; i < count; i += 1) {
      const a = byArea[from][(i * 5 + 2) % byArea[from].length];
      const b = byArea[to][(i * 7 + 1) % byArea[to].length];
      link(a, b);
    }
  }

  /* -- the wavefront ------------------------------------------------------------------ */

  // Origins are bridge-adjacent Policy & HR nodes, so the very first level visibly leaves its
  // own area instead of pooling where it started.
  const policy = byArea[0];
  const origins = [policy[2], policy[7], policy[12]].filter((index) => index !== undefined);
  const seen = new Set<number>(origins);
  for (const index of origins) {
    nodes[index].depth = 0;
    nodes[index].state = "changed";
  }

  let frontier = origins.slice();
  for (let level = 0; level < CHANGE.levels.length; level += 1) {
    const candidates: number[] = [];
    for (const index of frontier) {
      for (const neighbour of adjacency[index]) {
        if (!seen.has(neighbour) && !candidates.includes(neighbour)) candidates.push(neighbour);
      }
    }
    // Cross-area neighbours first: the cascade should travel outward, and a level that fills
    // up with same-area nodes would never reach Finance at all.
    candidates.sort((a, b) => {
      const aCross = nodes[a].area === 0 ? 1 : 0;
      const bCross = nodes[b].area === 0 ? 1 : 0;
      return aCross - bCross;
    });

    const next: number[] = [];
    for (const index of candidates) {
      if (next.length >= CHANGE.levels[level]) break;
      seen.add(index);
      nodes[index].depth = level + 1;
      nodes[index].state = "affected";
      next.push(index);
    }
    frontier = next;
  }

  // One held fact, in Support, chosen from the nodes the wavefront did not claim -- otherwise
  // it would overwrite an affected node and the two counts would disagree.
  const support = byArea[4];
  for (let i = support.length - 1; i >= 0; i -= 1) {
    if (nodes[support[i]].depth < 0) {
      nodes[support[i]].state = "held";
      break;
    }
  }

  const reachByArea = byArea.map((members) =>
    members.filter((index) => nodes[index].depth >= 0).length,
  );

  return { nodes, edges, byArea, reachByArea };
}
