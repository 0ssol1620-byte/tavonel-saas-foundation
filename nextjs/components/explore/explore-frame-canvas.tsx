"use client";

import { useState } from "react";
import WorldCanvas from "@/components/world-visual/world-canvas";
import type { VisualLayout, VisualWorldModel } from "@/lib/visual-world-model";

/*
  Gap #8. The Explore composition, on the pages that argue for it.

  `/explore` was the only route on the site above about 40% visual, and it is three clicks down.
  This is the same renderer -- `WorldCanvas`, the same DOM-and-SVG field of real compiled objects
  drawn at the same layout coordinates -- given the selection state the stage would otherwise
  hold, and nothing else. No second graph component was written, because a second one would be an
  illustration of the first.

  Deliberately smaller than the stage in what it does, not in what it shows. It has no acts, no
  Ask overlay, no evidence drawer and no deep-link handling: selecting an object lights its
  neighbourhood, and the way to the rest is the link beside the frame. `settled` is fixed true
  and `reduced` is fixed true, so the entry stagger is zero -- this is a figure inside a reading
  page, and a graph that animates itself in as the reader scrolls past is decoration.
*/
export default function ExploreFrameCanvas({
  model,
  layout,
  label,
}: {
  model: VisualWorldModel;
  layout: VisualLayout;
  label: string;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  return (
    <WorldCanvas
      model={model}
      layout={layout}
      states={{}}
      selectedId={selectedId}
      onSelect={setSelectedId}
      onOpen={setSelectedId}
      reduced
      settled
      label={label}
    />
  );
}
