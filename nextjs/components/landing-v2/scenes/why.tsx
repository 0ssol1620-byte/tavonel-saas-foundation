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

/*
  C3, 2026-09-19: THE COVERAGE GRID IS GONE, AND WHAT REPLACED IT.

  This scene used to draw a four-stage matrix with `full` and `partial` cells per layer. Rendered,
  it read as "the two competitor rows are in pieces, ours is unbroken" -- a product-category
  scoreboard with no receipt behind a single cell, which is exactly the ladder reading §16 bars
  and the perception §37 warns about. Neither mark was measured; both were this component's
  reading of a sentence in the copy deck.

  What is here now is four rows of plain text: each layer, and one neutral sentence about what
  that layer KEEPS. The compiler's row names the four stages, because "all four" is a description
  of its own responsibility rather than a score against anyone else's. No cells, no coverage
  words, no mint anywhere in the scene -- mint means `verified` on this site and nothing in this
  comparison has been verified.
*/

export default function Scene({ locale, copy }: { locale: LandingV2Locale; copy: LandingV2WhyCopy }) {
  const actions = SCENE_ACTIONS[locale];
  const titleId = "lv2-why-title";

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
              D6: ONE next action. The second link here was `actions.recompile` -- the same label
              and the same route Scene 05 hands a reader one scene earlier, so the page offered
              the compiler contract twice in two screens and made this scene a choice rather than
              a step. Scene 05 keeps it, inline in the sentence that needs it.
            */}
            <p className={s.links}>
              <Link className="lv2-text-link lv2-scene-next" href={actions.why.href as Route} prefetch={false}>
                {actions.why.label}
              </Link>
            </p>
          </div>

          <div className={s.continuum}>
            <dl className={s.tracks}>
              {copy.layers.map((layer) => (
                <div className={s.row} key={layer.id} data-layer={layer.id}>
                  <dt className={s.layer}>{layer.label}</dt>
                  <dd className={s.detail}>
                    <span className={s.responsibility}>{layer.responsibility}</span>
                    {/*
                      The four stages, on the compiler's row only, and as its own stage names --
                      not as marks in a grid that the other three rows would be scored against.
                      Each stage keeps its caption, so the row says what the four stages ARE.
                    */}
                    {layer.id === "compiler" ? (
                      <span className={s.stages}>
                        {copy.stages.map((stage) => (
                          <span className={s.stage} key={stage.id}>
                            <span className={s.stageLabel}>{stage.label}</span>
                            <span className={s.stageCaption}>{stage.caption}</span>
                          </span>
                        ))}
                      </span>
                    ) : null}
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
