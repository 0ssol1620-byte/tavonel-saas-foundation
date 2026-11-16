import type { Camera, WorldLayout } from "@/lib/v34/world-geometry";

/** What the island needs from either renderer. Both draw the same mesh from `buildMesh`. */
export type WorldRenderer = {
  readonly kind: "webgl" | "canvas2d";
  /** Replaces the scene (layout and focus) and redraws on the next `draw`. */
  setScene(layout: WorldLayout, focus: string | null): void;
  draw(camera: Camera): void;
  /** What was actually put into the vertex data: records, relationships. Used for the QA data attributes. */
  stats(): { nodes: number; edges: number };
  /** Releases every listener and GL resource. Safe to call twice. */
  dispose(): void;
};

export type RendererOptions = {
  /** WebGL only: the context was lost. The island drops to Canvas2D on a fresh canvas. */
  onContextLost?: () => void;
};
