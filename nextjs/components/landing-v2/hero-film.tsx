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
  Tier 1 poster re-cut (brief §5.3, a founder-gated item): selected by the Release 3 orchestrator
  under the founder's 2026-10-03 delegated authority, founder veto open (RESUME-20261015-LEDGER);
  no founder approval is on record. One frame of each locked cut, as a
  2880x1800 file and a 1440x900 copy. Stage 1 is t = 3.00s of compile-cut.mp4 (the fine search found
  no frame without the document eyebrow overprint, so it also carries the Tier 2 mask in
  STAGE_FRAMES); stages 2-4 are t = 17.96s, the Release 2 candidates. Frame times, cut and
  file sha256 are rows in public/film/README.md and lib/locked-film-assets.json `posters`, whose
  bytes one-path-contract.test.ts holds. New names, not new bytes under old names: /film/* is
  served immutable for a year.

  POSTER-RECUT (D-11, DECISION-REGISTER-2026-10-17; DESIGN_MASTER_V3 §22 "Hero poster <= 140KB AVIF"):
  each still is served as AVIF with the WebP pair as its fallback, and every AVIF is at most 140,000
  bytes. The 2880px stage-1 file went from 256,358 bytes of WebP to 137,967 of AVIF. No frame of cut 1
  or cut 2 fits at the Release 3 frame, so those two are re-cut: stage 1 is t = 8.16s (the same document
  as t = 3.00s, so the Tier 2 bars are unchanged), stage 2 is t = 9.28s. Stages 3 and 4 keep t = 17.96s:
  their end frames fit as AVIF and carry no overprint. The selection rule, the frame scan and the
  sha256 of every file are in public/film/README.md.

  FINAL-SPEC 2026-10-26 §2.1: a phone below 768px shows Focus as one readable pane, 4:5, instead of the
  whole frame at 3-4px type. Stage 1 has its own still of that pane (`phonePoster*`, a crop of the 2x WebP,
  README "Home phone pane"); stages 2-4 are drawn from their 2x posters by the same CSS crop the video uses.
*/
const HOME_POSTERS = [
  { poster: "/film/poster-1-t8.16-2x.webp", poster1x: "/film/poster-1-t8.16.webp", posterAvif: "/film/poster-1-t8.16-2x.avif", posterAvif1x: "/film/poster-1-t8.16.avif", phonePoster: "/film/poster-1-t8.16-pane1-684x855.webp", phonePosterAvif: "/film/poster-1-t8.16-pane1-684x855.avif" },
  { poster: "/film/poster-2-t9.28-2x.webp", poster1x: "/film/poster-2-t9.28.webp", posterAvif: "/film/poster-2-t9.28-2x.avif", posterAvif1x: "/film/poster-2-t9.28.avif" },
  { poster: "/film/poster-3-t17.96-2x.webp", poster1x: "/film/poster-3-t17.96.webp", posterAvif: "/film/poster-3-t17.96-2x.avif", posterAvif1x: "/film/poster-3-t17.96.avif" },
  { poster: "/film/poster-4-t17.96-2x.webp", poster1x: "/film/poster-4-t17.96.webp", posterAvif: "/film/poster-4-t17.96-2x.avif", posterAvif1x: "/film/poster-4-t17.96.avif" },
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

/*
  P2-32: `priority` is false only while the specimen strip renders above the film. On a phone the
  strip's first crop is then the first screen's largest image and the poster sits at or below the
  fold, so the poster gives up its preload and high fetch priority and loads lazily instead of
  taking the bandwidth the crop and the render-blocking styles need. Same bytes, same frame.
*/
export default function HeroFilm({ korean = false, priority = true }: { korean?: boolean; priority?: boolean }) {
  return <HeroFilmDisclosure korean={korean} stages={heroStages(korean)} priority={priority} />;
}
