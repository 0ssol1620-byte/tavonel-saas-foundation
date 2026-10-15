import { COMPILE_STAGES, type CompileStage } from "@/lib/compile-stages";
import { LANDING_V2_FILM_STAGES_KO } from "@/lib/landing-v2-hero-copy";
import HeroFilmDisclosure from "./hero-film-disclosure";

/*
  Visible opening media, after the Home headline and primary actions. The four approved recordings are
  illustrative examples; their caption remains visible. The source workbench follows in scene02.

  The player uses the approved recordings and its existing intersection-based playback, visibility
  resume, poster fallback and WCAG motion control. The opening poster owns the priority image
  slot, while the lower source workbench loads lazily.
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
} as const;

/*
  Tier 1 poster re-cut (brief §5.3, approved for Release 3): one frame of each locked cut, as a
  2880x1800 file and a 1440x900 copy. Stage 1 is t = 3.00s of compile-cut.mp4 (the fine search found
  no frame without the document eyebrow overprint, so it also carries the Tier 2 mask in
  STAGE_FRAMES); stages 2-4 are t = 17.96s, the founder-approved candidates. Frame times, cut and
  file sha256 are rows in public/film/README.md and lib/locked-film-assets.json `posters`, whose
  bytes one-path-contract.test.ts holds. New names, not new bytes under old names: /film/* is
  served immutable for a year.
*/
const HOME_POSTERS = [
  { poster: "/film/poster-1-t3.00-2x.webp", poster1x: "/film/poster-1-t3.00.webp" },
  { poster: "/film/poster-2-t17.96-2x.webp", poster1x: "/film/poster-2-t17.96.webp" },
  { poster: "/film/poster-3-t17.96-2x.webp", poster1x: "/film/poster-3-t17.96.webp" },
  { poster: "/film/poster-4-t17.96-2x.webp", poster1x: "/film/poster-4-t17.96.webp" },
] as const;

/** URL of the opening poster (stage 1, 2880px file). */
export const HERO_FILM_POSTER: string = HOME_POSTERS[0].poster;

function heroStages(korean: boolean): CompileStage[] {
  const lines = korean
    ? ["원문 페이지와 추출된 자료를 나란히 살펴보세요.", "개체와 진술, 그 근거가 된 원문을 함께 살펴보세요.", "원문의 변경이 어떤 지식에 닿는지 확인하세요.", "같은 지식과 인용을 여러 AI 도구에서 사용하세요."]
    : ["Read original pages beside their extracted content.", "Explore the entities, claims and their sources.", "Follow a changed source to the knowledge it affects.", "Use the same knowledge and citations across AI tools."];
  return COMPILE_STAGES.map((stage, index) => ({
    ...stage,
    ...HOME_POSTERS[index],
    ...(index === 0 ? HERO_CUT : {}),
    ...(korean ? LANDING_V2_FILM_STAGES_KO[index] : {}),
    line: lines[index],
  }));
}

export default function HeroFilm({ korean = false }: { korean?: boolean }) {
  return <HeroFilmDisclosure korean={korean} stages={heroStages(korean)} />;
}
