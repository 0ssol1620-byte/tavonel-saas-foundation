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
import { useNarrowStage, useReducedMotion } from "@/components/world-visual/use-stage-media";
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
  const [drawn, setDrawn] = useState(PROGRESSIVE_THRESHOLD);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; view: typeof view } | null>(null);

  /*
    Which reading arrives first (§20, program §36).

    The table was always here and always started closed, which made the accessible reading of
    this World something a reader had to know to ask for. Two readers should not have to: on a
    phone a pan-and-zoom scatter plot beside an inspector is not a usable composition at all, and
    a reader who asked for reduced motion has asked for the still reading of everything on the
    page. Both get the table on arrival, and either can switch to the picture.

    `tableChoice` is the reader's own decision and outranks both. Null means "nobody has said",
    which is the state the environment is allowed to answer. Same breakpoint and same media hooks
    as the public Explore stage, so one narrow-stage rule serves both World surfaces.
  */
  const narrow = useNarrowStage();
  const reduced = useReducedMotion();
  const [tableChoice, setTableChoice] = useState<boolean | null>(null);
  const asTable = tableChoice ?? (narrow || reduced);

  const availablePredicates = useMemo(
    () => [...new Set(layout.edges.map((edge) => edge.predicate))].sort(),
    [layout.edges],
  );
  const filtered = useMemo(() => filterGraph(layout, { query, types, predicates }), [layout, query, types, predicates]);
  const labelById = useMemo(() => new Map(layout.nodes.map((node) => [node.id, node.label] as const)), [layout.nodes]);
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

  /*
    Keyboard navigation through the picture (§20, program §36).

    Until now the only way to reach a node was to click a circle, which left the graph reachable
    by mouse alone. One tab stop rather than one per node -- a compiled World can hold thousands
    of circles and a thousand tab stops is not navigation -- so the roving `tabIndex` follows the
    selection, and the arrow keys move to the nearest node in the direction pressed.

    Nearest *in the direction*, not next in the array: the layout is spatial (see
    `world-graph-layout.ts`), so array order would send the focus ring jumping across the canvas.
    The dominant-axis test is what keeps ArrowRight from picking a node that is mostly above.
  */
  const nodeRefs = useRef(new Map<string, SVGGElement>());
  const rovingId = selectedObjectId && visibleIds.has(selectedObjectId)
    ? selectedObjectId
    : visibleNodes[0]?.id ?? null;

  const move = (fromId: string, dx: number, dy: number) => {
    const from = visibleNodes.find((node) => node.id === fromId);
    if (!from) return;
    let best: { id: string; distance: number } | null = null;
    for (const node of visibleNodes) {
      if (node.id === fromId) continue;
      const deltaX = node.x - from.x;
      const deltaY = node.y - from.y;
      // The step has to be in the pressed direction, and that direction has to be the larger of
      // the two, or "right" would happily walk diagonally up the canvas.
      const along = deltaX * dx + deltaY * dy;
      if (along <= 0) continue;
      const across = Math.abs(deltaX * dy + deltaY * dx);
      if (across > along) continue;
      const distance = Math.hypot(deltaX, deltaY);
      if (!best || distance < best.distance) best = { id: node.id, distance };
    }
    if (!best) return;
    onObjectSelect(best.id);
    nodeRefs.current.get(best.id)?.focus();
  };

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
          <button type="button" aria-pressed={asTable} onClick={() => setTableChoice(!asTable)}>
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
                      {filtered.edges.filter((edge) => edge.from === node.id || edge.to === node.id).map((edge) => {
                        // The relation in words and the other end by its label. `mentions_entity
                        // → object-7f3a` names a relationship nobody can read; the predicate is
                        // already a sentence and the graph already knows what it points at.
                        const otherId = edge.from === node.id ? edge.to : edge.from;
                        return (
                          <li key={edge.id}>
                            <button type="button" onClick={() => openEdgeEvidence(edge)}>
                              {edge.predicate.replaceAll("_", " ")} → {labelById.get(otherId) ?? otherId} ({edge.evidenceRefs.length} evidence)
                            </button>
                          </li>
                        );
                      })}
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
          role="group"
          aria-label={`Compiled world graph: ${filtered.nodes.length} objects in ${layout.clusters} clusters. Tab into the graph and use the arrow keys to move between objects, or switch to the table view for the same World as a listing.`}
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
                <title>{`${edge.predicate.replaceAll("_", " ")} · ${edge.evidenceRefs.length} evidence`}</title>
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
                roving={node.id === rovingId}
                onSelect={onObjectSelect}
                onMove={move}
                register={(id, element) => {
                  if (element) nodeRefs.current.set(id, element);
                  else nodeRefs.current.delete(id);
                }}
              />
            ))}
          </g>
        </svg>
      )}
    </div>
  );
}

function GraphCircle({ node, selected, matched, dimmed, roving, onSelect, onMove, register }: {
  node: GraphNode;
  selected: boolean;
  matched: boolean;
  dimmed: boolean;
  /** The one node in the picture that is a tab stop. See the roving note in the canvas. */
  roving: boolean;
  onSelect: (id: string) => void;
  onMove: (fromId: string, dx: number, dy: number) => void;
  register: (id: string, element: SVGGElement | null) => void;
}) {
  // The relation count is said in words as well as drawn, because the picture reports it as a
  // radius and nothing else on this surface says it out loud.
  const description = `${node.label} · ${node.type} · ${node.evidenceCount} evidence · ${node.relationCount} relations`;
  return (
    <g
      ref={(element) => { register(node.id, element); }}
      className={styles.node}
      role="button"
      aria-label={description}
      aria-pressed={selected}
      tabIndex={roving ? 0 : -1}
      data-node-id={node.id}
      data-type={node.type}
      data-selected={selected}
      data-matched={matched}
      data-dimmed={dimmed}
      transform={`translate(${node.x} ${node.y})`}
      onClick={() => onSelect(node.id)}
      // Focus selects, so the inspector beside the graph follows the keyboard the same way it
      // follows the pointer. Arrow keys walk the composition; Enter and Space are what a
      // role="button" is required to answer to.
      onFocus={() => onSelect(node.id)}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") { event.preventDefault(); onMove(node.id, -1, 0); }
        else if (event.key === "ArrowRight") { event.preventDefault(); onMove(node.id, 1, 0); }
        else if (event.key === "ArrowUp") { event.preventDefault(); onMove(node.id, 0, -1); }
        else if (event.key === "ArrowDown") { event.preventDefault(); onMove(node.id, 0, 1); }
        else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(node.id); }
      }}
    >
      <circle r={node.radius} />
      <title>{description}</title>
      {/* Labels only where they can be read. A thousand overlapping strings is noise, and the
          table view is where every label is legible anyway. */}
      {node.radius > 11 || selected || matched ? (
        <text x={node.radius + 4} y={4}>{node.label.slice(0, 28)}</text>
      ) : null}
    </g>
  );
}
