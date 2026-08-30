"use client";

/**
 * One fact, physically tethered to the region it came from.
 *
 * The compiled-world scene used to print this as a key-value ledger. A ledger describes
 * provenance; a tether is the path. Source region → Payment terms → Contract and Purchase
 * order. Hover or focus a node lights the hairlines that hold it.
 *
 * Declared fictional demonstration data. Reduced motion draws the complete graph rather than
 * a faster animation.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { CHANGE } from "@/lib/demo-world";

type NodeId = "source" | "fact" | "contract" | "po";

interface NodeDef {
  id: NodeId;
  kind: string;
  title: string;
  detail: string;
  tone: "verified" | "changed" | "held" | "unused";
}

const NODES: NodeDef[] = [
  {
    id: "source",
    kind: "Source region",
    title: "Page 7 · lines 14–16",
    detail: `${CHANGE.document} · §3.2 · version ${CHANGE.revisionTo}`,
    tone: "verified",
  },
  {
    id: "fact",
    kind: "Fact",
    title: "Payment terms",
    detail: "Invoices are due 30 days after receipt",
    tone: "verified",
  },
  {
    id: "contract",
    kind: "Entity",
    title: "Contract",
    detail: CHANGE.document,
    tone: "verified",
  },
  {
    id: "po",
    kind: "Entity",
    title: "Purchase order",
    detail: "Purchase order template",
    tone: "verified",
  },
];

const EDGES: [NodeId, NodeId][] = [
  ["source", "fact"],
  ["fact", "contract"],
  ["fact", "po"],
];

function linkPath(from: DOMRect, to: DOMRect, root: DOMRect): string {
  const fromRight = from.right - root.left;
  const fromCx = from.left + from.width / 2 - root.left;
  const fromCy = from.top + from.height / 2 - root.top;
  const fromBottom = from.bottom - root.top;
  const toLeft = to.left - root.left;
  const toCx = to.left + to.width / 2 - root.left;
  const toCy = to.top + to.height / 2 - root.top;
  const toTop = to.top - root.top;

  const clearRight = toLeft >= fromRight - 4;
  if (clearRight) {
    const mid = (fromRight + toLeft) / 2;
    return `M ${fromRight} ${fromCy} C ${mid} ${fromCy}, ${mid} ${toCy}, ${toLeft} ${toCy}`;
  }

  const midY = (fromBottom + toTop) / 2;
  return `M ${fromCx} ${fromBottom} C ${fromCx} ${midY}, ${toCx} ${midY}, ${toCx} ${toTop}`;
}

export default function EvidenceTether({ active = true }: { active?: boolean }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const nodeRefs = useRef<Partial<Record<NodeId, HTMLButtonElement | null>>>({});
  const [paths, setPaths] = useState<Array<{ key: string; d: string; from: NodeId; to: NodeId }>>([]);
  const [hot, setHot] = useState<NodeId | null>(null);
  const [drawn, setDrawn] = useState(false);
  const played = useRef(false);

  const measure = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const rootBox = root.getBoundingClientRect();
    const next: Array<{ key: string; d: string; from: NodeId; to: NodeId }> = [];
    for (const [from, to] of EDGES) {
      const a = nodeRefs.current[from];
      const b = nodeRefs.current[to];
      if (!a || !b) continue;
      next.push({
        key: `${from}-${to}`,
        d: linkPath(a.getBoundingClientRect(), b.getBoundingClientRect(), rootBox),
        from,
        to,
      });
    }
    setPaths(next);
  }, []);

  useLayoutEffect(() => {
    measure();
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(root);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  useEffect(() => {
    if (!active) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDrawn(true);
      return;
    }
    if (!paths.length || played.current) return;
    played.current = true;
    const frame = window.requestAnimationFrame(() => setDrawn(true));
    return () => window.cancelAnimationFrame(frame);
  }, [active, paths.length]);

  const lit = hot !== null;

  return (
    <div className="panel rv">
      <div className="panel-head">
        <span>one fact, and where it came from</span>
        <span className="right">DEMO DATA</span>
      </div>
      <div
        ref={rootRef}
        className="tether"
        data-drawn={drawn ? 1 : 0}
        data-lit={lit ? 1 : 0}
        role="group"
        aria-label="Evidence tether from page 7 lines 14 to 16 through Payment terms to Contract and Purchase order"
        onMouseLeave={() => setHot(null)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHot(null);
        }}
      >
        <svg className="tether-edges" aria-hidden="true">
          {paths.map((path) => {
            const direct = hot === path.from || hot === path.to;
            return (
              <path
                key={path.key}
                className="tether-edge"
                d={path.d}
                pathLength={1}
                data-direct={direct ? 1 : 0}
              />
            );
          })}
        </svg>
        {NODES.map((node) => (
          <button
            key={node.id}
            type="button"
            className="tether-node"
            data-id={node.id}
            data-tone={node.tone}
            data-hot={hot === node.id ? 1 : 0}
            data-lit={lit ? 1 : 0}
            ref={(element) => {
              nodeRefs.current[node.id] = element;
            }}
            onMouseEnter={() => setHot(node.id)}
            onFocus={() => setHot(node.id)}
          >
            <span className="tether-k">
              <i aria-hidden="true" />
              {node.kind}
            </span>
            <b>{node.title}</b>
            <span className="tether-d">{node.detail}</span>
          </button>
        ))}
      </div>
      <p className="tether-cite">
        “Payment is due within 30 days of receipt of a valid invoice, reduced from 45 under
        the previous schedule.”
      </p>
    </div>
  );
}
