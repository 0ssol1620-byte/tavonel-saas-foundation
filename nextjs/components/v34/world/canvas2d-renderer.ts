import { buildMesh, cameraMatrix, projectPoint, VERTEX_FLOATS, WORLD_GROUND } from "@/lib/v34/world-geometry";
import type { Camera, WorldLayout, WorldMesh } from "@/lib/v34/world-geometry";
import type { WorldRenderer } from "./renderer-types";

/*
  Canvas2D renderer: the same mesh and the same matrix as WebGL, painted back to front. The compatible
  graphics mode for devices without WebGL, and where the island lands after a lost GL context.
*/

const DPR_CAP = 1.5;

type Buckets = Map<string, number[]>;

const rgba = (arr: Float32Array, i: number) =>
  `rgba(${Math.round(arr[i + 3]! * 255)},${Math.round(arr[i + 4]! * 255)},${Math.round(arr[i + 5]! * 255)},${arr[i + 6]})`;

/** Line vertices grouped by colour, so each colour is one path and one stroke call rather than one per segment. */
function bucket(arr: Float32Array): Buckets {
  const out: Buckets = new Map();
  for (let i = 0; i < arr.length; i += VERTEX_FLOATS * 2) {
    const key = rgba(arr, i);
    const list = out.get(key);
    if (list) list.push(i);
    else out.set(key, [i]);
  }
  return out;
}

/** Throws when the canvas cannot give a 2D context (the island then keeps the static image). */
export function createCanvas2dRenderer(canvas: HTMLCanvasElement): WorldRenderer {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D unavailable");
  let mesh: WorldMesh | null = null;
  let planes: Buckets = new Map();
  let edges: Buckets = new Map();
  let disposed = false;

  const stroke = (arr: Float32Array, groups: Buckets, m: Float32Array, width: number, height: number, lineWidth: number) => {
    ctx.lineWidth = lineWidth;
    for (const [style, offsets] of groups) {
      ctx.strokeStyle = style;
      ctx.beginPath();
      for (const i of offsets) {
        const a = projectPoint(m, arr[i]!, arr[i + 1]!, arr[i + 2]!, width, height);
        const b = projectPoint(m, arr[i + VERTEX_FLOATS]!, arr[i + VERTEX_FLOATS + 1]!, arr[i + VERTEX_FLOATS + 2]!, width, height);
        if (!a || !b) continue;
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
      }
      ctx.stroke();
    }
  };

  return {
    kind: "canvas2d",
    setScene(layout: WorldLayout, focus: string | null) {
      mesh = buildMesh(layout, focus);
      planes = bucket(mesh.planes);
      edges = bucket(mesh.edges);
    },
    draw(camera: Camera) {
      if (disposed || !mesh) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) return;
      const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
      const w = Math.round(rect.width * dpr);
      const h = Math.round(rect.height * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = WORLD_GROUND;
      ctx.fillRect(0, 0, rect.width, rect.height);
      const m = cameraMatrix(camera, rect.width / rect.height);
      stroke(mesh.planes, planes, m, rect.width, rect.height, 0.8);
      stroke(mesh.edges, edges, m, rect.width, rect.height, 0.65);

      const arr = mesh.nodes;
      const points: { x: number; y: number; depth: number; i: number }[] = [];
      for (let i = 0; i < arr.length; i += VERTEX_FLOATS) {
        const p = projectPoint(m, arr[i]!, arr[i + 1]!, arr[i + 2]!, rect.width, rect.height);
        if (p) points.push({ x: p[0], y: p[1], depth: p[2], i });
      }
      points.sort((a, b) => b.depth - a.depth);
      for (const p of points) {
        ctx.fillStyle = rgba(arr, p.i);
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(1, arr[p.i + 7]! * 0.47), 0, Math.PI * 2);
        ctx.fill();
      }
    },
    stats() {
      return { nodes: mesh ? mesh.nodes.length / VERTEX_FLOATS : 0, edges: mesh ? mesh.edges.length / (2 * VERTEX_FLOATS) : 0 };
    },
    dispose() {
      disposed = true;
      mesh = null;
      planes = new Map();
      edges = new Map();
    },
  };
}
