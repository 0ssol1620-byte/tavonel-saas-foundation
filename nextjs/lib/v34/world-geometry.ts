/*
  World geometry: the one projection the home hero and /world draw, shared by all three renderers
  (WebGL, Canvas2D, the static SVG). Pure functions over the public reference corpus.

  Ported from the target's World29 renderer (site.js, "TAVONEL V29") and kept numerically
  identical where it matters: the FNV-1a placement, the layer planes, the model-view-projection
  matrix and the 15 px picking radius. Nothing here is inferred. A position is a function of a
  record's id and kind, and the only lines are the corpus's own edges.

  No imports, and erasable TypeScript only (no enums, namespaces or parameter properties), so a
  Node type-stripping run can load this file directly.
*/

export type WorldKind = "Source" | "Entity" | "Concept" | "Claim" | "Change";
export type WorldMode = "layers" | "world";

/** Layer order: layer 1..5 is the index in this list plus one. */
export const WORLD_KINDS: readonly WorldKind[] = ["Source", "Entity", "Concept", "Claim", "Change"];

export const KIND_PLURAL: Readonly<Record<WorldKind, string>> = {
  Source: "sources",
  Entity: "entities",
  Concept: "concepts",
  Claim: "claims",
  Change: "changes",
};

/** Legend colours; each is at least 9:1 on the instrument ground. */
export const KIND_COLORS: Readonly<Record<WorldKind, string>> = {
  Source: "#66c2eb",
  Entity: "#b9a8ee",
  Concept: "#4dd6ba",
  Claim: "#ccee94",
  Change: "#f6a14c",
};

export const WORLD_GROUND = "#07100e";

const KIND_RGB: Readonly<Record<WorldKind, readonly [number, number, number]>> = {
  Source: [0.4, 0.76, 0.91],
  Entity: [0.73, 0.66, 0.94],
  Concept: [0.3, 0.84, 0.73],
  Claim: [0.8, 0.94, 0.58],
  Change: [0.97, 0.63, 0.3],
};

const KIND_SIZE: Readonly<Record<WorldKind, number>> = {
  Source: 5.8,
  Entity: 6.6,
  Concept: 3.1,
  Claim: 6.6,
  Change: 6.6,
};

const FOCUS_SIZE = 12;

/* ---- corpus shape (the byte-exact public JSON) ---- */

export type CorpusNode = {
  id: string;
  label: string;
  kind: string;
  domain: string;
  source: string;
  note: string;
  status: string;
};

export type CorpusEdge = { a: string; b: string; relation: string };

/** `[title, date or revision, url, kind]` */
export type CorpusSource = readonly [string, string, string, string];

export type WorldCorpus = {
  sources: Readonly<Record<string, CorpusSource>>;
  nodes: readonly CorpusNode[];
  edges: readonly CorpusEdge[];
};

/* ---- layout ---- */

export type LayoutNode = {
  id: string;
  kind: WorldKind;
  /** 1..5, Source..Change. */
  layer: number;
  x: number;
  y: number;
  z: number;
  /** Base point size before focus. */
  r: number;
};

export type LayoutEdge = { a: string; b: string; relation: string; ia: number; ib: number };

export type WorldLayout = {
  mode: WorldMode;
  nodes: readonly LayoutNode[];
  edges: readonly LayoutEdge[];
};

/** FNV-1a 32-bit over a string, mapped to [0, 1). Same loop as the target. */
export function fnv1a(text: string): number {
  let x = 2166136261;
  for (const c of text) {
    x ^= c.charCodeAt(0);
    x = Math.imul(x, 16777619);
  }
  return (x >>> 0) / 4294967296;
}

const LAYER_X_SPACING = 1.62;
const PLANE_HALF_Y = 1.83;
const PLANE_HALF_Z = 1.69;

function isWorldKind(kind: string): kind is WorldKind {
  return (WORLD_KINDS as readonly string[]).includes(kind);
}

