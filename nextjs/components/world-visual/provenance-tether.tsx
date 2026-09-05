"use client";

/*
  The line between a compiled object and the region it came from.

  A caption saying "this claim is supported by page 1" describes provenance. A line drawn from
  the object to the marked region on the page *is* the provenance, and it is the one moment on
  this page where the product's central promise is visible rather than asserted (§14.1 lists the
  tether as one of the five materials for that reason).

  It has to be measured, because both ends move: the object panel reflows with the label, the
  page reflows with the excerpt, and on a narrow screen the two panels stack so the line runs
  downward instead of across. So this observes the host and redraws on resize -- and draws
  nothing at all when either end is off-screen, which is what happens on a phone showing one
  step of the stacked flow. A tether to an element nobody can see is a decoration.
*/

import { useCallback, useEffect, useState, type RefObject } from "react";
import styles from "./world-visual.module.css";
import { MOTION } from "@/lib/visual-motion";

function tetherPath(from: DOMRect, to: DOMRect, host: DOMRect): string | null {
  if (from.width === 0 || to.width === 0) return null;
  const fromRight = from.right - host.left;
  const fromCy = from.top + from.height / 2 - host.top;
  const fromCx = from.left + from.width / 2 - host.left;
  const fromBottom = from.bottom - host.top;
  const toLeft = to.left - host.left;
  const toCy = to.top + to.height / 2 - host.top;
  const toCx = to.left + to.width / 2 - host.left;
  const toTop = to.top - host.top;

  if (toLeft >= fromRight - 4) {
    const mid = (fromRight + toLeft) / 2;
    return `M ${fromRight} ${fromCy} C ${mid} ${fromCy}, ${mid} ${toCy}, ${toLeft} ${toCy}`;
  }
  if (toTop >= fromBottom - 4) {
    const mid = (fromBottom + toTop) / 2;
    return `M ${fromCx} ${fromBottom} C ${fromCx} ${mid}, ${toCx} ${mid}, ${toCx} ${toTop}`;
  }
  return null;
}

export default function ProvenanceTether({
  hostRef,
  from,
  to,
  activeKey,
  reduced,
}: {
  hostRef: RefObject<HTMLElement | null>;
  from: string;
  to: string;
  activeKey: string;
  reduced: boolean;
}) {
  const [path, setPath] = useState<string | null>(null);
  const [drawn, setDrawn] = useState(reduced);

  const measure = useCallback(() => {
    const host = hostRef.current;
    const start = host?.querySelector(from);
    const end = host?.querySelector(to);
    if (!host || !start || !end) {
      setPath(null);
      return;
    }
    setPath(tetherPath(start.getBoundingClientRect(), end.getBoundingClientRect(), host.getBoundingClientRect()));
  }, [from, hostRef, to]);

  useEffect(() => {
    measure();
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(host);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [hostRef, measure, activeKey]);

  useEffect(() => {
    if (reduced) {
      setDrawn(true);
      return;
    }
    setDrawn(false);
    const frame = window.requestAnimationFrame(() => setDrawn(true));
    return () => window.cancelAnimationFrame(frame);
  }, [activeKey, reduced]);

  if (!path) return null;
  return (
    <svg className={styles.tether} aria-hidden="true" data-drawn={drawn ? "1" : "0"}>
      <path
        d={path}
        pathLength={1}
        style={{ transitionDuration: `${reduced ? 0 : MOTION.tether.ms}ms` }}
      />
    </svg>
  );
}
