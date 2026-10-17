"use client";

import { useEffect, useRef, useState } from "react";
import type { EvidenceLineLabel } from "@/lib/home-evidence-view";

type Connection = { width: number; height: number; ax: number; ay: number; bx: number; by: number };

/** Connect measured endpoints, never an assumed column centre. Content does not depend on this decoration. */
export default function EvidenceConnector({ minWidth = 900 }: { minWidth?: number }) {
  const ref = useRef<SVGSVGElement>(null);
  const [line, setLine] = useState<Connection | null>(null);
  useEffect(() => {
    const pair = ref.current?.closest<HTMLElement>("[data-evidence-pair]");
    const origin = pair?.querySelector<HTMLElement>("[data-evidence-origin]");
    const target = pair?.querySelector<HTMLElement>(".lv2-region");
    if (!pair || !origin || !target) return;
    let frame = 0;
    let disposed = false;
    const measure = () => {
      frame = 0;
      if (disposed) return;
      const p = pair.getBoundingClientRect();
      const a = origin.getBoundingClientRect();
      const b = target.getBoundingClientRect();
      const next = {
        width: p.width, height: p.height,
        ax: a.right - p.left, ay: a.top + a.height / 2 - p.top,
        bx: b.left - p.left, by: b.top + b.height / 2 - p.top,
      };
      const visible = window.innerWidth >= minWidth && p.width > 0 && p.height > 0 &&
        a.width > 0 && b.width > 0 && !pair.closest("[hidden]") &&
        next.bx > next.ax + 8 && next.ax >= 0 && next.bx <= p.width &&
        next.ay >= 0 && next.by >= 0 && next.ay <= p.height && next.by <= p.height;
      setLine(previous => {
        if (!visible) return null;
        if (previous && Object.keys(next).every(key => Math.abs(next[key as keyof Connection] - previous[key as keyof Connection]) < 0.1)) return previous;
        return next;
      });
    };
    const schedule = () => { if (!frame && !disposed) frame = requestAnimationFrame(measure); };
    const resize = new ResizeObserver(schedule);
    [pair, origin, target, target.parentElement].forEach(element => { if (element) resize.observe(element); });
    // A hidden tab can preserve its old dimensions. Observe the visibility owners, not our SVG path.
    const visibility = new MutationObserver(schedule);
    for (let element: HTMLElement | null = pair; element; element = element.parentElement) {
      visibility.observe(element, { attributes: true, attributeFilter: ["hidden", "class", "style"] });
    }
    pair.addEventListener("load", schedule, true);
    window.addEventListener("resize", schedule);
    void document.fonts.ready.then(schedule);
    schedule();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect(); visibility.disconnect();
      pair.removeEventListener("load", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, [minWidth]);
  const middle = line ? line.ax + (line.bx - line.ax) / 2 : 0;
  return (
    <svg ref={ref} className="lv2-evidence-connector" aria-hidden="true" focusable="false"
      data-connected={line ? "true" : "false"} viewBox={line ? [0, 0, line.width, line.height].join(" ") : "0 0 1 1"}>
      {line ? <>
        <path d={`M ${line.ax} ${line.ay} C ${middle} ${line.ay}, ${middle} ${line.by}, ${line.bx} ${line.by}`} />
        <circle cx={line.ax} cy={line.ay} r="2.5" />
        <circle cx={line.bx} cy={line.by} r="2.5" />
      </> : null}
    </svg>
  );
}

/* --------------------------------------------------------- brief move 5: the workbench's line */

type Rect = Pick<DOMRect, "left" | "top" | "right" | "width" | "height">;
export type WorkbenchLine = { ax: number; ay: number; bx: number; by: number; top: number };

/**
 * Where the workbench's Evidence Line runs, relative to `root`: from the left edge of the passage
 * card or region button (`origin`) to the right edge of that region's box on the page, plus the
 * box's top for the label. Null unless the origin sits wholly to the right of the box, which is
 * the side-by-side layout; stacked, a line would have to cross the page it points into.
 */
export function workbenchLineGeometry(root: Rect, origin: Rect, box: Rect): WorkbenchLine | null {
  if (origin.width <= 0 || origin.height <= 0 || box.width <= 0 || box.height <= 0) return null;
  if (origin.left < box.right + 8) return null;
  return {
    ax: origin.left - root.left,
    ay: origin.top + Math.min(origin.height / 2, 28) - root.top,
    bx: box.right - root.left,
    by: box.top + box.height / 2 - root.top,
    top: box.top - root.top,
  };
}

const COBALT = "var(--action, var(--tv-action))";
type LineState = { line: (WorkbenchLine & { id: string }) | null; retired: readonly string[] };

/*
  The Evidence Line (blueprint §4.1, brief move 5) in the Home workbench. Mount it as a direct child
  of the workbench element; it overlays that element and listens to it.

  Hovering or focusing an element marked `data-line-region="<region id>"` (the passage card, the
  A/B/C region buttons) draws one 1px cobalt line from that element to the page box marked
  `data-region-id="<same id>"`, with the region's coordinates at the box's corner. The line exists
  only between a passage and its own coordinates: no region id, no box, or no label, no line.
  The first time a region's line is shown, a plain "page 4 · region A" sits above the coordinates.

  - Motion: the line draws from the passage to the box in 240ms, ease-out, once per new line. With
    `prefers-reduced-motion: reduce` it appears whole, with no transition.
  - Below `minWidth`, or whenever the layout is stacked, nothing is drawn; the workbench prints the
    same label on the passage card instead.
  - Layout: an absolutely positioned, pointer-transparent overlay, so it never moves content (CLS 0).
  - Accessibility: hidden; the region buttons already name each region's page and bbox.
*/
export function WorkbenchEvidenceLine({
  labels,
  minWidth = 900,
}: {
  /** By region id, from `evidenceLineLabel`. */
  labels: Readonly<Record<string, EvidenceLineLabel>>;
  minWidth?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const lineRef = useRef<SVGLineElement>(null);
  const [origin, setOrigin] = useState<HTMLElement | null>(null);
  const [state, setState] = useState<LineState>({ line: null, retired: [] });

  useEffect(() => {
    const bench = ref.current?.parentElement;
    if (!bench) return;
    let hovered: HTMLElement | null = null;
    let focused: HTMLElement | null = null;
    const pick = (target: EventTarget | null) =>
      target instanceof Element ? target.closest<HTMLElement>("[data-line-region]") : null;
    const update = () => setOrigin(hovered ?? focused);
    const over = (event: Event) => { hovered = pick(event.target); update(); };
    const leave = () => { hovered = null; update(); };
    const focusIn = (event: Event) => { focused = pick(event.target); update(); };
    const focusOut = () => { focused = null; update(); };
    bench.addEventListener("pointerover", over);
    bench.addEventListener("pointerleave", leave);
    bench.addEventListener("focusin", focusIn);
    bench.addEventListener("focusout", focusOut);
    return () => {
      bench.removeEventListener("pointerover", over);
      bench.removeEventListener("pointerleave", leave);
      bench.removeEventListener("focusin", focusIn);
      bench.removeEventListener("focusout", focusOut);
    };
  }, []);

  useEffect(() => {
    const root = ref.current;
    const bench = root?.parentElement;
    if (!root || !bench) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      // Read at measure time: a selection change re-points the passage card at another region.
      const id = origin?.dataset.lineRegion ?? "";
      const box = id && labels[id] ? bench.querySelector<HTMLElement>(`[data-region-id="${CSS.escape(id)}"]`) : null;
      const geometry = origin && box && window.matchMedia(`(min-width: ${minWidth}px)`).matches
        ? workbenchLineGeometry(root.getBoundingClientRect(), origin.getBoundingClientRect(), box.getBoundingClientRect())
        : null;
      setState(previous => {
        const line = geometry ? { ...geometry, id } : null;
        const left = previous.line && previous.line.id !== line?.id ? previous.line.id : null;
        const retired = left && !previous.retired.includes(left) ? [...previous.retired, left] : previous.retired;
        const kept = previous.line;
        const same = line !== null && kept !== null && kept.id === line.id &&
          (["ax", "ay", "bx", "by", "top"] as const).every(key => Math.abs(line[key] - kept[key]) < 0.1);
        if (retired === previous.retired && (same || (!line && !kept))) return previous;
        return { line: same ? kept : line, retired };
      });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const resize = new ResizeObserver(schedule);
    resize.observe(bench);
    if (origin) resize.observe(origin);
    const moved = new MutationObserver(schedule);
    if (origin) moved.observe(origin, { attributes: true, attributeFilter: ["data-line-region"] });
    window.addEventListener("resize", schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      moved.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [origin, labels, minWidth]);

  const lineId = state.line?.id ?? null;
  useEffect(() => {
    const line = lineRef.current;
    if (!lineId || !line || typeof line.animate !== "function") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    line.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 240, easing: "ease-out" });
  }, [lineId]);

  const line = state.line;
  const label = line ? labels[line.id] : undefined;
  return (
    <div
      ref={ref}
      aria-hidden="true"
      data-evidence-line={line && label ? line.id : "none"}
      style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 3 }}
    >
      {line && label ? (
        <>
          <svg focusable="false" width="100%" height="100%" style={{ position: "absolute", inset: 0, overflow: "visible" }}>
            <line
              ref={lineRef}
              x1={line.ax}
              y1={line.ay}
              x2={line.bx}
              y2={line.by}
              pathLength={1}
              strokeDasharray="1"
              stroke={COBALT}
              strokeWidth={1}
            />
          </svg>
          <span
            data-derived="1"
            data-evidence-line-label=""
            style={{
              position: "absolute",
              left: line.bx,
              top: line.top - 4,
              transform: "translate(-100%, -100%)",
              padding: "2px 6px",
              border: `1px solid ${COBALT}`,
              background: "var(--home-paper, #faf9f6)",
              color: COBALT,
              font: "500 12px/1.45 var(--home-mono, ui-monospace, monospace)",
              letterSpacing: 0,
              whiteSpace: "nowrap",
            }}
          >
            {state.retired.includes(line.id) ? null : (
              <span style={{ display: "block", font: "500 13px/1.45 var(--f-sans, sans-serif)", color: "var(--home-ink, #15191d)" }}>
                {label.human}
              </span>
            )}
            {label.coordinates}
          </span>
        </>
      ) : null}
    </div>
  );
}
