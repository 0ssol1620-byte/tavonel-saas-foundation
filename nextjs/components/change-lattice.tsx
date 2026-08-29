"use client";

/**
 * The interlude -- one cell per fact in the handbook, at the hinge between "compile it" and
 * "keep it compiled".
 *
 * An earlier version of this page bought its change of scale with a stock photograph. On a page
 * whose whole argument is that every claim traces back to real evidence, a stock-library credit
 * line is the one element a reader is right to discount. This draws the same composition -- a
 * regular grid, almost entirely dark, a scattered few lit -- except the lit cells are the
 * actual figures the console prints two scenes later.
 */

import { useEffect, useRef } from "react";
import { CHANGE } from "@/lib/demo-world";

const COLS = 62;
const ROWS = 20;
const TOTAL = COLS * ROWS; // 1,240 -- one per fact in the handbook

/** Fixed positions, so the marked cells sit where they were composed to sit. */
const CHANGED = [247, 613, 1102];
const HELD = [884];

export default function ChangeLattice() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const draw = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);

      /*
       * One pitch for both axes, and the block centred in what is left.
       *
       * Stretching each axis to fill gave a horizontal gap of 3px and a vertical gap of 14, and
       * the eye read that as banding rather than as a lattice -- the one thing this drawing has
       * to be. A lattice with unequal spacing is a chart of nothing.
       */
      const pitch = Math.min(width / COLS, height / ROWS);
      const size = Math.max(2, pitch - 3);
      const originX = (width - pitch * COLS) / 2;
      const originY = (height - pitch * ROWS) / 2;

      for (let i = 0; i < TOTAL; i += 1) {
        const x = originX + (i % COLS) * pitch + (pitch - size) / 2;
        const y = originY + Math.floor(i / COLS) * pitch + (pitch - size) / 2;
        if (CHANGED.includes(i)) context.fillStyle = "rgba(242,166,90,0.95)";
        else if (HELD.includes(i)) context.fillStyle = "rgba(110,147,184,0.95)";
        else context.fillStyle = "rgba(105,114,120,0.13)";
        context.fillRect(x, y, size, size);
      }
    };

    draw();
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, []);

  return (
    // The interlude carries scene 03 rather than numbering itself. It has to be observable:
    // with no data-scene at all, a viewport filled entirely by the interlude leaves the scene
    // observer with nothing intersecting, so a deep link or a fast scroll lands here with the
    // bar and rail still reading whatever they said last -- which is scene 01 on a fresh load.
    <div className="interlude" data-scene="3">
      <canvas ref={canvasRef} className="lattice" aria-hidden="true" />
      <div className="interlude-copy">
        <p className="interlude-h">
          Then reality moves,
          <br />
          and most of it doesn&rsquo;t.
        </p>
        <p className="interlude-sub">
          {CHANGE.documentFacts.toLocaleString("en-US")} facts in one handbook
          <span className="sep">&middot;</span>
          <b data-tone="changed">{CHANGE.changed} moved</b>
          <span className="sep">&middot;</span>
          <b data-tone="held">{CHANGE.held} held</b>
          <span className="sep">&middot;</span>
          {(CHANGE.documentFacts - CHANGE.changed - CHANGE.held).toLocaleString("en-US")} untouched
        </p>
      </div>
    </div>
  );
}
