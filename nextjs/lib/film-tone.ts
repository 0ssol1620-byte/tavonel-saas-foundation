import { SHARED_ENTITIES, type WorldGraph } from "@/lib/world-graph";

/*
  The hero's tone for the four locked cuts (2026-11-10, founder variant A): the same films on the site's own paper.

  "dark" is each cut as locked, value for value. "light" swaps every colour the cuts paint on their dark panels for the
  site token that plays the same part (app/tavonel.css), the mapping cut 2 was approved on (preview-3). Colours that
  are already paper -- cut 1's scanned pages, inks and stamps -- are not in the map and draw unchanged. Code text
  colours hold >= 4.5:1 on the code ground #fbfaf7; marks hold >= 3:1 on the pane #ffffff.
*/
export type FilmTone = "dark" | "light";
type RGB = [number, number, number];

const LIGHT: Record<string, string> = {
  "#070809": "#f5f3ee", // studio
  "#08090a": "#f5f3ee",
  "#101214": "#ffffff", // pane
  "#2e353b": "#dedad2", // pane rule
  "#16191c": "#f2f0eb", // pane head
  "#14171a": "#ffffff", // title bar
  "#edeae4": "#15191d", // text
  "rgba(40,140,110,0.95)": "#1a6d51", // pane status
  "#0b0d0e": "#fbfaf7", // code ground
  "#0e1114": "#fbfaf7",
  "rgba(123,224,190,0.85)": "#026470", // code title
  "rgba(123,224,190,0.9)": "#0590a2", // title dot
  "rgba(123,224,190,0.8)": "#005bb3", // selected card rule
  "rgba(123,224,190,0.12)": "rgba(2,100,112,0.1)", // selected row
  "#121416": "#f2f0eb", // gutter, rail
  "#1a1e22": "#efece6", // row rule
  "#3a4248": "#6b7178", // line numbers, faint
  "#c8ced2": "#3b4249", // body
  "#9aa3a8": "#5c636b", // diff context
  "#7be0be": "#026470", // accent
  "#1a2220": "#e5edf9", // selected card
  "#1a1814": "#fbf3e2", // touched card
  "#3d4a46": "#d2d6dc", // card bar
  "#7d878d": "#5c636b", // meta, dim
  "#8a9399": "#5c636b",
  "#8fb4c9": "#1f4f86", // attributes
  "#e0c07a": "#8a5a00", // touched, abstain
  "#e07a5f": "#b3261e", // removed
  "#b48fd9": "#1f4f86", // no violet on paper (UX-L1)
  "#1a1614": "#e6e2da", // a page before the scan reaches it
  "rgba(46,53,59,0.9)": "#dedad2",
  "rgba(80,88,94,0.16)": "rgba(21,25,29,0.1)",
};

/** The colour a cut paints for `dark` in this tone. */
export function tint(tone: FilmTone, dark: string): string {
  return tone === "light" ? (LIGHT[dark] ?? dark) : dark;
}

/** Source-document hues on paper: orange, teal, blue, raspberry, green (cut 2's `light.areas`). */
export const LIGHT_AREAS: RGB[] = [[184, 82, 0], [0, 125, 99], [31, 111, 209], [194, 51, 107], [67, 125, 23], [184, 82, 0], [0, 125, 99], [31, 111, 209]];

/** A dim node is a mark on paper, so it needs more alpha there than it does on the dark panel. */
export function dimAlpha(tone: FilmTone, dark: number): number {
  return tone === "light" ? Math.max(0.5, dark) : dark;
}

