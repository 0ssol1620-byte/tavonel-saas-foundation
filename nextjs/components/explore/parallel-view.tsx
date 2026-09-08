"use client";

/*
  The composition, read as a list (§20).

  The canvas is already made of real buttons carrying real labels, so this is not a shim for a
  graphic nothing can read. It is the second reading §20 asks for -- every drawn object, every
  relation between drawn objects, and the evidence each one opens on, in DOM order, with no
  geometry to interpret -- and it is the same list in both acts that draw a canvas, because the
  Change act is the one place an object's *state* differs and the canvas reports that state in
  colour alone.

  It doubles as the no-canvas path. Open by default when the reader has asked for reduced motion,
  closed otherwise, and a `<details>` rather than a toggle so the disclosure works with no
  JavaScript at all.

  Nothing here is a clickable `div`: every target is a `<button>`, and the state each object is
  in is printed as a word beside it rather than left to the palette.
*/

import styles from "./explore-stage.module.css";
import type { VisualLayout, VisualState, VisualWorldModel } from "@/lib/visual-world-model";

/** The same vocabulary the Evidence act prints, so one object never has two state words. */
export const STATE_WORD: Record<VisualState, string> = {
  current: "CURRENT",
  candidate: "CANDIDATE",
  changed: "CHANGED",
  affected: "AFFECTED",
  unresolved: "UNRESOLVED",
  dim: "UNCHANGED",
};

export default function ParallelView({
  model,
  layout,
  states,
  onSelect,
  onOpen,
  open,
}: {
  model: VisualWorldModel;
  layout: VisualLayout;
  states: Record<string, VisualState>;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  /** Open on arrival for the reader who asked for stillness, and for the no-canvas path. */
  open: boolean;
}) {
  const drawnIds = new Set(layout.placements.map((placement) => placement.id));
  const nodeById = new Map(model.nodes.map((node) => [node.id, node] as const));
  const drawn = layout.placements
    .map((placement) => nodeById.get(placement.id))
    .filter((node): node is (typeof model.nodes)[number] => Boolean(node));

  return (
    <details className={styles.parallelList} open={open} data-parallel-view="">
      <summary>Objects, relations and evidence as a list</summary>
      <ul>
        {drawn.map((node) => {
          const state = states[node.id] ?? node.state;
          return (
            <li key={node.id}>
              <button type="button" onClick={() => onSelect(node.id)} data-parallel-object={node.id}>
                <small>
                  {node.kind.toUpperCase()} · {STATE_WORD[state]}
                </small>
                <span>{node.label}</span>
              </button>
              <ul>
                {model.edges
                  .filter((edge) =>
                    (edge.from === node.id || edge.to === node.id)
                    && drawnIds.has(edge.from) && drawnIds.has(edge.to))
                  .map((edge) => {
                    const otherId = edge.from === node.id ? edge.to : edge.from;
                    return (
                      <li key={edge.id}>
                        {edge.predicate.replaceAll("_", " ")} ·{" "}
                        {nodeById.get(otherId)?.label ?? otherId}
                      </li>
                    );
                  })}
                {node.evidenceCount > 0 ? (
                  <li>
                    <button type="button" onClick={() => onOpen(node.id)}>
                      Open evidence · {node.evidenceCount} source region
                      {node.evidenceCount === 1 ? "" : "s"}
                    </button>
                  </li>
                ) : null}
              </ul>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
