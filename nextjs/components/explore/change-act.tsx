"use client";

/*
  Act 3 -- CHANGE.

  Four 2026 filings landed on top of Apple's 2025 Form 10-K, and this act shows how the two
  complete compiled Worlds differ.

  Every figure below arrives as a prop from `lib/explore-change.ts`, which read it out of two
  complete compiles. None of them is written here -- including the lead sentence, whose three
  numbers are read off the same props the tiles under it print -- and the module that produces
  them refuses to load if either compile's digest moves.

  There is no PASS, and after BA-028 there is no named absence either. Full-rebuild equivalence is
  a check the compiler core runs over a selective rebuild; both sides of this comparison are full
  compiles, so the act states the comparison it actually made -- once, in `changeCaption` -- and
  stops there. The equivalence check stays published where a reader looking for it already goes:
  /product/continuous-knowledge, and the receipt inside a downloaded package.
*/

import Link from "next/link";
import type { Route } from "next";
import WorldCanvas from "@/components/world-visual/world-canvas";
import PageRegion from "@/components/world-visual/page-region";
import ParallelView from "./parallel-view";
import styles from "./explore-stage.module.css";
import { EXPLORE_COPY, type ExploreChangeArrivalView, type ExploreChangeView } from "@/lib/explore-story";
import type { VisualLayout, VisualState, VisualWorldModel } from "@/lib/visual-world-model";

/** "4 filings", "1 filing" -- a measured count read out loud, never a hand-typed one. */
const count = (value: number, noun: string) =>
  `${value.toLocaleString("en-US")} ${noun}${value === 1 ? "" : "s"}`;

/*
  One arriving filing, opened on a region of itself.

  REFERENCE RENDER is printed rather than implied. The 2026 filings' acquired originals are SEC
  EDGAR HTML documents; the committed PDF beside each one is a deterministic render of it, and
  calling that "the source PDF" here would be the most convenient untruth available on this page
  (§11.3).
*/
function ArrivalCard({ arrival }: { arrival: ExploreChangeArrivalView }) {
  const rendered = arrival.representationKind === "reference_render";
  return (
    <article className={styles.revision} data-tone="after" data-arrival="">
      <header>
        <b>{arrival.label.toUpperCase()}</b>
        <span>{arrival.filename}</span>
      </header>
      <p className={styles.revisionMeta}>
        {rendered ? "REFERENCE RENDER" : "ORIGINAL"} · PERIOD ENDED {arrival.reportDate} · ACCESSION{" "}
        {arrival.accession}
      </p>
      <p className={styles.revisionText}>{arrival.excerpt}</p>
      <PageRegion bbox1000={arrival.bbox1000} page={arrival.page} pageCount={arrival.pageCount} tone="changed" />
      <footer>
        <Link className={styles.sourceLink} href={arrival.href as Route} target="_blank" rel="noreferrer">
          {rendered ? "Open reference render ↗" : "Open committed PDF ↗"}
        </Link>
      </footer>
    </article>
  );
}