/*
  "Compiled" graph (founder, 2026-11-10): the clusters stay where buildWorldGraph puts them and read as
  topics; a node's colour is the source document its entity came from. Each topic is mostly fed by one
  document and partly by the documents it shares identity with (SHARED_ENTITIES), and a borrowed colour
  sits on the side of the cluster that faces that document's own topic -- a realistic mix, not noise.
  The empty centre of the ring becomes a core of identity-resolved entities that several documents point
  to: larger, linked into every topic, and grown last, so the core lights up as the cross-topic links form.
  Deterministic: one LCG, a fixed seed.
*/
export type CompiledGraph = WorldGraph & { doc: number[]; coreStart: number };
export function compileGraph(g: WorldGraph): CompiledGraph {
  let state = 20261110;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const areas = g.byArea.length;
  const centre = g.byArea.map((m) => ({
    x: m.reduce((sum, i) => sum + g.nodes[i].x, 0) / Math.max(1, m.length),
    y: m.reduce((sum, i) => sum + g.nodes[i].y, 0) / Math.max(1, m.length),
  }));
  const shared = (a: number, b: number) => SHARED_ENTITIES.find(([x, y]) => (x === a && y === b) || (x === b && y === a))?.[2] ?? 0;
  const nodes = g.nodes.map((n) => ({ ...n }));
  const doc = nodes.map((n) => {
    if (random() < 0.52) return n.area;
    const c = centre[n.area];
    const dx = n.x - c.x, dy = n.y - c.y;
    const weights = Array.from({ length: areas }, (_, b) => {
      if (b === n.area) return 0;
      const tx = centre[b].x - c.x, ty = centre[b].y - c.y;
      const facing = (dx * tx + dy * ty) / (Math.hypot(tx, ty) * Math.max(0.02, Math.hypot(dx, dy)));
      return shared(n.area, b) * Math.max(0.12, 1 + 1.6 * facing);
    });
    let pick = random() * weights.reduce((a, b) => a + b, 0);
    for (let b = 0; b < areas; b += 1) { pick -= weights[b]; if (pick <= 0) return b; }
    return n.area;
  });
  const intra = g.edges.filter(([a, b]) => g.nodes[a].area === g.nodes[b].area);
  const cross = g.edges.filter(([a, b]) => g.nodes[a].area !== g.nodes[b].area);
  // the core: about 7% of the budget, inside the ring
  const coreStart = nodes.length;
  const coreCount = Math.max(14, Math.round(nodes.length * 0.07));
  const core: number[] = [];
  for (let i = 0; i < coreCount; i += 1) {
    const a = random() * Math.PI * 2, d = Math.sqrt(random()) * 0.16;
    const home = Math.floor(random() * areas);
    nodes.push({ x: 0.5 + Math.cos(a) * d, y: 0.5 + Math.sin(a) * d * 0.8, area: home, depth: -1, state: "kept", radius: 1.6 + random() * 0.8 });
    doc.push(home);
    core.push(nodes.length - 1);
  }
  const coreEdges: [number, number][] = [];
  core.forEach((c, i) => {
    // every core entity reaches three or four topics; together they reach all of them
    // to the inner edge of each topic it reaches (nearest of a few candidates), so the spokes stay short
    for (let k = 0; k < 3; k += 1) {
      const m = g.byArea[(i + k * 2) % areas];
      let best = m[0], bestD = Infinity;
      for (let q = 0; q < 8; q += 1) {
        const cand = m[Math.floor(random() * m.length)];
        const d = Math.hypot(nodes[cand].x - nodes[c].x, nodes[cand].y - nodes[c].y);
        if (d < bestD) { bestD = d; best = cand; }
      }
      coreEdges.push([c, best]);
    }
    if (i > 0) coreEdges.push([c, core[Math.floor(random() * i)]]);
  });
  // cross-topic bridges and core links interleave at the end of the clock
  const tail: [number, number][] = [];
  const total = cross.length + coreEdges.length;
  for (let i = 0, a = 0, b = 0; i < total; i += 1) {
    if (b >= coreEdges.length || (a < cross.length && a / cross.length <= b / coreEdges.length)) tail.push(cross[a++]);
    else tail.push(coreEdges[b++]);
  }
  return { ...g, nodes, edges: [...intra, ...tail], doc, coreStart };
}

