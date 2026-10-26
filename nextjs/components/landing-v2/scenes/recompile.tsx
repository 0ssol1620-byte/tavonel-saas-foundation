import Link from "next/link";
import type { Route } from "next";
import { LANDING_V2_SCENE_ORDER, type LandingV2RecompileCopy } from "@/lib/landing-v2-copy";
import type { RecompileView } from "@/lib/landing-v2-runtime";
import { RECOMPILE_ACTIONS, RECOMPILE_COUNTS_QUALIFIER } from "@/lib/landing-v2-recompile";
import styles from "./recompile.module.css";

/*
  Scene 05 -- Recompile (blueprint section 15, contract D12 and rule 7).

  WHAT THIS SCENE IS NOT
  It is not a document diff. Section 15 asks for a dependency impact view, and the difference
  matters commercially: a before/after of two renderings of a page is what a document parser
  shows, and this scene's subject is what the arriving filings did to the compiled World. So the
  panel lists the filings that arrived and the three counts the comparison measured.

  THREE TRUTH CONSTRAINTS, ALL OF WHICH CHANGE THE PICTURE (contract rule 7)

  1. Nothing was revised. The 2025 Form 10-K was not reissued; four later filings arrived. The
     word on every row is "arrived", which is RevisionBadge's own rule.
  2. The comparison is between two COMPLETE compiles. This deployment does not perform a
     selective rebuild (lib/claim-state.ts records dependency-aware recompilation as Direction),
     so the scene's one sentence says the counts compare two complete compiles and the compiler
     contract is a link, and there is no equivalence badge -- exploreChangeStory.equivalence.state
     is not_yet.
  3. Section 15 draws per-object state words (REBUILT / REVIEW / UNCHANGED). This World has none
     of them, so FINAL-SPEC 2026-10-26 prints no object rows at all (the four quoted objects read
     as extraction errors, T5): the semantic accent stays where the data really does record a
     change, on the count of the objects the arrivals rebuilt.

  SERVER COMPONENT. RecompileView is a flat projection of the compiled World, so there is nothing
  here for a browser to hydrate.
*/

/** This scene's id, spelled once. `LandingV2Scene.id` is a plain string, so it cannot index. */
const SCENE_ID = "recompile" as const;

export default function Scene({
  locale,
  copy,
  data,
  sectionId = SCENE_ID,
  sceneIndex,
}: {
  locale: "en" | "ko";
  copy: LandingV2RecompileCopy;
  /** `buildRecompileView()` from `lib/landing-v2-proof.ts` -- server-only, read at build time. */
  data: RecompileView;
  sectionId?: string;
  sceneIndex?: number;
}) {
  const titleId = `lv2-${SCENE_ID}-title`;
  const arrivalsId = `lv2-${SCENE_ID}-arrivals`;
  const actions = RECOMPILE_ACTIONS[locale];
  /* The contract page is English-only: a Korean reader is told before following the link (D12). */
  const english = locale === "ko" ? { hrefLang: "en", "aria-label": `${actions.contract} (영문 페이지)` } : {};

  /* Removed is omitted when it is zero: a count of nothing is not a finding (contract rule 4). */
  const counts = [
    { key: "rebuilt", value: data.counts.rebuilt, label: copy.countLabels.rebuilt, tone: styles.rebuilt },
    { key: "added", value: data.counts.added, label: copy.countLabels.added, tone: styles.added },
    { key: "removed", value: data.counts.removed, label: copy.countLabels.removed, tone: styles.removed },
    { key: "untouched", value: data.counts.untouched, label: copy.countLabels.untouched, tone: styles.untouched },
  ].filter((count) => count.key !== "removed" || count.value > 0);

  return (
    <section
      id={sectionId}
      data-scene={String(sceneIndex ?? LANDING_V2_SCENE_ORDER.indexOf(SCENE_ID) + 1)}
      tabIndex={-1}
      aria-labelledby={titleId}
      className="lv2-scene lv2-scene--proof lv2-obsidian"
    >
      <div className="lv2-wrap">
        <h2 className="lv2-h2" id={titleId}>
          <span className="lv2-h2-line">{copy.headline}</span>
          {copy.headlineAccent ? <>{" "}<span className="lv2-h2-line">{copy.headlineAccent}</span></> : null}
        </h2>

        {/*
          FINAL-SPEC 2026-10-26 §2.5: one panel. The filings that arrived, as record fields; the three
          counts the comparison measured, coloured only where the data records a change; the one
          sentence that says what the counts compare; and the engine qualifier that travels with them.
        */}
        <div className={styles.panel}>
          <div className={styles.arrivals}>
            <p className={styles.panelLabel} id={arrivalsId}>{copy.arrivalsLabel}</p>
            <ul className={styles.arrivalList} aria-labelledby={arrivalsId}>
              {data.arrivals.map((arrival) => (
                <li key={`${arrival.form}-${arrival.filingDate}`} data-derived="1">{arrival.form} · {arrival.filingDate}</li>
              ))}
            </ul>
          </div>
          <div className={styles.counts}>
            <ul className={styles.countList} aria-label={copy.compareLabel}>
              {counts.map(count => <li key={count.key} className={`${styles.count} ${count.tone}`}>
                <b data-derived="1">{count.value.toLocaleString("en-US")}</b><span>{count.label}</span>
              </li>)}
            </ul>
            <p className={styles.compared}>{copy.compared}</p>
            <p className={styles.qualifier}>{RECOMPILE_COUNTS_QUALIFIER[locale]}</p>
          </div>
        </div>

        {/* Two text links, the contract first: the selective rebuild is specified there, not run here. */}
        <p className={styles.actions}>
          <Link className="lv2-text-link" href={data.hrefs.contract as Route} prefetch={false} {...english}>
            {actions.contract}<span aria-hidden="true">&nbsp;→</span>
          </Link>
          <Link className="lv2-text-link" href={data.hrefs.change as Route} prefetch={false}>
            {actions.change}<span aria-hidden="true">&nbsp;→</span>
          </Link>
        </p>
      </div>
    </section>
  );
}
