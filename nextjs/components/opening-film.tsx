"use client";

/**
 * The whole argument, in sixteen seconds, with nothing to read for the first three.
 *
 * The landing page makes this case across five scenes and a scroll. That works for someone who
 * has decided to spend a minute; it does nothing for someone deciding whether to spend ten
 * seconds, and it cannot be sent to anybody. This is the same case, compressed to the point
 * where it can be watched instead of read.
 *
 * It is drawn, not recorded. Every node, every edge and every count comes from
 * `buildWorldGraph` and `lib/demo-world` -- the same functions the page itself draws from, with
 * the same seed -- so the film cannot drift away from what the product page claims, and it
 * cannot show a cascade the real graph would not produce. A rendered film would be a recording
 * of a thing we once made; this is the thing, running.
 *
 * The wavefront is the reason the film exists. Reading "we rebuild only what the change
 * reached" is a claim. Watching three points light, push outward through four areas, and stop
 * -- with three-quarters of the world visibly untouched behind it -- is the claim demonstrating
 * itself, and it takes about four seconds.
 *
 * Under reduced motion nothing animates: the last frame is painted once, with the final title,
 * which is the honest still of the same argument.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AREAS, CHANGE, KEPT, REBUILT, WORLD, n } from "@/lib/demo-world";
import { buildWorldGraph, type WorldGraph } from "@/lib/world-graph";

/* ------------------------------------------------------------------------- the timeline */

/**
 * Act boundaries in seconds. Deliberately uneven: the compile is allowed to take its time, the
 * cascade is the fastest thing in the film because that is what it is like, and the last act
 * holds longer than it needs to so the final number is still on screen when the film loops.
 */
const ACTS = {
  scatterIn: 0,
  compile: 3.0,
  world: 6.2,
  change: 8.6,
  held: 12.4,
  end: 16.0,
} as const;

type Caption = { at: number; until: number; kicker?: string; line: string; sub?: string };

/**
 * What is said, and when. Six captions in sixteen seconds, none of them jargon.
 *
 * The numbers are interpolated from the same module the page prints them from, so a change to
 * the fixture rewrites the film's dialogue rather than leaving it contradicting the page.
 */
const CAPTIONS: Caption[] = [
  { at: 0.9, until: 2.9, line: "Your knowledge is everywhere." },
  { at: 3.4, until: 6.0, line: "Compile it." },
  {
    at: 6.5, until: 8.4,
    kicker: "ONE WORLD",
    line: `${n(WORLD.facts)} facts`,
    sub: "Every one of them pointing back at the line it came from.",
  },
  {
    at: 9.0, until: 12.2,
    kicker: "SOMETHING CHANGES",
    line: `${CHANGE.changed} lines moved`,
    sub: `${REBUILT} facts rebuilt. ${n(KEPT)} proven untouched, and left alone.`,
  },
  {
    at: 12.8, until: 15.2,
    kicker: "AND ONE DID NOT",
    line: "One fact had two readings",
    sub: "So it was held back for a person, not averaged into a confident sentence.",
  },
  // The end card has no `until`: a film that ends on black has thrown away the one frame a
  // viewer is most likely to still be looking at when they decide what to do next.
  { at: 15.2, until: Number.POSITIVE_INFINITY, line: "TAVONEL", sub: "The knowledge compiler." },
];

const INK = {
  kept: "105,114,120",
  changed: "242,166,90",
  affected: "123,224,190",
  held: "110,147,184",
  edge: "46,53,59",
  label: "104,116,124",
} as const;

/** Cubic in-out: the only easing in the film, so every move feels like the same hand. */
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** Progress through a window, eased. 0 before it, 1 after it. */
const through = (time: number, from: number, to: number) => ease(clamp01((time - from) / (to - from)));