/**
  Deterministic placement seeded by record identity. Throws on a node whose kind is not one of the
  five layers and on an edge whose endpoint is not a node: the corpus is verified before it gets
  here, so a miss is a defect to surface, not a record to drop quietly.
*/
export function layoutWorld(corpus: WorldCorpus, mode: WorldMode = "layers"): WorldLayout {
  const groupSize = new Map<WorldKind, number>();
  for (const node of corpus.nodes) {
    if (!isWorldKind(node.kind)) throw new Error(`world layout: unknown record kind "${node.kind}" on ${node.id}`);
    groupSize.set(node.kind, (groupSize.get(node.kind) ?? 0) + 1);
  }
  const seen = new Map<WorldKind, number>();
  const index = new Map<string, number>();
  const nodes: LayoutNode[] = corpus.nodes.map((node, at) => {
    const kind = node.kind as WorldKind;
    const layer = WORLD_KINDS.indexOf(kind);
    const n = groupSize.get(kind) ?? 0;
    const i = seen.get(kind) ?? 0;
    seen.set(kind, i + 1);
    index.set(node.id, at);

    const side = Math.ceil(Math.sqrt(n));
    const jitter = fnv1a(node.id) - 0.5;
    let x = (layer - 2) * LAYER_X_SPACING;
    let y = ((i % side) / Math.max(1, side - 1) - 0.5) * 3.1;
    let z = (Math.floor(i / side) / Math.max(1, Math.ceil(n / side) - 1) - 0.5) * 2.9;
    if (n <= 5) {
      y = (i - (n - 1) / 2) * 0.55;
      z = (fnv1a(node.id + "z") - 0.5) * 1.7;
    }
    if (mode === "world") {
      const a = fnv1a(node.id + "a") * Math.PI * 2;
      const b = Math.acos(2 * fnv1a(node.id + "b") - 1);
      const r = 1.15 + fnv1a(node.id + "r") * 2.15;
      x = Math.sin(b) * Math.cos(a) * r;
      y = Math.cos(b) * r;
      z = Math.sin(b) * Math.sin(a) * r;
    }
    return { id: node.id, kind, layer: layer + 1, x: x + jitter * 0.04, y: y + jitter * 0.07, z: z + jitter * 0.07, r: KIND_SIZE[kind] };
  });
  if (index.size !== corpus.nodes.length) throw new Error("world layout: duplicate record id");

  const edges: LayoutEdge[] = corpus.edges.map((edge) => {
    const ia = index.get(edge.a);
    const ib = index.get(edge.b);
    if (ia === undefined || ib === undefined) throw new Error(`world layout: relationship ${edge.a} -> ${edge.b} names a record that is not in the corpus`);
    return { a: edge.a, b: edge.b, relation: edge.relation, ia, ib };
  });
  return { mode, nodes, edges };
}

/* ---- camera and projection ---- */

export type Camera = { yaw: number; pitch: number; distance: number };

export const DEFAULT_CAMERA: Readonly<Camera> = { yaw: -0.57, pitch: 0.23, distance: 10.5 };
export const CAMERA_LIMITS = { pitch: 1.1, distanceMin: 6.5, distanceMax: 16, zoomStep: 0.8 } as const;

export const FOV = 0.68;
const NEAR = 0.2;
const FAR = 50;

export function clampCamera(camera: Camera): Camera {
  return {
    yaw: camera.yaw,
    pitch: Math.max(-CAMERA_LIMITS.pitch, Math.min(CAMERA_LIMITS.pitch, camera.pitch)),
    distance: Math.max(CAMERA_LIMITS.distanceMin, Math.min(CAMERA_LIMITS.distanceMax, camera.distance)),
  };
}

function mul(a: Float32Array, b: Float32Array): Float32Array {
  const c = new Float32Array(16);
  for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++) for (let k = 0; k < 4; k++) c[4 * col + row]! += a[4 * k + row]! * b[4 * col + k]!;
  return c;
}

