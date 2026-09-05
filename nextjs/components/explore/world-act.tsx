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
        <p className={styles.hint}>{EXPLORE_COPY.worldHint}</p>
        <p className={styles.worldScope}>
          SHOWING {layout.placements.length} OF {model.nodes.length} COMPILED OBJECTS
        </p>
      </div>
    </div>
  );
}
