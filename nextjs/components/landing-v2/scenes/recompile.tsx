import Link from "next/link";
import type { Route } from "next";
import RevisionBadge from "../revision-badge";
import { LANDING_V2_SCENE_ORDER, type LandingV2RecompileCopy } from "@/lib/landing-v2-copy";
import { landingV2StateWord, type RecompileView } from "@/lib/landing-v2-proof";
import { RECOMPILE_ACTIONS, RECOMPILE_COUNTS_QUALIFIER } from "@/lib/landing-v2-recompile";
import styles from "./recompile.module.css";

/*
  Scene 05 -- Recompile (blueprint section 15, contract D12 and rule 7).

  WHAT THIS SCENE IS NOT
  It is not a document diff. Section 15 asks for a dependency impact view, and the difference
  matters commercially: a before/after of two renderings of a page is what a document parser
  shows, and this scene's subject is which compiled OBJECTS the arriving filings reached. So the
  left column is the corpus as it stood and what landed on it, the right column is objects, and
  the only thing between them is the relation that connects the two.

  THREE TRUTH CONSTRAINTS, ALL OF WHICH CHANGE THE PICTURE (contract rule 7)

  1. Nothing was revised. The 2025 Form 10-K was not reissued; four later filings arrived. The
     word on every row is "arrived", which is RevisionBadge's own rule.
  2. The comparison is between two COMPLETE compiles. This deployment does not perform a
     selective rebuild (lib/claim-state.ts records dependency-aware recompilation as Direction),
     so the scene prints copy.contractNote with the heading and links the contract, and there is
     no equivalence badge -- exploreChangeStory.equivalence.state is not_yet.
  3. Section 15 draws per-object state words (REBUILT / REVIEW / UNCHANGED). This World has none
     of them: toVisualWorldModel gives every object of the deterministic public sample the state
     candidate, which the product names PUBLISHED SAMPLE. Painting six rows amber and mint to
     match the storyboard would be inventing a state the data does not hold, so the rows carry
     the World's own word in the neutral colour and the semantic accents stay where the data
     really does record a change: amber on the filings that arrived, and on the count of the
     objects the arrivals rebuilt.

  SERVER COMPONENT. RecompileView is a flat projection of the compiled World, the fan is one SVG
  path, and the draw is a scroll-driven CSS animation whose base state is the drawn one -- so
  there is nothing here for a browser to hydrate and nothing that needs JavaScript to finish.
*/

/** This scene's id, spelled once. `LandingV2Scene.id` is a plain string, so it cannot index. */
const SCENE_ID = "recompile" as const;

/** `0 0 100 100`, stretched: the fan is decoration between two columns, not a measured figure. */
const FAN_VIEWBOX = "0 0 100 100";

/**
 * One path holding every connector, so the fan is a single animated object (section 23, 3 max).
 *
 * Each subpath leaves the source side at the vertical middle and arrives at the middle of its
 * row. The rows are equal-height by CSS, so evenly spaced endpoints land on them at every width
 * the fan is visible at; the curve is a cubic with horizontal handles, which is what keeps the
 * lines from crossing when the fan opens wide.
 */
function fanPath(rows: number): string {
  if (rows < 1) return "";
  return Array.from({ length: rows }, (_, index) => {
    const y = ((index + 0.5) / rows) * 100;
    return `M0,50 C40,50 60,${y} 100,${y}`;
  }).join(" ");
}

