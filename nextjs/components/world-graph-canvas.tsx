"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  connectedEdgeIds,
  filterGraph,
  fitViewBox,
  type GraphEdge,
  type GraphNode,
  layoutWorldGraph,
} from "@/lib/world-graph-layout";
import type { WorldObjectType, WorldReadModel } from "@/lib/world-read-model";
import styles from "./world-graph-canvas.module.css";

/*
  The graph, as a graph.

  What stood here was a grid of cards and a numbered list of relations. Both showed real
  compiled data, and neither was a graph: a card grid cannot show that two entities are
  connected through a claim, or that a document's topics form a cluster while another
  document's sit alone. That structure is the entire reason the compiler builds edges.

  Everything drawn below comes from the compiled artifact. Node positions are computed
  arithmetically rather than simulated, so the same World always draws the same picture --
  see `world-graph-layout.ts` for why that matters more here than the organic look would.
*/

const TYPES: readonly WorldObjectType[] = ["Document", "Topic", "Entity", "Claim", "Evidence"];

/*
  Above this, nodes are drawn in slices rather than all at once.

  A compiled World of a few hundred nodes is one paint and needs no help. The ceiling exists
  for the corpus sizes the connectors are meant to bring, where a single synchronous render of
  every circle and line is a locked tab -- the same failure the archive expansion had.
*/
const PROGRESSIVE_THRESHOLD = 400;
const SLICE = 150;

type Props = {
  model: WorldReadModel | null;
  selectedObjectId: string | null;
  onObjectSelect: (objectId: string | null) => void;
  onEvidenceSelect?: (evidenceId: string) => void;
};