function perspective(fov: number, aspect: number, near: number, far: number): Float32Array {
  const s = 1 / Math.tan(fov / 2);
  return new Float32Array([s / aspect, 0, 0, 0, 0, s, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0]);
}

const rotY = (a: number) => new Float32Array([Math.cos(a), 0, -Math.sin(a), 0, 0, 1, 0, 0, Math.sin(a), 0, Math.cos(a), 0, 0, 0, 0, 1]);
const rotX = (a: number) => new Float32Array([1, 0, 0, 0, 0, Math.cos(a), Math.sin(a), 0, 0, -Math.sin(a), Math.cos(a), 0, 0, 0, 0, 1]);
const translation = (x: number, y: number, z: number) => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);

/** Column-major MVP: perspective x translate(0,0,-distance) x rotX(pitch) x rotY(yaw). The WebGL shader consumes this matrix as is. */
export function cameraMatrix(camera: Camera, aspect: number): Float32Array {
  return mul(perspective(FOV, aspect, NEAR, FAR), mul(translation(0, 0, -camera.distance), mul(rotX(camera.pitch), rotY(camera.yaw))));
}

/** Screen position (CSS px) and normalised depth, or null when the point is behind the camera. */
export function projectPoint(m: Float32Array, x: number, y: number, z: number, width: number, height: number): [number, number, number] | null {
  const w = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;
  if (!(w > 0)) return null;
  const cx = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
  const cy = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
  const cz = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
  return [(cx / w * 0.5 + 0.5) * width, (0.5 - cy / w * 0.5) * height, cz / w];
}

export type ProjectedNode = { index: number; id: string; kind: WorldKind; layer: number; x: number; y: number; depth: number; r: number };
export type ProjectedEdge = { a: string; b: string; relation: string; x1: number; y1: number; x2: number; y2: number };
export type ProjectedPlane = { layer: number; points: readonly (readonly [number, number])[] };
export type ProjectedWorld = { width: number; height: number; nodes: ProjectedNode[]; edges: ProjectedEdge[]; planes: ProjectedPlane[] };

/** Nodes only: what picking needs, recomputed per pointer-up so a renderer never has to expose its matrix. */
export function projectLayout(layout: WorldLayout, camera: Camera, width: number, height: number): ProjectedNode[] {
  const m = cameraMatrix(camera, width / height);
  const out: ProjectedNode[] = [];
  layout.nodes.forEach((node, index) => {
    const p = projectPoint(m, node.x, node.y, node.z, width, height);
    if (p) out.push({ index, id: node.id, kind: node.kind, layer: node.layer, x: p[0], y: p[1], depth: p[2], r: node.r });
  });
  return out;
}

export const STATIC_VIEW = { width: 900, height: 620 } as const;

/**
  The static frame: the default camera at 900 x 620. The static SVG, the Canvas2D first frame and
  the WebGL starting camera all read from this, so the three modes open on the same picture.
*/
export function projectStatic(layout: WorldLayout, options: { width?: number; height?: number; camera?: Camera } = {}): ProjectedWorld {
  const width = options.width ?? STATIC_VIEW.width;
  const height = options.height ?? STATIC_VIEW.height;
  const camera = options.camera ?? DEFAULT_CAMERA;
  const m = cameraMatrix(camera, width / height);
  const nodes = projectLayout(layout, camera, width, height);
  const edges: ProjectedEdge[] = [];
  for (const edge of layout.edges) {
    const A = layout.nodes[edge.ia]!;
    const B = layout.nodes[edge.ib]!;
    const p = projectPoint(m, A.x, A.y, A.z, width, height);
    const q = projectPoint(m, B.x, B.y, B.z, width, height);
    if (p && q) edges.push({ a: edge.a, b: edge.b, relation: edge.relation, x1: p[0], y1: p[1], x2: q[0], y2: q[1] });
  }
  const planes: ProjectedPlane[] = [];
  if (layout.mode === "layers") {
    for (let l = 0; l < WORLD_KINDS.length; l++) {
      const points: [number, number][] = [];
      for (const [x, y, z] of layerPlaneCorners(l)) {
        const p = projectPoint(m, x, y, z, width, height);
        if (p) points.push([p[0], p[1]]);
      }
      planes.push({ layer: l + 1, points });
    }
  }
  return { width, height, nodes, edges, planes };
}

