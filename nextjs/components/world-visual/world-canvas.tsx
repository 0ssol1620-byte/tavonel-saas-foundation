"use client";

/*
  The live World renderer.

  DOM and SVG rather than a canvas, on purpose. Every node here is a real `<button>` carrying its
  own label, so it is focusable, announced, hit-tested and measurable by the visual-continuity
  script without a hit-test table or a parallel accessibility tree; the edges are `<path>`s in one
  SVG layer behind them. The layout is computed once by `layoutVisualWorld` (§4.1) in coordinates
  of a 16:10 box, so nothing here measures anything and two devices draw the same composition.

  That also settles the animation budget the cheap way: there is no requestAnimationFrame loop and
  nothing to pause when the tab is hidden, because nothing runs between interactions. Entry is one
  staggered CSS transition into a state; selection is a class change. §58's "no continuous
  animation when idle" is a property of the renderer here, not a rule it has to remember.

  One DOM, two compositions. Above 820px the nodes are absolutely positioned at their layout
  coordinates with the edge layer drawn between them; below it the same buttons lay out as a flow
  in DOM order -- hub, then the claims it carries -- and the edge layer is hidden. A phone gets a
  stacked scene, never a squeezed field.
*/

import { useCallback, useEffect, useMemo, useRef } from "react";
import styles from "./world-visual.module.css";
import { nodeStagger } from "@/lib/visual-motion";
import type { VisualLayout, VisualPlacement, VisualState, VisualWorldModel } from "@/lib/visual-world-model";

type Props = {
  model: VisualWorldModel;
  layout: VisualLayout;
  /** Per-act state for each drawn node; anything absent falls back to the node's compiled state. */
  states: Record<string, VisualState>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  reduced: boolean;
  settled: boolean;
  label: string;
};

const KIND_LABEL: Record<string, string> = {
  Claim: "CLAIM",
  Document: "DOCUMENT",
  Entity: "ENTITY",
  Topic: "TOPIC",
  Evidence: "SOURCE",
};

export default function WorldCanvas({
  model,
  layout,
  states,
  selectedId,
  onSelect,
  onOpen,
  reduced,
  settled,
  label,
}: Props) {
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const nodeById = useMemo(() => new Map(model.nodes.map((node) => [node.id, node] as const)), [model.nodes]);

  /*
    Arrow keys move through the composition the way it looks, not the way the array is ordered.

    Columns are the sources; rows within a column are the claims stacked above and below one.
    Left and right change source, up and down move through that source's claims -- which is also
    exactly what the stacked mobile layout shows, so one key map serves both compositions.
  */
  const columns = useMemo(() => {
    const grouped = new Map<number, VisualPlacement[]>();
    for (const placement of layout.placements) {
      grouped.set(placement.column, [...(grouped.get(placement.column) ?? []), placement]);
    }
    return [...grouped.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([, members]) => [...members].sort((left, right) => left.y - right.y).map((member) => member.id));
  }, [layout.placements]);

  const move = useCallback(
    (id: string, dx: number, dy: number) => {
      const column = columns.findIndex((members) => members.includes(id));
      if (column < 0) return;
      const row = columns[column].indexOf(id);
      const nextColumn = Math.min(Math.max(column + dx, 0), columns.length - 1);
      const members = columns[nextColumn];
      const nextRow = Math.min(Math.max(dx !== 0 ? Math.min(row, members.length - 1) : row + dy, 0), members.length - 1);
      const next = members[nextRow];
      if (!next || next === id) return;
      refs.current.get(next)?.focus();
      onSelect(next);
    },
    [columns, onSelect],
  );

  // A selection made elsewhere -- an Ask citation, a deep link -- has to be reachable by Tab from
  // where the reader is looking, so the roving tabindex follows the selection rather than staying
  // on the first node.
  const rovingId = selectedId && layout.placements.some((placement) => placement.id === selectedId)
    ? selectedId
    : layout.placements[0]?.id;

  useEffect(() => {
    const map = refs.current;
    return () => map.clear();
  }, []);

  return (
    <div
      className={styles.field}
      data-settled={settled ? "1" : "0"}
      data-reduced={reduced ? "1" : "0"}
      role="group"
      aria-label={label}
    >
      <svg
        className={styles.edges}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {layout.edges.map((edge) => {
          const state = states[edge.from] === "dim" || states[edge.to] === "dim"
            ? "dim"
            : states[edge.to] ?? states[edge.from] ?? "candidate";
          const lit = selectedId === edge.from || selectedId === edge.to;
          return (
            <path
              key={edge.id}
              className={styles.edge}
              d={edge.d}
              data-visual-edge=""
              data-edge-id={edge.id}
              data-edge-from={edge.from}
              data-edge-to={edge.to}
              data-edge-state={state}
              data-lit={lit ? "1" : "0"}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </svg>

      {layout.placements.map((placement, index) => {
        const node = nodeById.get(placement.id);
        if (!node) return null;
        const state = states[node.id] ?? node.state;
        const selected = selectedId === node.id;
        return (
          <button
            key={node.id}
            type="button"
            ref={(element) => {
              if (element) refs.current.set(node.id, element);
              else refs.current.delete(node.id);
            }}
            className={styles.node}
            data-visual-node=""
            data-node-id={node.id}
            data-node-kind={node.kind}
            data-node-state={state}
            data-node-role={placement.role}
            data-selected={selected ? "1" : "0"}
            aria-pressed={selected}
            tabIndex={rovingId === node.id ? 0 : -1}
            style={{
              left: `${(placement.x / layout.width) * 100}%`,
              top: `${(placement.y / layout.height) * 100}%`,
              transitionDelay: `${nodeStagger(index, layout.placements.length, reduced)}ms`,
            }}
            onClick={() => {
              onSelect(node.id);
              onOpen(node.id);
            }}
            onFocus={() => onSelect(node.id)}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") { event.preventDefault(); move(node.id, -1, 0); }
              else if (event.key === "ArrowRight") { event.preventDefault(); move(node.id, 1, 0); }
              else if (event.key === "ArrowUp") { event.preventDefault(); move(node.id, 0, -1); }
              else if (event.key === "ArrowDown") { event.preventDefault(); move(node.id, 0, 1); }
            }}
          >
            <span className={styles.nodeKind}>{KIND_LABEL[node.kind] ?? node.kind.toUpperCase()}</span>
            <span className={styles.nodeLabel}>{node.label}</span>
            <span className={styles.nodeMeta}>
              {node.evidenceRefs.length} region{node.evidenceRefs.length === 1 ? "" : "s"}
            </span>
          </button>
        );
      })}
    </div>
  );
}