export default function WorldGraphCanvas({ model, selectedObjectId, onObjectSelect, onEvidenceSelect }: Props) {
  const layout = useMemo(() => layoutWorldGraph(model), [model]);
  const [query, setQuery] = useState("");
  const [types, setTypes] = useState<ReadonlySet<WorldObjectType>>(new Set());
  const [predicates, setPredicates] = useState<ReadonlySet<string>>(new Set());
  const [view, setView] = useState(() => fitViewBox(layout));
  const [asTable, setAsTable] = useState(false);
  const [drawn, setDrawn] = useState(PROGRESSIVE_THRESHOLD);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; view: typeof view } | null>(null);

  const availablePredicates = useMemo(
    () => [...new Set(layout.edges.map((edge) => edge.predicate))].sort(),
    [layout.edges],
  );
  const filtered = useMemo(() => filterGraph(layout, { query, types, predicates }), [layout, query, types, predicates]);
  const connected = useMemo(() => connectedEdgeIds(filtered.edges, selectedObjectId), [filtered.edges, selectedObjectId]);

  // A new World is a new picture: fit it rather than leaving the previous pan in place.
  useEffect(() => { setView(fitViewBox(layout)); setDrawn(PROGRESSIVE_THRESHOLD); }, [layout]);

  /*
    Grow the drawn slice a frame at a time.

    `requestAnimationFrame` rather than a timer because the point is to yield to paint: the
    customer sees the first four hundred nodes immediately and the rest arrive over the next
    few frames, instead of seeing nothing until all of them are ready.
  */
  useEffect(() => {
    if (drawn >= filtered.nodes.length) return;
    const handle = requestAnimationFrame(() => setDrawn((previous) => previous + SLICE));
    return () => cancelAnimationFrame(handle);
  }, [drawn, filtered.nodes.length]);

  const visibleNodes = filtered.nodes.length > PROGRESSIVE_THRESHOLD ? filtered.nodes.slice(0, drawn) : filtered.nodes;
  const visibleIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes]);
  const visibleEdges = filtered.edges.filter((edge) => visibleIds.has(edge.from) && visibleIds.has(edge.to));

  const zoom = (factor: number) => setView((previous) => {
    const width = Math.max(60, Math.min(40_000, previous.width * factor));
    const height = Math.max(60, Math.min(40_000, previous.height * factor));
    // Zoom about the centre, so the thing being looked at stays where it was.
    return {
      x: previous.x + (previous.width - width) / 2,
      y: previous.y + (previous.height - height) / 2,
      width,
      height,
    };
  });

  const toggle = <T,>(set: ReadonlySet<T>, value: T): ReadonlySet<T> => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value); else next.add(value);
    return next;
  };

  const openEdgeEvidence = (edge: GraphEdge) => {
    const evidenceId = edge.evidenceRefs[0];
    if (evidenceId) onEvidenceSelect?.(evidenceId);
  };

  if (!model || layout.nodes.length === 0) {
    return (
      <section className={styles.empty} role="status">
        <span>READ_NOT_YET</span>
        <h3>No compiled graph to read</h3>
        <p>Compile and validate a collection before its objects and relations can be drawn.</p>
      </section>
    );
  }

  return (
    <div className={styles.canvas}>
      <div className={styles.controls}>
        <label className={styles.search}>
          <span>Search</span>
          <input
            type="search"
            value={query}
            placeholder="Label or id"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <fieldset className={styles.filter}>
          <legend>Types</legend>
          {TYPES.filter((type) => layout.nodes.some((node) => node.type === type)).map((type) => (
            <label key={type}>
              <input
                type="checkbox"
                checked={types.size === 0 || types.has(type)}
                onChange={() => setTypes((previous) => (
                  // An empty set means "everything". Unchecking one from that state has to
                  // start from everything, or the first click would hide the whole graph.
                  previous.size === 0
                    ? new Set(TYPES.filter((candidate) => candidate !== type))
                    : toggle(previous, type)
                ))}
              />
              {type}
            </label>
          ))}
        </fieldset>
        {availablePredicates.length > 0 ? (
          <fieldset className={styles.filter}>
            <legend>Relations</legend>
            {availablePredicates.map((predicate) => (
              <label key={predicate}>
                <input
                  type="checkbox"
                  checked={predicates.size === 0 || predicates.has(predicate)}
                  onChange={() => setPredicates((previous) => (
                    previous.size === 0
                      ? new Set(availablePredicates.filter((candidate) => candidate !== predicate))
                      : toggle(previous, predicate)
                  ))}
                />
                {predicate}
              </label>
            ))}
          </fieldset>
        ) : null}
        <div className={styles.viewControls}>
          <button type="button" onClick={() => zoom(0.8)} aria-label="Zoom in">+</button>
          <button type="button" onClick={() => zoom(1.25)} aria-label="Zoom out">−</button>
          <button type="button" onClick={() => setView(fitViewBox(layout))}>Fit</button>
          <button type="button" aria-pressed={asTable} onClick={() => setAsTable((previous) => !previous)}>
            {asTable ? "Graph" : "Table"}
          </button>
        </div>
      </div>

      <p className={styles.summary}>
        {filtered.nodes.length} objects · {filtered.edges.length} relations · {layout.clusters} cluster
        {layout.clusters === 1 ? "" : "s"}
        {filtered.hiddenNodes > 0 ? ` · ${filtered.hiddenNodes} hidden by filter` : ""}
        {query.trim().length > 0 ? ` · ${filtered.matched.size} match${filtered.matched.size === 1 ? "" : "es"}` : ""}
        {visibleNodes.length < filtered.nodes.length ? ` · drawing ${visibleNodes.length} of ${filtered.nodes.length}` : ""}
      </p>

      {asTable ? (
        /*
          The same graph, as a table.

          Not a fallback and not a degraded mode: an adjacency table answers "what is this
          connected to, and on what evidence" better than a picture does, and it is the only
          form of this view a screen reader can navigate. The toggle is in the controls rather
          than hidden behind a media query because sighted keyboard users want it too.
        */
        <div className={styles.tableWrap}>
          <table className={styles.table} data-sensitive="content">
            <caption>Compiled objects and the relations they participate in</caption>
            <thead>
              <tr><th scope="col">Object</th><th scope="col">Type</th><th scope="col">Evidence</th><th scope="col">Relations</th></tr>
            </thead>
            <tbody>
              {filtered.nodes.map((node) => (
                <tr key={node.id} data-selected={node.id === selectedObjectId}>
                  <th scope="row">
                    <button type="button" onClick={() => onObjectSelect(node.id)}>{node.label}</button>
                  </th>
                  <td>{node.type}</td>
                  <td>{node.evidenceCount}</td>
                  <td>
                    <ul>
                      {filtered.edges.filter((edge) => edge.from === node.id || edge.to === node.id).map((edge) => (
                        <li key={edge.id}>
                          <button type="button" onClick={() => openEdgeEvidence(edge)}>
                            {edge.predicate} → {edge.from === node.id ? edge.to : edge.from} ({edge.evidenceRefs.length} evidence)
                          </button>
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <svg
          ref={svgRef}
          className={styles.svg}
          viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
          role="img"
          aria-label={`Compiled world graph: ${filtered.nodes.length} objects in ${layout.clusters} clusters. Switch to the table view for a navigable listing.`}
          onPointerDown={(event) => {
            dragRef.current = { x: event.clientX, y: event.clientY, view };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current;
            if (!drag || !svgRef.current) return;
            const rect = svgRef.current.getBoundingClientRect();
            // Convert screen pixels to user units, or the drag runs at the wrong speed at every
            // zoom level but one.
            const scaleX = drag.view.width / Math.max(1, rect.width);
            const scaleY = drag.view.height / Math.max(1, rect.height);
            setView({
              ...drag.view,
              x: drag.view.x - (event.clientX - drag.x) * scaleX,
              y: drag.view.y - (event.clientY - drag.y) * scaleY,
            });
          }}
          onPointerUp={(event) => {
            dragRef.current = null;
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onWheel={(event) => zoom(event.deltaY > 0 ? 1.1 : 0.9)}
        >
          <g className={styles.edges}>
            {visibleEdges.map((edge) => (
              <line
                key={edge.id}
                x1={edge.x1}
                y1={edge.y1}
                x2={edge.x2}
                y2={edge.y2}
                className={styles.edge}
                data-connected={connected.has(edge.id)}
                data-evidence={edge.evidenceRefs.length > 0}
                onClick={() => openEdgeEvidence(edge)}
              >
                <title>{`${edge.predicate} · ${edge.evidenceRefs.length} evidence`}</title>
              </line>
            ))}
          </g>
          <g>
            {visibleNodes.map((node) => (
              <GraphCircle
                key={node.id}
                node={node}
                selected={node.id === selectedObjectId}
                matched={filtered.matched.has(node.id)}
                dimmed={filtered.matched.size > 0 && !filtered.matched.has(node.id)}
                onSelect={onObjectSelect}
              />
            ))}
          </g>
        </svg>
      )}
    </div>
  );
}

function GraphCircle({ node, selected, matched, dimmed, onSelect }: {
  node: GraphNode;
  selected: boolean;
  matched: boolean;
  dimmed: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <g
      className={styles.node}
      data-type={node.type}
      data-selected={selected}
      data-matched={matched}
      data-dimmed={dimmed}
      transform={`translate(${node.x} ${node.y})`}
      onClick={() => onSelect(node.id)}
    >
      <circle r={node.radius} />
      <title>{`${node.label} · ${node.type} · ${node.evidenceCount} evidence · ${node.relationCount} relations`}</title>
      {/* Labels only where they can be read. A thousand overlapping strings is noise, and the
          table view is where every label is legible anyway. */}
      {node.radius > 11 || selected || matched ? (
        <text x={node.radius + 4} y={4}>{node.label.slice(0, 28)}</text>
      ) : null}
    </g>
  );
}