export const PICK_RADIUS_PX = 15;

/** The nearest projected record within `radiusPx` of (x, y), or null. Ties go to the nearer-to-camera record. */
export function pick(nodes: readonly { id: string; x: number; y: number; depth: number }[], x: number, y: number, radiusPx: number = PICK_RADIUS_PX): string | null {
  let best: string | null = null;
  let bestDistance = Infinity;
  let bestDepth = Infinity;
  for (const node of nodes) {
    const d = Math.hypot(node.x - x, node.y - y);
    if (d > radiusPx) continue;
    if (d < bestDistance || (d === bestDistance && node.depth < bestDepth)) {
      best = node.id;
      bestDistance = d;
      bestDepth = node.depth;
    }
  }
  return best;
}

/* ---- layer planes and the vertex mesh both GPU/2D renderers share ---- */

export function layerPlaneCorners(layer: number): [number, number, number][] {
  const x = (layer - 2) * LAYER_X_SPACING;
  return [
    [x, -PLANE_HALF_Y, -PLANE_HALF_Z],
    [x, PLANE_HALF_Y, -PLANE_HALF_Z],
    [x, PLANE_HALF_Y, PLANE_HALF_Z],
    [x, -PLANE_HALF_Y, PLANE_HALF_Z],
  ];
}

/** 8 floats per vertex: x y z r g b a size (stride 32 bytes). Lines have size 1. */
export const VERTEX_FLOATS = 8;

export type WorldMesh = {
  /** One vertex per record. */
  nodes: Float32Array;
  /** Two vertices per relationship. */
  edges: Float32Array;
  /** Two vertices per plane segment (Layers mode only). */
  planes: Float32Array;
};

const EDGE_TEAL = [0.35, 0.77, 0.84, 0.095] as const;
const EDGE_RUST = [0.77, 0.42, 0.31, 0.08] as const;
const EDGE_MUTED = [0.21, 0.44, 0.43, 0.035] as const;
const EDGE_FOCUS = [0.98, 0.66, 0.36, 0.94] as const;
const PLANE_RIM = [0.56, 0.78, 0.74, 0.22] as const;
const PLANE_GRID = [0.4, 0.64, 0.61, 0.07] as const;

/** The target varies edge hue by a hash of the relation name. It is decoration and carries no meaning. */
export function edgeIsTeal(relation: string): boolean {
  return fnv1a(relation || "relation") > 0.55;
}

/** The records that stay lit when `focus` is set: the focus and every record it shares a relationship with. */
export function relatedIds(layout: WorldLayout, focus: string | null): Set<string> {
  const related = new Set<string>(focus ? [focus] : []);
  if (focus) for (const edge of layout.edges) if (edge.a === focus || edge.b === focus) related.add(edge.a).add(edge.b);
  return related;
}

