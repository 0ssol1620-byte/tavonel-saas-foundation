"use client";

/**
 * The persistent canvas world behind every scene.
 *
 * It is one field for the whole page, not a per-section graphic: scenes change its *mode* and
 * it animates between states, which is what makes a long scroll read as one continuous system
 * rather than a stack of sections. The graph itself -- clusters, bridges, wavefront -- comes
 * from `lib/world-graph`, where its claims are tested.
 *
 * Motion law (SPEC 7.1): it moves only when reality, understanding or control changes. There is
 * no idle drift and no ambient loop; between mode changes the field is completely still, and
 * under `prefers-reduced-motion` it paints each mode once with no transition at all.
 *
 * D9 -- attention is a real state, so the field is allowed to report it.
 * Nobody being at the keyboard is not "nothing changing" -- it is a fact about the world exactly
 * like the mode is, so when the tab is hidden or the pointer has not moved in a while the whole
 * field settles to a lower luminance and holds there. This is one eased transition into a state
 * and one back out, not a loop: it does not breathe, pulse or drift once it arrives.
 */

import { useEffect, useRef } from "react";
import { AREAS } from "@/lib/demo-world";
import { type WorldGraph, buildWorldGraph, nodeBudget } from "@/lib/world-graph";

export type WorldMode =
  | "scatter"
  | "ingest"
  | "structure"
  | "current"
  | "change"
  | "recompile"
  | "verify"
  | "answer";

/** How far each mode has pulled the field together, and how much of it is lit. */
const MODE: Record<WorldMode, { form: number; edges: number; labels: number; reveal: number }> = {
  scatter: { form: 0, edges: 0, labels: 0, reveal: 0 },
  ingest: { form: 0.35, edges: 0.12, labels: 0, reveal: 0 },
  structure: { form: 1, edges: 0.42, labels: 0.7, reveal: 0 },
  current: { form: 1, edges: 0.45, labels: 0.9, reveal: 0 },
  change: { form: 1, edges: 0.45, labels: 0.9, reveal: 0.15 },
  recompile: { form: 1, edges: 0.6, labels: 0.9, reveal: 1 },
  verify: { form: 1, edges: 0.5, labels: 0.9, reveal: 1 },
  answer: { form: 1, edges: 0.34, labels: 0.6, reveal: 1 },
};

const INK = {
  kept: "rgba(105,114,120,",
  changed: "rgba(242,166,90,",
  affected: "rgba(123,224,190,",
  held: "rgba(110,147,184,",
  edge: "rgba(46,53,59,",
  label: "rgba(76,86,92,",
} as const;

