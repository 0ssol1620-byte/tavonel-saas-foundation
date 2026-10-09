import { COMPILE_STAGES, type CompileStage } from "@/lib/compile-stages";
import { LANDING_V2_FILM_STAGES_KO } from "@/lib/landing-v2-hero-copy";
import HeroFilmDisclosure from "./hero-film-disclosure";

/*
  Optional continuation of the home story. The opening screen stays grounded in the committed
  source workbench; this component adds the four-cut product walkthrough at the foot of scene 02,
  after the difficulties that passage shows. The client disclosure owns the conditional player
  mount and asks the player to open a phone on the whole frame.

  The player uses the approved recordings and its existing intersection-based playback, visibility
  resume, poster fallback and WCAG motion control. Its poster does not claim the eager image slot
  reserved for the opening source card.
*/

/**
 * Cut 1 uses the byte-locked 2x master that the other three stages already use.
 *
 * The later `compile-cut-hq*` derivatives were named for their lower CRF, but both changed the
 * source from yuv444p to yuv420p. This film is coloured mono text on near-black panels, where
 * quarter-resolution chroma visibly smears glyph edges; the phone derivative also discarded half
 * the pixels in each dimension. The locked master preserves the verified 2880x1800/yuv444p source
 * on every viewport and is already recorded in `lib/locked-film-assets.json`.
 */
const HERO_CUT = {
  src: "/film/compile-cut.mp4",
  fallbackSrc: "/film/compile-cut-hq.mp4",
  fallbackPhoneSrc: "/film/compile-cut-hq-1440.mp4",
  poster: "/film/poster-1-hero-2x.webp",
} as const;

/** URL of the byte-locked poster shown when the optional walkthrough is opened. */
export const HERO_FILM_POSTER: string = HERO_CUT.poster;

function heroStages(korean: boolean): CompileStage[] {
  return COMPILE_STAGES.map((stage, index) => ({
    ...stage,
    ...(index === 0 ? HERO_CUT : {}),
    ...(korean ? LANDING_V2_FILM_STAGES_KO[index] : {}),
  }));
}

export default function HeroFilm({ korean = false }: { korean?: boolean }) {
  return <HeroFilmDisclosure korean={korean} stages={heroStages(korean)} />;
}