export function buildMesh(layout: WorldLayout, focus: string | null): WorldMesh {
  const related = relatedIds(layout, focus);
  const nodes = new Float32Array(layout.nodes.length * VERTEX_FLOATS);
  layout.nodes.forEach((node, i) => {
    const [r, g, b] = KIND_RGB[node.kind];
    const o = i * VERTEX_FLOATS;
    nodes.set([node.x, node.y, node.z, r, g, b, !focus || related.has(node.id) ? 0.94 : 0.15, node.id === focus ? FOCUS_SIZE : node.r], o);
  });

  const edges = new Float32Array(layout.edges.length * 2 * VERTEX_FLOATS);
  layout.edges.forEach((edge, i) => {
    const A = layout.nodes[edge.ia]!;
    const B = layout.nodes[edge.ib]!;
    const incident = focus !== null && (edge.a === focus || edge.b === focus);
    const c = incident ? EDGE_FOCUS : focus ? EDGE_MUTED : edgeIsTeal(edge.relation) ? EDGE_TEAL : EDGE_RUST;
    edges.set([A.x, A.y, A.z, c[0], c[1], c[2], c[3], 1, B.x, B.y, B.z, c[0], c[1], c[2], c[3], 1], i * 2 * VERTEX_FLOATS);
  });

  const planeVertices: number[] = [];
  const push = (p: readonly number[], c: readonly number[]) => planeVertices.push(p[0]!, p[1]!, p[2]!, c[0]!, c[1]!, c[2]!, c[3]!, 1);
  if (layout.mode === "layers") {
    for (let l = 0; l < WORLD_KINDS.length; l++) {
      const x = (l - 2) * LAYER_X_SPACING;
      const corners = layerPlaneCorners(l);
      for (let i = 0; i < 4; i++) {
        push(corners[i]!, PLANE_RIM);
        push(corners[(i + 1) % 4]!, PLANE_RIM);
      }
      for (let j = 1; j < 5; j++) {
        const a = -PLANE_HALF_Y + (j * 2 * PLANE_HALF_Y) / 5;
        const b = -PLANE_HALF_Z + (j * 2 * PLANE_HALF_Z) / 5;
        push([x, a, -PLANE_HALF_Z], PLANE_GRID);
        push([x, a, PLANE_HALF_Z], PLANE_GRID);
        push([x, -PLANE_HALF_Y, b], PLANE_GRID);
        push([x, PLANE_HALF_Y, b], PLANE_GRID);
      }
    }
  }
  return { nodes, edges, planes: new Float32Array(planeVertices) };
}

/* ---- accessible text ---- */

function sentence(text: string): string {
  const t = text.trim();
  return t === "" ? "" : /[.!?]$/.test(t) ? t : `${t}.`;
}

export function incidentRelationCount(corpus: WorldCorpus, id: string): number {
  let n = 0;
  for (const edge of corpus.edges) if (edge.a === id || edge.b === id) n++;
  return n;
}