/*
  W0 → W1 → W2 → W3 → W4, one row per arriving filing (§24, §25.2).

  An ordered list, because the order is the meaning: each World is the one before it plus one
  filing, and a reader who cannot see the layout still gets the sequence from the markup.

  Every figure is read off a diff between two complete compiles whose digests are frozen. The
  RECOMPILED cell prints "n of n" on purpose -- this deployment recompiles the whole World at
  every step, and the honest way to show that beside four small change counts is to show the one
  number that is not small.
*/
function Timeline({ steps }: { steps: ExploreChangeView["timeline"] }) {
  return (
    <section className={styles.timeline} data-change-timeline="">
      <p className={styles.paneLabel}>{EXPLORE_COPY.changeTimelineHeading}</p>
      <ol className={styles.timelineSteps}>
        {steps.map((step) => (
          <li key={step.id} className={styles.timelineStep} data-step={step.id}>
            <p className={styles.timelineHead}>
              <b>{step.id.toUpperCase()}</b>
              <span>{step.to.toUpperCase()}</span>
            </p>
            <p className={styles.timelineArrival}>
              {step.arrival.label.toUpperCase()} · ACCESSION {step.arrival.accession} ·{" "}
              {step.arrival.compiledPageCount} OF {step.arrival.pageCount} PAGES ·{" "}
              {step.arrival.regionCount} REGIONS
            </p>
            <dl className={styles.timelineCounts}>
              <div>
                <dt>Added</dt>
                <dd data-tone="changed">{step.objects.added}</dd>
              </div>
              <div>
                <dt>Rebuilt in place</dt>
                <dd data-tone="changed">{step.objects.rebuilt}</dd>
              </div>
              <div>
                <dt>Removed</dt>
                <dd>{step.objects.removed}</dd>
              </div>
              <div>
                <dt>Unchanged</dt>
                <dd>{step.objects.untouched}</dd>
              </div>
              <div>
                <dt>Recompiled</dt>
                <dd>
                  {step.recompiledObjects} of {step.objectsAfter}
                </dd>
              </div>
            </dl>
            <p className={styles.changeBreakdown}>
              {step.relations.added} relations added · {step.relations.removed} removed ·{" "}
              {step.evidenceRegions.added} source regions added ·{" "}
              {step.sourceRevisions.added} source version added
            </p>
          </li>
        ))}
      </ol>
      <p className={styles.changeNote}>{EXPLORE_COPY.changeTimelineNote}</p>
    </section>
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
          {change.baseline.label.toUpperCase()} → {change.after.label.toUpperCase()}
        </p>
        <article className={styles.revision} data-tone="before">
          <header>
            <b>{change.baseline.label.toUpperCase()}</b>
            <span>{change.baseline.filename}</span>
          </header>
          <p className={styles.revisionMeta}>
            THE WORLD THE {change.arrivals.length} FILINGS ARRIVED INTO · {change.baseline.pageCount} PAGES
          </p>
          <footer>
            <Link
              className={styles.sourceLink}
              href={change.baseline.href as Route}
              target="_blank"
              rel="noreferrer"
            >
              Open committed PDF ↗
            </Link>
          </footer>
        </article>
        <p className={styles.paneLabel}>{EXPLORE_COPY.changeArrivalsHeading}</p>
        {change.arrivals.map((arrival) => (
          <ArrivalCard key={arrival.documentId} arrival={arrival} />
        ))}
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
          label="Compiled World after the 2026 filings arrived, with the objects they reached"
        />
        {/*
          §20. This is the one act where an object's state differs, and the canvas reports that
          difference in colour. The list prints AFFECTED or UNCHANGED as a word, so the same
          reading is available to someone who cannot see the palette.
        */}
        <ParallelView
          model={model}
          layout={layout}
          states={states}
          onSelect={onSelect}
          onOpen={onOpen}
          open={reduced}
        />
        {/*
          BA-033. The act used to open on two bare figures and close on a paragraph whose first
          clause denied a capability, so the sentence a reader took away was about what is not
          wired rather than about what four filings did. This is the same three measurements the
          tiles below print, in a sentence, in front of them -- `count()` exists only so that one
          filing does not read as "1 filings".
        */}
        <p className={styles.changeLead}>
          {count(change.arrivals.length, "filing")} arrived.{" "}
          {count(change.counts.rebuilt, "object")} the World already carried{" "}
          {change.counts.rebuilt === 1 ? "was" : "were"} rebuilt because of them;{" "}
          {change.counts.untouched.toLocaleString("en-US")} kept their identity untouched.
        </p>
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
            <dt>Unchanged object identities</dt>
            <dd>{change.counts.untouched}</dd>
          </div>
        </dl>

        <p className={styles.changeBreakdown} data-change-breakdown="">
          {change.counts.added} added · {change.counts.removed} removed ·{" "}
          {change.counts.rebuilt} rebuilt in place
          <br />
          {change.relations.added} relations added · {change.relations.removed} removed ·{" "}
          {change.evidenceRegions.added} source regions added · {change.evidenceRegions.removed} removed
          <br />
          {change.sourceRevisions.added} source version
          {change.sourceRevisions.added === 1 ? "" : "s"} added · {change.sourceRevisions.removed} removed ·{" "}
          {change.sourceRevisions.unchanged} carried unchanged
        </p>
        <p className={styles.changeNote}>{EXPLORE_COPY.changeCountsNote}</p>
        <p className={styles.changeNote}>
          In the composition above, {shownAffected} of the {inFocus.size} objects on screen{" "}
          {shownAffected === 1 ? "is" : "are"} named by the diff and {shownUntouched}{" "}
          {shownUntouched === 1 ? "retains" : "retain"} the same compiled identity across both
          Worlds.
        </p>

        <Timeline steps={change.timeline} />
      </div>
    </div>
  );
}
