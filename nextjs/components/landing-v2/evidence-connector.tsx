"use client";

import { useEffect, useRef, useState } from "react";

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