export default function Scene({
  locale,
  copy,
  data,
}: {
  locale: "en" | "ko";
  copy: LandingV2RecompileCopy;
  /** `buildRecompileView()` from `lib/landing-v2-proof.ts` -- server-only, read at build time. */
  data: RecompileView;
}) {
  const titleId = `lv2-${SCENE_ID}-title`;
  const countsId = `lv2-${SCENE_ID}-counts`;
  const objectsId = `lv2-${SCENE_ID}-objects`;
  const actions = RECOMPILE_ACTIONS[locale];
  /* D5: one state word for the column when the sample agrees, per-row when it does not. */
  const states = new Set(data.affectedSample.map((node) => node.state));
  const sharedState = states.size === 1 ? data.affectedSample[0]?.state : undefined;

  /*
    The snapshot labels, assembled the way hero-compiler-demo.tsx assembles them so the two
    places on this page that name the same two snapshots cannot disagree -- and, since round 4,
    from the same two measured fields rather than from a typed label.

    exploreChangeStory's own before/after labels are NOT used, and that is the point: both are
    string literals in lib/explore-change.ts. The before label spelled the baseline year in
    English on /ko and would keep spelling 2025 after the baseline moved; the after label carries
    the word "four" and would keep carrying it over five listed arrivals. Everything printed here
    is either a record field (form, year) or the length of the array rendered underneath it.
  */
  const beforeLabel = copy.snapshotBeforeFormat
    .replace("{year}", data.before.year)
    .replace("{form}", data.before.form);
  const afterLabel = copy.snapshotAfterFormat
    .replace("{before}", beforeLabel)
    .replace("{count}", String(data.arrivals.length));

  /* Removed is omitted when it is zero: a count of nothing is not a finding (contract rule 4). */
  const counts = [
    { key: "rebuilt", value: data.counts.rebuilt, label: copy.countLabels.rebuilt, tone: styles.rebuilt },
    { key: "added", value: data.counts.added, label: copy.countLabels.added, tone: styles.added },
    { key: "removed", value: data.counts.removed, label: copy.countLabels.removed, tone: styles.removed },
    { key: "untouched", value: data.counts.untouched, label: copy.countLabels.untouched, tone: styles.untouched },
  ].filter((count) => count.key !== "removed" || count.value > 0);

  return (
    <section
      id={SCENE_ID}
      data-scene={String(LANDING_V2_SCENE_ORDER.indexOf(SCENE_ID) + 1)}
      tabIndex={-1}
      aria-labelledby={titleId}
      className="lv2-scene lv2-scene--proof lv2-obsidian"
    >
      <div className="lv2-wrap">
        <div className="lv2-split">
          <div className="lv2-scene-head">
            <p className="lv2-eyebrow lv2-meta">{copy.eyebrow}</p>
            <h2 className="lv2-h2" id={titleId}>
              <span className="lv2-h2-line">{copy.headline}</span>
              {copy.headlineAccent ? (
                <span className="lv2-h2-line lv2-h2-accent">{copy.headlineAccent}</span>
              ) : null}
            </h2>
            <p className="lv2-scene-support lv2-body-l">{copy.support}</p>
            {/*
              D6: one terminal action per scene. The compiler contract used to be a second link
              in the action row, competing with the change record for the same decision; it is
              the sentence above it that needs the reference, so it is an inline link inside that
              sentence now -- content, not a choice.

              P3 QA round 1: it was a bare <Link> with no class, so it inherited nothing and
              measured 18px at 390 and 38px at 1440 against contract rule 8's 44px floor. Being
              inline in a sentence does not exempt a control from the floor, and `.lv2-inline-
              link` is the class that carries it -- not `.lv2-text-link`, which is the scene's
              one terminal action and whose count this scene's test pins at one.
            */}
            <p className="lv2-scene-note lv2-small">
              {copy.contractNote}{" "}
              <Link className="lv2-inline-link" href={data.hrefs.contract as Route} prefetch={false}>
                {actions.contract}
              </Link>
            </p>
          </div>

          <div className={styles.impact}>
            <div className={styles.columns}>
              {/* The corpus as it stood, and what landed on it. Amber is the arrival colour. */}
              <RevisionBadge
                beforeLabel={beforeLabel}
                afterLabel={afterLabel}
                arrivalsLabel={copy.arrivalsLabel}
                arrivals={data.arrivals}
                className={styles.source}
              />

              {/*
                The relation, drawn once. Decorative: both ends are named in text on either side
                of it, so a reader who never sees it loses nothing.
              */}
              <svg
                aria-hidden="true"
                className={styles.fan}
                viewBox={FAN_VIEWBOX}
                preserveAspectRatio="none"
                focusable="false"
              >
                <path d={fanPath(data.affectedSample.length)} pathLength={1} vectorEffect="non-scaling-stroke" />
              </svg>

              <div className={styles.objects}>
                {/*
                  D5: the state word is the COLUMN's label, not a tag repeated on every row.

                  Every object in this deterministic sample holds the same state, so the rows read
                  PUBLISHED SAMPLE once each -- a column of identical tags rather than information.
                  The word is still on the page, still the World's own, still beside the objects it
                  describes; it is said once. If a future sample ever mixes states the shared word
                  disappears and every row carries its own, because one label over rows that
                  disagree would be an average, and this project does not publish those.
                */}
                <p className="lv2-meta" id={objectsId}>
                  {copy.affectedLabel}
                  {sharedState ? ` · ${landingV2StateWord(sharedState, locale)}` : ""}
                </p>
                <ul className={styles.objectList} aria-labelledby={objectsId}>
                  {data.affectedSample.map((node) => (
                    <li key={node.id} className={styles.object}>
                      {/* The compiler labels an object with its own text, digits included. */}
                      <span className={styles.objectLabel} data-derived="1">
                        {node.label}
                      </span>
                      {sharedState ? null : (
                        <span className={`lv2-meta ${styles.objectState}`}>
                          {landingV2StateWord(node.state, locale)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/*
              The counts, each printed with the noun that says what it counts, and the qualifier
              that says which engine emitted them (BA-034) directly underneath.
            */}
            <div className={styles.counts}>
              <p className="lv2-meta" id={countsId}>
                {copy.compareLabel}
              </p>
              <ul className={styles.countList} aria-labelledby={countsId}>
                {counts.map((count) => (
                  <li key={count.key} className={`${styles.count} ${count.tone}`}>
                    <b data-derived="1">{count.value.toLocaleString("en-US")}</b>
                    <span className="lv2-meta">{count.label}</span>
                  </li>
                ))}
              </ul>
              <p className={`lv2-meta ${styles.qualifier}`}>{RECOMPILE_COUNTS_QUALIFIER[locale]}</p>
            </div>

            <p className={styles.actions}>
              <Link className="lv2-text-link" href={data.hrefs.change as Route} prefetch={false}>
                {actions.change}
              </Link>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