/** `null` unless the source URL is https, the only kind the inspector links to. */
export function recordSource(corpus: WorldCorpus, node: CorpusNode): { title: string; date: string; url: string; kind: string } | null {
  const s = corpus.sources[node.source];
  if (!s || !/^https:\/\//.test(s[2])) return null;
  return { title: s[0], date: s[1], url: s[2], kind: s[3] };
}

/** The title (the record label as a sentence) and the rest: what it is, how many relationships it has, where it comes from. */
export function describeParts(node: CorpusNode, corpus: WorldCorpus): { title: string; body: string } {
  const n = incidentRelationCount(corpus, node.id);
  const source = corpus.sources[node.source];
  return {
    title: sentence(node.label),
    body: [
      sentence(`${node.kind} record in ${node.domain}, status ${node.status}`),
      sentence(`${n.toLocaleString("en-US")} ${n === 1 ? "relationship" : "relationships"}`),
      source ? sentence(`Source: ${source[0]}, ${source[1]}`) : "",
      sentence(node.note),
    ]
      .filter(Boolean)
      .join(" "),
  };
}

/** One passage for a screen reader. */
export function describe(node: CorpusNode, corpus: WorldCorpus): string {
  const { title, body } = describeParts(node, corpus);
  return `${title} ${body}`;
}

export function describeOverview(corpus: WorldCorpus, mode: WorldMode): string {
  return `${corpus.nodes.length.toLocaleString("en-US")} records · ${corpus.edges.length.toLocaleString("en-US")} relationships · ${mode === "layers" ? "Grouped by record type" : "Spatial overview"} of the public reference corpus.`;
}

export function kindCounts(corpus: WorldCorpus): { kind: WorldKind; layer: number; count: number }[] {
  return WORLD_KINDS.map((kind, i) => ({ kind, layer: i + 1, count: corpus.nodes.filter((n) => n.kind === kind).length }));
}

/* ---- digest: the same string from every mode, so QA can compare what each one drew ---- */

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Sorted record ids, a blank line, then sorted `a|relation|b` lines. */
export function idsDigestInput(layout: Pick<WorldLayout, "nodes" | "edges">): string {
  const ids = layout.nodes.map((n) => n.id).sort(byCodeUnit);
  const edges = layout.edges.map((e) => `${e.a}|${e.relation}|${e.b}`).sort(byCodeUnit);
  return `${ids.join("\n")}\n\n${edges.join("\n")}`;
}

/** SHA-256 hex of {@link idsDigestInput}; null when `crypto.subtle` is unavailable (insecure context). */
export async function idsDigest(layout: Pick<WorldLayout, "nodes" | "edges">): Promise<string | null> {
  const subtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
  if (!subtle) return null;
  const bytes = await subtle.digest("SHA-256", new TextEncoder().encode(idsDigestInput(layout)));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

/* ---- static SVG ---- */

const escapeXml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
const f1 = (n: number) => (Math.round(n * 10) / 10).toString();
const hex = (c: readonly number[]) => "#" + c.slice(0, 3).map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");

/** The accessible name shared by the static SVG and its `<img>` alt. */
export function worldAltText(corpus: WorldCorpus): string {
  const counts = kindCounts(corpus).map((k) => `${k.count.toLocaleString("en-US")} ${KIND_PLURAL[k.kind]}`).join(", ");
  return `Public reference corpus, rendered as five knowledge layers: ${counts}; ${corpus.edges.length.toLocaleString("en-US")} relationships.`;
}

/** The pre-hydration image and last fallback: Layers mode at the default camera, every record and relationship. */
export function renderStaticSvg(corpus: WorldCorpus, options: { idsSha?: string } = {}): string {
  const layout = layoutWorld(corpus, "layers");
  const view = projectStatic(layout);
  const desc = worldAltText(corpus);
  const teal: string[] = [];
  const rust: string[] = [];
  for (const e of view.edges) {
    const line = `<line x1="${f1(e.x1)}" y1="${f1(e.y1)}" x2="${f1(e.x2)}" y2="${f1(e.y2)}" data-a="${escapeXml(e.a)}" data-b="${escapeXml(e.b)}"/>`;
    (edgeIsTeal(e.relation) ? teal : rust).push(line);
  }
  const circles = [...view.nodes]
    .sort((p, q) => q.depth - p.depth || byCodeUnit(p.id, q.id))
    .map((n) => `<circle cx="${f1(n.x)}" cy="${f1(n.y)}" r="${f1(Math.max(1, n.r * 0.47))}" fill="${KIND_COLORS[n.kind]}" data-id="${escapeXml(n.id)}" data-kind="${n.kind}"/>`);
  const planes = view.planes.map((p) => `<polygon points="${p.points.map((q) => `${f1(q[0])},${f1(q[1])}`).join(" ")}" data-layer="${p.layer}"/>`);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${view.width} ${view.height}" width="${view.width}" height="${view.height}" role="img" aria-labelledby="t d" data-node-count="${view.nodes.length}" data-edge-count="${view.edges.length}"${options.idsSha ? ` data-ids-sha="${options.idsSha}"` : ""}>`,
    `<title id="t">Public reference corpus, rendered as five knowledge layers</title>`,
    `<desc id="d">${escapeXml(desc)}</desc>`,
    `<rect width="${view.width}" height="${view.height}" fill="${WORLD_GROUND}"/>`,
    `<g fill="#163b34" fill-opacity=".12" stroke="#477268" stroke-width=".8">${planes.join("")}</g>`,
    `<g stroke="${hex(EDGE_TEAL)}" stroke-opacity="${EDGE_TEAL[3]}" stroke-width=".65">${teal.join("")}</g>`,
    `<g stroke="${hex(EDGE_RUST)}" stroke-opacity="${EDGE_RUST[3]}" stroke-width=".65">${rust.join("")}</g>`,
    `<g fill-opacity=".94">${circles.join("")}</g>`,
    `</svg>`,
  ].join("\n");
}
