import Link from "next/link";
import type { Route } from "next";
import { SCENE_ACTIONS } from "../scene-actions";
import { LANDING_V2_SCENE_ORDER, type LandingV2Locale, type LandingV2WhyCopy } from "@/lib/landing-v2-copy";
import s from "./why.module.css";

/*
  Scene 06 -- Why a compiler? (blueprint §16, guardrail §37, D9 Editorial Split, D10 tokens only.)

  WHAT THIS SCENE HAS TO AVOID
  §16's one prohibition and §37's one perception risk are the same sentence: nothing here may say
  another layer is worse. So the scene is built as a continuum of responsibilities -- READ,
  STRUCTURE, BIND, MAINTAIN -- with four layers drawn onto it at the positions each one is
  responsible for. A reader sees different work at different places, not a scoreboard. No
  company is named; the rows are layer nouns ("Parser", "Retrieval index", "Graph database"),
  which is what `lib/landing-v2-copy.ts` already wrote them as.

  WHY NOT THE BLUEPRINT'S LITERAL DRAWING
  §16 sketches four lines that all start at the left edge and stop at different points, with the
  RAG line marked "partial". Drawn that way, the retrieval row would pass through STRUCTURE and
  the graph row through READ -- claiming, on their behalf, responsibilities their own sentence in
  the copy module disclaims ("Finds passages to put in front of a model at question time";
  "Stores entities and relations that something upstream produced"). A prefix line is a ladder
  anyway, which is the reading §16 forbids. So each row is drawn only where its stated
  responsibility lands, over a continuous hairline that shows the whole contract. The compiler's
  row is the one unbroken span, which is the point and needs no adjective.

  ACCESSIBILITY
  The axis header is decorative repetition and is `aria-hidden`; every covered cell carries its
  own stage name, so the list reads as "Parser, READ, turns a file into text and layout". That
  same text is what the phone layout shows: below 768px the axis header goes and the cell labels
  become the small-caps chips of a stacked list (§16's mobile note). One DOM, no duplicate copy.

  MOTION
  None. §16 allows at most a single fade, and a fade that is worth seeing needs a scroll trigger,
  which needs a client component and hydration on a below-fold scene. The ceiling is an
  allowance, not a requirement, and a static scene is already the reduced-motion complete state.
*/

/** The one string this scene needs that the copy deck does not carry. Literal translation (D12). */
const PARTIAL_WORD: Record<LandingV2Locale, string> = { en: "partial", ko: "일부" };

type Coverage = "full" | "partial";

/*
  Which stage each layer is responsible for, and how far.

  `lib/landing-v2-copy.ts` states outright that this mapping is the component's ("Which stages a
  row covers is the component's mapping"), because it is a reading of the responsibility
  sentences rather than a sentence of its own. Each entry is defensible from the row's own words:

    parser      READ full          -- turns a file into text and layout, and stops.
    retrieval   READ full          -- it reads the text it indexes,
                BIND partial       -- and hands back where the passage was, without binding an
                                      object to that region; it never produces STRUCTURE.
    graph       STRUCTURE partial  -- stores entities and relations produced upstream. Storing a
                                      structure is part of the responsibility, not all of it.
    compiler    all four full      -- the only unbroken row.

  A layer or stage added to the copy deck with no entry here renders as an uncovered cell rather
  than throwing; `lib/landing-v2-why.test.ts` fails instead, which is where that should be caught.
*/
const COVERAGE: Record<string, Record<string, Coverage>> = {
  parser: { read: "full" },
  retrieval: { read: "full", bind: "partial" },
  graph: { structure: "partial" },
  compiler: { read: "full", structure: "full", bind: "full", maintain: "full" },
};

export default function Scene({ locale, copy }: { locale: LandingV2Locale; copy: LandingV2WhyCopy }) {
  const actions = SCENE_ACTIONS[locale];
  const titleId = "lv2-why-title";
  const partial = PARTIAL_WORD[locale];

  return (
    <section
      id="why"
      data-scene={String(LANDING_V2_SCENE_ORDER.indexOf("why") + 1)}
      tabIndex={-1}
      aria-labelledby={titleId}
      className="lv2-scene lv2-scene--proof lv2-paper"
    >
      <div className="lv2-wrap">
        <div className="lv2-split">
          <div className="lv2-scene-head">
            <p className="lv2-eyebrow lv2-meta">{copy.eyebrow}</p>
            {/*
              The §16 manifesto line is the second and last place D3 allows Instrument Serif, and
              it is the headline's own second sentence -- `copy.manifesto` is the same string. It
              is rendered once, as the accent half of the H2, the way the hero sets one phrase of
              the H1. Printing it again below would be the same sentence twice in one viewport.
            */}
            <h2 className="lv2-h2" id={titleId}>
              <span className="lv2-h2-line">{copy.headline}</span>
              <span className="lv2-h2-line lv2-h2-accent lv2-serif">{copy.headlineAccent}</span>
            </h2>
            <p className="lv2-scene-support lv2-body-l">{copy.support}</p>
            {/*
              Two links, one next action. The guide is the scene's next action (the primary text
              link, `lv2-scene-next`); the contract is a quieter second reference. Both labels and
              both destinations come from `scene-actions.ts` -- the contract link is the same
              label and route Scene 05 already hands a reader for the same page, rather than a
              second spelling of it.
            */}
            <p className={s.links}>
              <Link className="lv2-text-link lv2-scene-next" href={actions.why.href as Route} prefetch={false}>
                {actions.why.label}
              </Link>
              <Link className={`lv2-text-link ${s.secondary}`} href={actions.recompile.href as Route} prefetch={false}>
                {actions.recompile.label}
              </Link>
            </p>
          </div>

          <div className={s.continuum}>
            <div className={s.axis} aria-hidden="true">
              <span className={s.axisSpacer} />
              {copy.stages.map((stage) => (
                <span className={s.axisCell} key={stage.id} data-stage={stage.id}>
                  <span className={s.axisLabel}>{stage.label}</span>
                  <span className={s.axisCaption}>{stage.caption}</span>
                </span>
              ))}
            </div>
            <dl className={s.tracks}>
              {copy.layers.map((layer) => (
                <div className={s.row} key={layer.id}>
                  <dt className={s.layer}>{layer.label}</dt>
                  <dd className={s.detail}>
                    <span className={s.track} data-layer={layer.id}>
                      {copy.stages.map((stage) => {
                        const coverage = COVERAGE[layer.id]?.[stage.id];
                        return (
                          <span
                            className={s.cell}
                            key={stage.id}
                            data-stage={stage.id}
                            data-coverage={coverage ?? "none"}
                          >
                            {coverage ? (
                              <span className={s.cellLabel}>
                                {stage.label}
                                {/* The space is for the reader, not the layout: a flex gap is not
                                    a word boundary to a screen reader, which would say
                                    "BINDpartial". */}
                                {coverage === "partial" ? <> <span className={s.partial}>{partial}</span></> : null}
                              </span>
                            ) : null}
                          </span>
                        );
                      })}
                    </span>
                    <span className={s.responsibility}>{layer.responsibility}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </section>
  );
}
