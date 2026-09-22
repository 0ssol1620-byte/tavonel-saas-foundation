import Link from "next/link";
import type { Route } from "next";
import ExploreFrameCanvas from "./explore-frame-canvas";
import styles from "./explore-frame.module.css";
import { EXPLORE_SAMPLE_DIGEST, exploreSampleDocuments, exploreSampleWorld } from "@/lib/explore-sample";
import { boundVisualWorld, layoutVisualWorld, toVisualWorldModel } from "@/lib/visual-world-model";

/*
  Gap #8 (V-8). `/explore`'s World, on the two pages that describe compiling one.

  The audit found one route on this site above about 40% visual and it was three clicks down,
  while the pages that argue for a Compiled World -- the product hub and the category guide --
  were prose beside an empty column. This is not a picture of that route. It is the same compiled
  artifact, the same adapter, the same layout function and the same renderer, bounded and laid
  out here exactly as `app/explore/page.tsx` bounds and lays it out.

  Server-side for the same reason `/explore` is: `lib/explore-sample` pulls `node:crypto` and the
  whole compiler in to produce the World and refuses to load if the result stops matching its
  frozen digest, so the compile happens once at build time and the browser receives the drawn
  composition rather than the machinery. `focus` is what the layout draws -- the derived seven to
  twelve objects, never a hand-picked set -- so the frame follows the corpus.

  The caveat travels with it. `/explore` says what one issuer's clean English filings at a single
  permission level do and do not show, and the gap document is explicit that moving the widget
  does not leave that sentence behind. It is under the frame here, in shorter form, with the link
  to the capability manifest that carries the full version.
*/

const world = toVisualWorldModel(exploreSampleWorld, exploreSampleDocuments);
const layout = layoutVisualWorld(world);
const model = boundVisualWorld(world, layout.placements.map((placement) => placement.id));

const n = (value: number) => value.toLocaleString("en-US");

export default function ExploreFrame({ caption }: { caption: string }) {
  return (
    <div className={styles.frame} role="group" aria-labelledby="explore-frame-title">
      <p className={styles.head}>
        <span id="explore-frame-title">{caption}</span>
        <Link className="link-verify" href={"/explore?act=world" as Route}>Open the full World</Link>
      </p>
      <div className={styles.field}>
        <ExploreFrameCanvas model={model} layout={layout} label={caption} />
      </div>
      <p className={styles.counts}>
        <span>
          {n(layout.placements.length)} of {n(world.totals.objects)} objects drawn ·{" "}
          {n(world.totals.regions)} evidence regions
        </span>
        <span className={styles.digest}>
          {EXPLORE_SAMPLE_DIGEST.replace(/^sha256:/, "sha256 ").slice(0, 18)}…
        </span>
      </p>
      <p className={styles.note}>
        Compiled from Apple&apos;s public SEC filings, so every result can be re-derived. One
        issuer&apos;s clean, English-language filings at a single permission level show the
        mechanism; they are not a claim about a mixed internal corpus or a degraded scan. What
        this read recovers, and what it does not, is in the{" "}
        <Link href="/sources">capability manifest</Link>.
      </p>
    </div>
  );
}
