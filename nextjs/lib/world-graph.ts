/**
 * The background field is the published sample, not an invention.
 *
 * It used to be a ring of eight named business areas -- Contracts & Policy, Finance,
 * Engineering, Customers -- with a fact count each, all of it fictional, drawn full-bleed behind
 * the landing page with the area names painted on the canvas. Labelled fiction at the largest
 * scale on the site (BA-001).
 *
 * The clusters are now the five committed Apple SEC filings that `/explore` already publishes,
 * the bridges between them are the entities the filings genuinely share, and the lit wavefront
 * is the arrival of the fifth filing at W4. Every number below is a count taken off the compiled
 * artifact; `world-graph.test.ts` re-derives each one from `lib/explore-sample` and fails if
 * they drift, which is also why the artifact itself is not imported here -- it is 6,310 objects
 * and 7,794 relations, and this module is shipped to the browser.
 *
 * Determinism matters twice over: the same field must appear on every device (so a screenshot
 * matches what a visitor sees), and the structure drawn must be the structure the counts
 * describe. A seeded LCG gives both -- `Math.random` would give neither.
 */

export type NodeState = "kept" | "changed" | "affected";

export interface WorldNode {
  x: number;
  y: number;
  area: number;
  /** Wavefront depth: -1 untouched by the arrival, 0 arrived with it, 1 reached through identity. */
  depth: number;
  state: NodeState;
  radius: number;
}

export interface WorldGraph {
  nodes: WorldNode[];
  edges: [number, number][];
  /** Node indices per filing, in the order they were created. */
  byArea: number[][];
  /** The label the canvas paints over each cluster. Real filings, in arrival order. */
  labels: string[];
  reachByArea: number[];
}

/**
 * The five filings of the public sample, in the order the compiler saw them, with the number of
 * claims each one contributed to W4.
 *
 * `claims` is the count of compiled claims whose source is that filing (3,930 in total, which is
 * the World's own claim count). The cluster sizes on screen are that share of the node budget,
 * so a visitor is looking at the real proportions of the real corpus.
 */
export const SAMPLE_FILINGS = [
  { documentId: "apple-form-10-k", label: "10-K 2025", claims: 1_292 },
  { documentId: "apple-2026-q1-10-q", label: "10-Q Q1 2026", claims: 314 },
  { documentId: "apple-2026-proxy-def14a", label: "DEF 14A 2026", claims: 1_481 },
  { documentId: "apple-2026-q2-10-q", label: "10-Q Q2 2026", claims: 427 },
  { documentId: "apple-2026-q3-10-q", label: "10-Q Q3 2026", claims: 416 },
] as const;

/**
 * How many entities each pair of filings has in common, as `[a, b, shared]` over the indices
 * above.
 *
 * This is the one structural claim the field makes: these five filings are not five islands,
 * because the compiler resolved the same identities across them. Of the World's 2,365 entities,
 * 1,792 appear in exactly one filing and 96 appear in all five -- so every pair genuinely shares
 * some, and no bridge is drawn that the artifact does not support.
 */
export const SHARED_ENTITIES: readonly [number, number, number][] = [
  [0, 1, 362],
  [0, 2, 203],
  [0, 3, 405],
  [0, 4, 394],
  [1, 2, 111],
  [1, 3, 399],
  [1, 4, 398],
  [2, 3, 117],
  [2, 4, 116],
  [3, 4, 435],
];

/**
 * W3 -> W4: what the fifth filing added.
 *
 * 416 claims and 25 entities, which is the whole of the arrival -- the other 2,340 entities were
 * already in W3 and the new filing resolved against them rather than creating duplicates. That
 * is what the lit wavefront shows: the arrival cluster is new, and what lights up beside it in
 * the four earlier filings is identity it was joined to, not content that changed.
 */
export const SAMPLE_ARRIVAL = {
  /** Index into `SAMPLE_FILINGS`. */
  area: 4,
  claims: 416,
  newEntities: 25,
  entitiesBefore: 2_340,
  entitiesAfter: 2_365,
} as const;

