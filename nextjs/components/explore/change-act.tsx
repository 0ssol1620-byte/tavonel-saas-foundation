"use client";

/*
  Act 3 -- CHANGE.

  The maintenance manual was reissued. One line of it moved, and this act shows what that cost
  the World: which objects the revision reached, which were carried over, and -- the part that
  is easiest to get wrong and most tempting to fake -- what has *not* been established.

  Every figure below arrives as a prop from `lib/explore-change.ts`, which read it out of two
  complete compiles of the same corpus. None of them is written here, and the module that
  produces them refuses to load if either compile's digest moves.

  There is no PASS. Full-rebuild equivalence is a check the compiler core runs over a selective
  rebuild; both sides of this comparison are full compiles, so the act states the comparison it
  actually made and names the one it did not.
*/

import Link from "next/link";
import type { Route } from "next";
import WorldCanvas from "@/components/world-visual/world-canvas";
import PageRegion from "@/components/world-visual/page-region";
import styles from "./explore-stage.module.css";
import { EXPLORE_COPY, type ExploreChangeSide, type ExploreChangeView } from "@/lib/explore-story";
import type { VisualLayout, VisualState, VisualWorldModel } from "@/lib/visual-world-model";

function RevisionCard({ side, tone }: { side: ExploreChangeSide; tone: "before" | "after" }) {
  return (
    <article className={styles.revision} data-tone={tone}>
      <header>
        <b>{side.label.toUpperCase()}</b>
        <span>{side.filename}</span>
      </header>
      <p className={styles.revisionText}>{side.excerpt}</p>
      <PageRegion bbox1000={side.bbox1000} page={side.page} pageCount={side.pageCount} tone="changed" />
      <footer>
        <Link className={styles.sourceLink} href={side.href as Route} target="_blank" rel="noreferrer">
          Open source PDF ↗
        </Link>
      </footer>
    </article>
  );
}

export default function ChangeAct({
  model,
  layout,
  states,
  change,
  selectedId,
  onSelect,
  onOpen,
  reduced,
  settled,
}: {
  model: VisualWorldModel;
  layout: VisualLayout;
  states: Record<string, VisualState>;
  change: ExploreChangeView;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  reduced: boolean;
  settled: boolean;
}) {
  const inFocus = new Set(layout.placements.map((placement) => placement.id));
  const shownAffected = change.affectedNodeIds.filter((id) => inFocus.has(id)).length;
  const shownUntouched = change.untouchedNodeIds.filter((id) => inFocus.has(id)).length;

  return (
    <div className={styles.changeAct}>
      <div className={styles.revisions}>
        <p className={styles.paneLabel}>
          {change.before.label.toUpperCase()} → {change.after.label.toUpperCase()}
        </p>
        <RevisionCard side={change.before} tone="before" />
        <RevisionCard side={change.after} tone="after" />
      </div>

      <div className={styles.changeWorld}>
        <WorldCanvas
          model={model}
          layout={layout}
          states={states}
          selectedId={selectedId}
          onSelect={onSelect}
          onOpen={onOpen}
          reduced={reduced}
          settled={settled}
          label="Compiled World after the revision, with the objects the revision reached"
        />
        <p className={styles.changeCaption}>{EXPLORE_COPY.changeCaption}</p>

        {/*
          Two figures, then the primitives they were derived from.

          "Objects reached" is a count of distinct object ids the diff names -- added, removed or
          rebuilt -- so the line beneath it can name all three without the tile double-counting
          any of them. Relations and evidence regions used to be shown the same way, as
          added + removed, and that was wrong in the way this whole act is at risk of being
          wrong: when a content-addressed relation is re-derived it leaves and returns, so
          summing the two sides reported thirteen replaced relations as twenty-six. They are
          published as the pair the diff actually produced.
        */}
        <dl className={styles.changeCounts}>
          <div>
            <dt>Objects reached</dt>
            <dd data-tone="changed">{change.reached}</dd>
          </div>
          <div>
            <dt>Carried over untouched</dt>
            <dd>{change.counts.untouched}</dd>
          </div>
        </dl>

        <p className={styles.changeBreakdown}>
          {change.counts.added} added · {change.counts.removed} removed ·{" "}
          {change.counts.rebuilt} rebuilt in place
          <br />
          {change.relations.added} relations added · {change.relations.removed} removed ·{" "}
          {change.evidenceRegions.added} source regions added · {change.evidenceRegions.removed} removed
          <br />
          {change.sourceRevisions.added} source document
          {change.sourceRevisions.added === 1 ? "" : "s"} reissued ·{" "}
          {change.sourceRevisions.unchanged} unchanged
        </p>
        <p className={styles.changeNote}>{EXPLORE_COPY.changeCountsNote}</p>
        <p className={styles.changeNote}>
          In the composition above, {shownAffected} of the {inFocus.size} objects on screen were
          reached and {shownUntouched} were carried over.
        </p>

        <section className={styles.equivalence}>
          <p className={styles.paneLabel}>{EXPLORE_COPY.equivalenceHeading}</p>
          <p className={styles.equivalenceState}>
            {change.equivalence.state === "receipt"
              ? change.equivalence.equivalent
                ? "EQUIVALENT"
                : "NOT EQUIVALENT"
              : "NOT ESTABLISHED IN THIS DEPLOYMENT"}
          </p>
          <p className={styles.changeNote}>
            {EXPLORE_COPY.equivalenceLead}{" "}
            {change.equivalence.state === "receipt"
              ? `Receipt ${change.equivalence.source}, ${change.equivalence.compared} objects compared.`
              : change.equivalence.reason}
          </p>
        </section>
      </div>
    </div>
  );
}