export default function OpeningFilm({ onEnded }: { onEnded?: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(true);
  const startRef = useRef<number>(0);
  const reducedRef = useRef(false);

  const replay = useCallback(() => {
    startRef.current = 0;
    setTime(0);
    setPlaying(true);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    reducedRef.current = reduced;

    let graph: WorldGraph | null = null;
    let scattered: { x: number; y: number }[] = [];
    let width = 0;
    let height = 0;
    let frame = 0;

    const layout = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);

      // A fixed budget rather than one scaled to the viewport: this is a film, and the same
      // frame has to come out of a phone, a laptop and a 1920 capture.
      graph = buildWorldGraph(620);
      scattered = graph.nodes.map((_, index) => {
        const a = Math.sin(index * 12.9898) * 43758.5453;
        const b = Math.sin(index * 78.233) * 12345.6789;
        return { x: (a - Math.floor(a)) * width, y: (b - Math.floor(b)) * height };
      });
    };

    /**
     * How far the cascade has travelled, as a fractional depth.
     *
     * A node lights when the wavefront passes its own depth, so the levels arrive in order and
     * the last one lands a beat after the first. This is the single most load-bearing number in
     * the film: it is what makes "only what the change reached" visible rather than asserted.
     */
    const frontAt = (t: number) => {
      if (t < ACTS.change) return -1;
      const span = ACTS.held - ACTS.change - 0.5;
      return clamp01((t - ACTS.change) / span) * (CHANGE.levels.length + 0.6);
    };

    const draw = (t: number) => {
      if (!graph) return;
      const form = through(t, ACTS.scatterIn + 0.4, ACTS.compile + 2.4);
      const edgeAlpha = through(t, ACTS.compile + 0.9, ACTS.world);
      const labels = through(t, ACTS.world - 0.4, ACTS.world + 1.2);
      const front = frontAt(t);
      // The last act desaturates everything that is not the held fact, so the eye has one place
      // to go at the moment the film makes its least obvious point.
      const focus = through(t, ACTS.held, ACTS.held + 0.9);

      context.clearRect(0, 0, width, height);

      const at = (index: number) => {
        const node = graph!.nodes[index];
        const start = scattered[index];
        return {
          x: start.x + (node.x * width - start.x) * form,
          y: start.y + (node.y * height - start.y) * form,
        };
      };

      /** 0 before the wavefront reaches this node, 1 once it has fully arrived. */
      const lit = (depth: number) => (depth < 0 ? 0 : clamp01(front - depth));

      /* -- edges ------------------------------------------------------------------- */
      if (edgeAlpha > 0.01) {
        context.lineWidth = 1;
        for (const [a, b] of graph.edges) {
          const na = graph.nodes[a];
          const nb = graph.nodes[b];
          const pa = at(a);
          const pb = at(b);
          // An edge carries the cascade only if both ends are in it: a half-lit edge would
          // imply the change travelled somewhere it did not.
          const carry = Math.min(lit(na.depth), lit(nb.depth));
          if (carry > 0.02) {
            context.strokeStyle = `rgba(${INK.affected},${(0.30 * carry * (1 - focus * 0.55)).toFixed(3)})`;
          } else {
            context.strokeStyle = `rgba(${INK.edge},${(0.62 * edgeAlpha * (1 - focus * 0.4)).toFixed(3)})`;
          }
          context.beginPath();
          context.moveTo(pa.x, pa.y);
          context.lineTo(pb.x, pb.y);
          context.stroke();
        }
      }

      /* -- nodes ------------------------------------------------------------------- */
      for (let i = 0; i < graph.nodes.length; i += 1) {
        const node = graph.nodes[i];
        const point = at(i);
        const carry = lit(node.depth);
        const isHeld = node.state === "held";

        let ink: string = INK.kept;
        let alpha = 0.20 + 0.30 * form;
        let radius = node.radius;

        if (carry > 0.02) {
          ink = node.state === "changed" ? INK.changed : INK.affected;
          alpha = 0.35 + 0.55 * carry;
          // A brief overshoot as the front passes, so a node arriving reads as an event.
          radius = node.radius * (1.4 + 1.5 * carry * (1 - carry) * 4);
        }
        if (isHeld && t > ACTS.held) {
          const pulse = 0.5 + 0.5 * Math.sin((t - ACTS.held) * 4.2);
          ink = INK.held;
          alpha = 0.75 + 0.25 * pulse;
          // An absolute size, not a multiple of its own. The held node is whichever unclaimed
          // node the graph happened to pick, so its base radius is a lottery -- and the film's
          // climax cannot be a 3px dot because the draw came out small.
          radius = 6.5 + 2.2 * pulse;
          // A ring that keeps expanding away from it. One fact out of 128,470 has to be findable
          // on a frame with six hundred other dots on it, and a slightly bigger dot is not.
          const ripple = ((t - ACTS.held) % 1.6) / 1.6;
          context.strokeStyle = `rgba(${INK.held},${(0.8 * (1 - ripple)).toFixed(3)})`;
          context.lineWidth = 1.2;
          context.beginPath();
          context.arc(point.x, point.y, 6 + ripple * 34, 0, Math.PI * 2);
          context.stroke();
        } else if (focus > 0 && carry <= 0.02) {
          alpha *= 1 - focus * 0.6;
        }

        if (carry > 0.02 || (isHeld && t > ACTS.held)) {
          context.shadowBlur = (isHeld ? 20 : 12 * carry);
          context.shadowColor = `rgba(${ink},0.5)`;
        }
        context.fillStyle = `rgba(${ink},${alpha.toFixed(3)})`;
        context.beginPath();
        context.arc(point.x, point.y, radius, 0, Math.PI * 2);
        context.fill();
        context.shadowBlur = 0;
      }

      /* -- area labels ------------------------------------------------------------- */
      if (labels > 0.03) {
        context.font = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace';
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
          const reached = graph!.reachByArea[area] > 0 && front > 0;
          const alpha = 0.85 * labels * (reached ? 1 : 1 - focus * 0.5);
          context.fillStyle = reached
            ? `rgba(${INK.affected},${(alpha * 0.9).toFixed(3)})`
            : `rgba(${INK.label},${alpha.toFixed(3)})`;
          context.fillText(
            AREAS[area]?.name ?? "",
            x / members.length,
            y / members.length - 14,
          );
        });
      }
    };

    layout();

    if (reduced) {
      draw(ACTS.end - 0.2);
      setTime(ACTS.end - 0.2);
      setPlaying(false);
      const onResize = () => { layout(); draw(ACTS.end - 0.2); };
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    }

    const tick = (now: number) => {
      if (!startRef.current) startRef.current = now;
      const t = (now - startRef.current) / 1000;
      draw(t);
      setTime(t);
      if (t < ACTS.end) {
        frame = window.requestAnimationFrame(tick);
      } else {
        setPlaying(false);
        onEnded?.();
      }
    };
    frame = window.requestAnimationFrame(tick);

    const onResize = () => layout();
    window.addEventListener("resize", onResize);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
    };
    // `playing` is the replay trigger: a change to it restarts the whole effect.
  }, [playing, onEnded]);

  const caption = CAPTIONS.find((item) => time >= item.at && time < item.until)
    ?? (reducedRef.current ? CAPTIONS[CAPTIONS.length - 1] : undefined);

  return (
    <div className="film">
      <canvas ref={canvasRef} className="film-canvas" aria-hidden="true" />

      {/*
        Captions are DOM, not canvas. Canvas text is a bitmap: it will not hint, will not respect
        the reader's font settings, cannot be selected and cannot be read out. Everything said
        in this film is a real paragraph sitting over the drawing.
      */}
      <div className="film-caption" aria-live="polite">
        {caption ? (
          <div key={caption.line} className="film-caption-in">
            {caption.kicker ? <p className="film-kicker">{caption.kicker}</p> : null}
            <p className="film-line">{caption.line}</p>
            {caption.sub ? <p className="film-sub">{caption.sub}</p> : null}
          </div>
        ) : null}
      </div>

      {/* The progress of the film, and the only two controls it needs. */}
      <div className="film-bar">
        <span className="film-meter" aria-hidden="true">
          <i style={{ width: `${Math.min(100, (time / ACTS.end) * 100)}%` }} />
        </span>
        {!playing ? (
          <button type="button" className="film-btn" onClick={replay}>Replay</button>
        ) : null}
      </div>
    </div>
  );
}
