import CompileStagePlayer from "@/components/compile-stage-player";
import { COMPILE_STAGES, type CompileStage } from "@/lib/compile-stages";
import { landingV2HeroExtra, LANDING_V2_FILM_STAGES_KO } from "@/lib/landing-v2-hero-copy";

/*
  The hero's visual: the four locked compile films, under the centered text block.

  FOUNDER DECISION, 2026-09-20, verbatim: "경쟁 웹사이트들을 레퍼런스로 우리도 통일해줘. 중앙
  정렬하고 비주얼은 그다음에 보여주되 그전에 있던 4개 비디오 영상이 더 낫지않나? 너가 마지막에
  우측에 만든 비주얼은 너가 봐도 텍스트가 너무 많아서 무슨말인지 모르겠지않아?"

  That reverses two things this campaign had settled, and both reversals are the founder's rather
  than a lane's. Blueprint §27/§28 and contract rule 3 put the entry pages in DOM and CSS with no
  film at all; §11.1 put a compiled-object composition in a right-hand column. What replaced the
  second was measured and rejected on sight -- six objects, nine text blocks and three captions in
  one column -- so the hero is now the pattern every reference site in `reports/landing-v2-0919/
  compare/` uses: one centered statement, then one visual.

  WHY THE PLAYER RATHER THAN A <video> OF ITS OWN
  `CompileStagePlayer` already owns the four behaviours a hero film needs and a hand-rolled
  element has twice lost: the IntersectionObserver that stops a film nobody is watching, the
  resume on `visibilitychange`, the decoder-failure fallback to the poster, and the WCAG 2.2.2
  motion control that is present in every state including the two that hold a still. It also
  keeps exactly one decoder open across four cuts, which is the reason the stage list is data
  rather than four mounted elements.

  WHY `preferVideo`
  The player's default path is a live canvas (`opening-film*.tsx`), and contract rule 10 bars a
  canvas from this hero outright -- it is four rAF renderers and their bundles above the fold.
  `preferVideo` routes every stage to the locked recording instead, so what the page paints is the
  approved bytes and the dynamic imports for the canvases are never fetched.

  THE STAGE TABLE IS COMPOSED HERE AND THE FILMS ARE NOT TOUCHED
  `lib/compile-stages.ts` owns the four cuts. This file overrides exactly three fields on the
  first stage -- the re-rendered master and its hero-sized poster, which is what the previous
  landing played and what `app/page.tsx` preloads -- and supplies the Korean label and caption for
  each stage from the copy module. Nothing here re-encodes, replaces or renames a locked asset
  (`lib/locked-film-assets.json`, `lib/one-path-contract.test.ts`).
*/

/**
 * Cut 1's hero encode: the same 450 frames at a lower CRF, with a poster at the size it is
 * painted. `phoneSrc` is the 1440-wide variant the player picks below 900px.
 */
const HERO_CUT = {
  src: "/film/compile-cut-hq.mp4",
  phoneSrc: "/film/compile-cut-hq-1440.mp4",
  poster: "/film/poster-1-hero-2x.webp",
} as const;

/** The LCP resource of both entry pages: the first stage's poster, preloaded by `app/page.tsx`. */
export const HERO_FILM_POSTER: string = HERO_CUT.poster;

function heroStages(korean: boolean): CompileStage[] {
  return COMPILE_STAGES.map((stage, index) => ({
    ...stage,
    ...(index === 0 ? HERO_CUT : {}),
    ...(korean ? LANDING_V2_FILM_STAGES_KO[index] : {}),
  }));
}

export default function HeroFilm({ korean = false }: { korean?: boolean }) {
  return (
    <div className="lv2-film">
      <CompileStagePlayer stages={heroStages(korean)} preferVideo priorityPoster korean={korean} />
      {/*
        §11.3 and contract rule 7. The cuts draw a ruled table, section-and-line labels and `.csv`
        sources; this deployment emits none of the three. The sentence that separates the directed
        film from what a compile emits travels with the film, and it is the same sentence the
        previous landing published -- not a softer second spelling of it.
      */}
      <p className="lv2-film-note lv2-meta">{landingV2HeroExtra(korean).filmNote}</p>
    </div>
  );
}