/** Numerical Recipes LCG. Small, seedable, and identical in every JS engine. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export const WORLD_SEED = 20260829;

/** Where each filing sits on the arc, in degrees. Five clusters, not eight. */
const AREA_ANGLES = [-90, -20, 40, 120, 200];

/** Node count scaled to viewport area, clamped so neither extreme looks wrong. */
export function nodeBudget(width: number, height: number): number {
  return Math.max(190, Math.min(560, Math.round((width * height) / 2600)));
}

/** The node budget split by the real claim share of each filing, every cluster kept drawable. */
export function share(total: number): number[] {
  const claims = SAMPLE_FILINGS.reduce((sum, filing) => sum + filing.claims, 0);
  const counts = SAMPLE_FILINGS.map((filing) => Math.max(8, Math.round((total * filing.claims) / claims)));
  // The rounding remainder lands on the largest cluster, so the budget is spent exactly.
  const largest = counts.indexOf(Math.max(...counts));
  counts[largest] += total - counts.reduce((sum, count) => sum + count, 0);
  return counts;
}

export function buildWorldGraph(total: number, seed: number = WORLD_SEED): WorldGraph {
  const random = makeRandom(seed);
  const areaCount = SAMPLE_FILINGS.length;
  const nodes: WorldNode[] = [];
  const byArea: number[][] = Array.from({ length: areaCount }, () => []);
  const perArea = share(total);

  for (let area = 0; area < areaCount; area += 1) {
    const angle = (AREA_ANGLES[area] * Math.PI) / 180;
    for (let i = 0; i < perArea[area]; i += 1) {
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
      byArea[area].push(nodes.length - 1);
    }
  }

  /* -- edges ------------------------------------------------------------------------- */

  const edges: [number, number][] = [];
  const link = (a: number, b: number) => {
    if (a === b) return;
    edges.push([a, b]);
  };

  // Within a filing, each node links to a couple of near neighbours in creation order. That is
  // enough to make a cluster look woven without an O(n^2) proximity pass.
  for (const members of byArea) {
    for (let i = 1; i < members.length; i += 1) {
      link(members[i], members[i - 1]);
      if (i > 3 && random() < 0.45) link(members[i], members[i - 4]);
    }
  }

  /*
    One bridge per ~60 shared entities, so a pair that shares four times as many identities is
    drawn four times as tightly bound -- and every pair the artifact reports gets at least one
    bridge. How many bridges are drawn is a drawing decision; that the pair shares identity at
    all is the measured fact, and it is the only thing the picture asserts.
  */
  const bridges: [number, number][] = [];
  for (const [from, to, shared] of SHARED_ENTITIES) {
    const count = Math.max(1, Math.round(shared / 60));
    for (let i = 0; i < count; i += 1) {
      const a = byArea[from][(i * 5 + 2) % byArea[from].length];
      const b = byArea[to][(i * 7 + 1) % byArea[to].length];
      if (a === undefined || b === undefined) continue;
      link(a, b);
      bridges.push([a, b]);
    }
  }

  /* -- the arrival ------------------------------------------------------------------- */

  // Everything in the fifth filing arrived at W4, so the whole cluster is the change.
  for (const index of byArea[SAMPLE_ARRIVAL.area]) {
    nodes[index].depth = 0;
    nodes[index].state = "changed";
  }

  // One hop, and one only: what lights up in the earlier filings is the identity the arrival was
  // joined to. A deeper cascade would assert propagation this artifact does not record.
  for (const [a, b] of bridges) {
    for (const [near, far] of [[a, b], [b, a]] as const) {
      if (nodes[near].area !== SAMPLE_ARRIVAL.area) continue;
      if (nodes[far].area === SAMPLE_ARRIVAL.area || nodes[far].depth >= 0) continue;
      nodes[far].depth = 1;
      nodes[far].state = "affected";
    }
  }

  const reachByArea = byArea.map((members) =>
    members.filter((index) => nodes[index].state === "affected").length,
  );

  return {
    nodes,
    edges,
    byArea,
    labels: SAMPLE_FILINGS.map((filing) => filing.label),
    reachByArea,
  };
}