export default function WorldField({ mode }: { mode: WorldMode }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const modeRef = useRef<WorldMode>(mode);
  modeRef.current = mode;

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let graph: WorldGraph | null = null;
    let scattered: { x: number; y: number }[] = [];
    let width = 0;
    let height = 0;
    let frame = 0;
    // Every animated quantity is eased toward its target rather than set, so a mode change
    // that lands mid-transition resolves smoothly instead of snapping.
    const current = { form: 0, edges: 0, labels: 0, reveal: 0, idle: 1 };

    /* D9 -- idle is attention, not a timer for its own sake: hidden is instant, unattended
       pointer/scroll/keys takes IDLE_MS before the field agrees nobody is watching. */
    const IDLE_MS = 45_000;
    const IDLE_DIM = 0.42;
    let lastActive = performance.now();
    const markActive = () => { lastActive = performance.now(); };
    const activityEvents: (keyof WindowEventMap)[] = ["pointermove", "pointerdown", "keydown", "wheel", "touchstart"];
    activityEvents.forEach((name) => window.addEventListener(name, markActive, { passive: true }));
    window.addEventListener("scroll", markActive, { passive: true, capture: true });

    const layout = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);

      graph = buildWorldGraph(nodeBudget(width, height));
      // The scattered start is the same nodes thrown across the frame -- so "compiling" is
      // visibly the *same* material being pulled into shape, not one image replacing another.
      scattered = graph.nodes.map((node, index) => {
        const a = Math.sin(index * 12.9898) * 43758.5453;
        const b = Math.sin(index * 78.233) * 12345.6789;
        return { x: (a - Math.floor(a)) * width, y: (b - Math.floor(b)) * height };
      });
    };

    const draw = () => {
      if (!graph) return;
      const target = MODE[modeRef.current];
      const ease = reduced ? 1 : 0.055;
      for (const key of ["form", "edges", "labels", "reveal"] as const) {
        current[key] += (target[key] - current[key]) * ease;
      }

      const idleTarget = document.hidden || performance.now() - lastActive > IDLE_MS ? IDLE_DIM : 1;
      current.idle += (idleTarget - current.idle) * (reduced ? 1 : 0.02);

      context.clearRect(0, 0, width, height);
      const at = (index: number) => {
        const node = graph!.nodes[index];
        const start = scattered[index];
        const f = current.form;
        return { x: start.x + (node.x * width - start.x) * f, y: start.y + (node.y * height - start.y) * f };
      };

      if (current.edges > 0.01) {
        context.lineWidth = 1;
        for (const [a, b] of graph.edges) {
          const pa = at(a);
          const pb = at(b);
          const lit =
            graph.nodes[a].depth >= 0 && graph.nodes[b].depth >= 0 ? current.reveal : 0;
          context.strokeStyle = lit > 0.05
            ? `${INK.affected}${(0.14 * lit * current.idle).toFixed(3)})`
            : `${INK.edge}${(0.55 * current.edges * current.idle).toFixed(3)})`;
          context.beginPath();
          context.moveTo(pa.x, pa.y);
          context.lineTo(pb.x, pb.y);
          context.stroke();
        }
      }

      for (let i = 0; i < graph.nodes.length; i += 1) {
        const node = graph.nodes[i];
        const point = at(i);
        const revealed = node.depth >= 0 || node.state === "held";
        const ink = revealed && current.reveal > 0.05 ? INK[node.state] : INK.kept;
        const alpha = (revealed && current.reveal > 0.05
          ? 0.30 + 0.55 * current.reveal
          : 0.16 + 0.20 * current.form) * current.idle;
        context.fillStyle = `${ink}${alpha.toFixed(3)})`;
        context.beginPath();
        context.arc(point.x, point.y, node.radius * (revealed ? 1.5 : 1), 0, Math.PI * 2);
        context.fill();
      }

      if (current.labels > 0.03) {
        context.font = '9px var(--f-mono), ui-monospace, monospace';
        context.fillStyle = `${INK.label}${(0.9 * current.labels * current.idle).toFixed(3)})`;
        context.textAlign = "center";
        graph.byArea.forEach((members, area) => {
          if (!members.length) return;
          let x = 0;
          let y = 0;
          for (const index of members) {
            const point = at(index);
            x += point.x;
            y += point.y;
          }
          context.fillText(AREAS[area].name.toUpperCase(), x / members.length, y / members.length - 26);
        });
      }
    };

    const loop = () => {
      draw();
      frame = window.requestAnimationFrame(loop);
    };

    layout();
    if (reduced) {
      // One painted frame per mode change; nothing animates.
      Object.assign(current, MODE[modeRef.current]);
      draw();
    } else {
      loop();
    }

    const onResize = () => {
      layout();
      draw();
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      activityEvents.forEach((name) => window.removeEventListener(name, markActive));
      window.removeEventListener("scroll", markActive, true);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  // Reduced motion never enters the rAF loop, so a mode change has to repaint explicitly.
  useEffect(() => {
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    window.dispatchEvent(new Event("resize"));
  }, [mode]);

  return <canvas ref={canvasRef} className="world-field" aria-hidden="true" />;
}
