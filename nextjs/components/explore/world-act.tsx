"use client";

/*
  Act 1 -- WORLD.

  The opening composition and nothing else: no digest, no bbox, no type filters, no diagnostic
  counts (§49). The one number it does print is the honest frame around everything else -- how
  many of the World's objects this composition shows -- because a curated view that does not say
  it is curated is the same mistake as a hairball, made quietly.
*/

import WorldCanvas from "@/components/world-visual/world-canvas";
import styles from "./explore-stage.module.css";
import { EXPLORE_COPY } from "@/lib/explore-story";
import type { VisualLayout, VisualState, VisualWorldModel } from "@/lib/visual-world-model";

export default function WorldAct({
  model,
  layout,
  states,
  selectedId,
  onSelect,
  onOpen,
  reduced,
  settled,
  dimmed = false,
}: {
  model: VisualWorldModel;
  layout: VisualLayout;
  states: Record<string, VisualState>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  reduced: boolean;
  settled: boolean;
  dimmed?: boolean;
}) {
  const selected = selectedId ? model.nodes.find((node) => node.id === selectedId) ?? null : null;
  const relations = selectedId
    ? model.edges
      .filter((edge) => edge.from === selectedId || edge.to === selectedId)
      .map((edge) => {
        const neighborId = edge.from === selectedId ? edge.to : edge.from;
        const neighbor = model.nodes.find((node) => node.id === neighborId);
        return { id: edge.id, predicate: edge.predicate.replaceAll("_", " "), neighbor: neighbor?.label ?? neighborId };
      })
    : [];
  const drawnIds = new Set(layout.placements.map((placement) => placement.id));
  const drawn = layout.placements
    .map((placement) => model.nodes.find((node) => node.id === placement.id))
    .filter((node): node is (typeof model.nodes)[number] => Boolean(node));
  return (
    <div className={styles.worldAct} data-dimmed={dimmed ? "1" : "0"}>
      <WorldCanvas
        model={model}
        layout={layout}
        states={states}
        selectedId={selectedId}
        onSelect={onSelect}
        onOpen={onOpen}
        reduced={reduced}
        settled={settled}
        label="Compiled World, selected objects"
      />
      <div className={styles.worldFoot}>
        <div className={styles.worldFocus}>
          <p className={styles.hint}>{selected ? "DIRECTLY CONNECTED" : EXPLORE_COPY.worldHint}</p>
          {selected ? (
            <>
              <strong>{selected.label}</strong>
              <div className={styles.relationList} aria-label="Direct relations">
                {relations.map((relation) => (
                  <span key={relation.id}><b>{relation.predicate}</b> · {relation.neighbor}</span>
                ))}
              </div>
              {selected.evidenceRefs.length > 0 ? (
                <button type="button" className={styles.openEvidence} onClick={() => onOpen(selected.id)}>
                  Open source evidence
                </button>
              ) : null}
            </>
          ) : null}
        </div>
        <p className={styles.worldScope}>
          SHOWING {layout.placements.length} OF {model.nodes.length} COMPILED OBJECTS
        </p>
      </div>

      {/*
        The same composition, read as a list (§20).

        The canvas is already made of real buttons carrying real labels, so this is not a shim
        for a graphic nothing can read -- it is the second reading §20 asks for: every drawn
        object, every relation between drawn objects, and the evidence each one opens on, in DOM
        order, with no geometry to interpret. It is also the quickest way to answer "what is
        actually in this World" on a phone.

        Closed by default, because the canvas is the default reading, and a `<details>` because a
        disclosure that works without JavaScript is one fewer thing to get wrong.
      */}
      <details className={styles.parallelList}>
        <summary>Objects, relations and evidence as a list</summary>
        <ul>
          {drawn.map((node) => (
            <li key={node.id}>
              <button type="button" onClick={() => onSelect(node.id)} data-parallel-object={node.id}>
                <small>{node.kind.toUpperCase()}</small>
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
                        {model.nodes.find((item) => item.id === otherId)?.label ?? otherId}
                      </li>
                    );
                  })}
                {node.evidenceRefs.length > 0 ? (
                  <li>
                    <button type="button" onClick={() => onOpen(node.id)}>
                      Open evidence · {node.evidenceRefs.length} source region
                      {node.evidenceRefs.length === 1 ? "" : "s"}
                    </button>
                  </li>
                ) : null}
              </ul>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
