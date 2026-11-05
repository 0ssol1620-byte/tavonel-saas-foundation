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
 * Film re-record on design C (2026-11-05, W2): cut 1 is `hero-c1.mp4`, a 2880x1800 H.264 High 4:4:4
 * (yuv444p) master recorded frame by frame from the real workspace UI, like the other three cuts.
 * Its two decoder-error fallbacks are yuv420p encodes of the same frames (2880 and 1440 wide).
 *
 * History: cut 1 used the byte-locked 2x master that the other three stages already used.
 *
 * The later `compile-cut-hq*` derivatives were named for their lower CRF, but both changed the
 * source from yuv444p to yuv420p. This film is coloured mono text on near-black panels, where
 * quarter-resolution chroma visibly smears glyph edges; the phone derivative also discarded half
 * the pixels in each dimension. The locked master preserves the verified 2880x1800/yuv444p source
 * on every viewport and is already recorded in `lib/locked-film-assets.json`.
 */
const HERO_CUT = {
  src: "/film/hero-c1.mp4",
  fallbackSrc: "/film/hero-c1-hq.mp4",
  fallbackPhoneSrc: "/film/hero-c1-hq-1440.mp4",
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
/*
  Re-record posters (2026-11-05): one source frame of each new cut -- the lossless PNG the cut was encoded
  from -- with the D-11 encoders (AVIF quality 50, 4:4:4, each 2x AVIF at most 140,000 bytes; WebP quality 82
  as the fallback). Stage 1 at t = 13.60s (page 4 of the 10-Q beside its extracted lines, one line's region
  lit), stage 2 at 4.40s (Greater China and the five filings that mention it), stage 3 at 17.96s (the World
  after the four 2026 filings), stage 4 at 6.80s (a prepared question, its passage and the page region).
  None carries an overprint, so no stage has a Tier 2 mask. Rows: public/film/README.md and
  lib/locked-film-assets.json.
*/
const HOME_POSTERS = [
  { poster: "/film/poster-c1-t13.60-2x.webp", poster1x: "/film/poster-c1-t13.60.webp", posterAvif: "/film/poster-c1-t13.60-2x.avif", posterAvif1x: "/film/poster-c1-t13.60.avif", phonePoster: "/film/poster-c1-t13.60-pane1-760x950.webp", phonePosterAvif: "/film/poster-c1-t13.60-pane1-760x950.avif" },
  { poster: "/film/poster-c2-t4.40-2x.webp", poster1x: "/film/poster-c2-t4.40.webp", posterAvif: "/film/poster-c2-t4.40-2x.avif", posterAvif1x: "/film/poster-c2-t4.40.avif" },
  { poster: "/film/poster-c3-t17.96-2x.webp", poster1x: "/film/poster-c3-t17.96.webp", posterAvif: "/film/poster-c3-t17.96-2x.avif", posterAvif1x: "/film/poster-c3-t17.96.avif" },
  { poster: "/film/poster-c4-t6.80-2x.webp", poster1x: "/film/poster-c4-t6.80.webp", posterAvif: "/film/poster-c4-t6.80-2x.avif", posterAvif1x: "/film/poster-c4-t6.80.avif" },
] as const;

/** URL of the opening poster (stage 1, 2880px file). */
export const HERO_FILM_POSTER: string = HOME_POSTERS[0].poster;

function heroStages(korean: boolean): CompileStage[] {
  const lines = korean
    ? ["원문 페이지와 추출된 자료를 나란히 살펴보세요.", "개체와 그 개체를 언급한 문서를 함께 살펴보세요.", "원문의 변경이 어떤 지식에 닿는지 확인하세요.", "컴파일된 지식에 질문하고, 결과의 근거 구절과 페이지를 확인하세요."]
    : ["Read original pages beside their extracted content.", "Explore the entities and the documents that mention them.", "Follow a changed source to the knowledge it affects.", "Ask the compiled knowledge and see the passage and page behind the result."];
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
