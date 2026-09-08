"use client";

/*
  Act 1 -- WORLD.

  The opening composition and nothing else: no digest, no bbox, no type filters, no diagnostic
  counts (§49). The one number it does print is the honest frame around everything else -- how
  many of the World's objects this composition shows -- because a curated view that does not say
  it is curated is the same mistake as a hairball, made quietly.
*/

import WorldCanvas from "@/components/world-visual/world-canvas";
import ParallelView from "./parallel-view";
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
              {selected.evidenceCount > 0 ? (
                <button type="button" className={styles.openEvidence} onClick={() => onOpen(selected.id)}>
                  Open source evidence
                </button>
              ) : null}
            </>
          ) : null}
        </div>
        {/* `totals`, not `nodes.length`: the payload is bounded, the published number is not. */}
        <p className={styles.worldScope} title="Includes documents, extracted knowledge and evidence nodes.">
          SHOWING {layout.placements.length} OF {model.totals.objects} GRAPH NODES
        </p>
      </div>

      <ParallelView
        model={model}
        layout={layout}
        states={states}
        onSelect={onSelect}
        onOpen={onOpen}
        open={reduced}
      />
    </div>
  );
}
