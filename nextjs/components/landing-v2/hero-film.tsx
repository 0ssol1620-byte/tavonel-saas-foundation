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
 * Film re-record on design C (2026-11-05, W2; recording R2 2026-11-08 after review R1): cut 1 is `hero-r2-c1.mp4`,
 * a 2880x1800 H.264 High 4:4:4 (yuv444p) master recorded frame by frame from the real workspace UI, like the other
 * three cuts. Its two decoder-error fallbacks are yuv420p encodes of the same frames (2880 and 1440 wide). The
 * recorder, scans and encoders are scripts/film/; R2 removed the edge bands of R1's scroll segments and records the
 * workspace as a paying customer's, without the internal owner strip.
 *
 * History: cut 1 used the byte-locked 2x master that the other three stages already used.
 *
 * The later `compile-cut-hq*` derivatives were named for their lower CRF, but both changed the
 * source from yuv444p to yuv420p. This film is coloured mono text on near-black panels, where
 * quarter-resolution chroma visibly smears glyph edges; the phone derivative also discarded half
 * the pixels in each dimension. The locked master preserves the verified 2880x1800/yuv444p source
 * on every viewport and is already recorded in `lib/locked-film-assets.json`.
 */
/*
  Recording R3 (2026-11-09, LANDING-VIDEO-HISTORY-20261109 option d, D2): the same pipeline with a camera on each step's
  action and result (scripts/film/record.mjs), so 12px product type is 32 source px -- about 13.8px at 1440 and >= 12px in
  a phone's 4:5 pane -- instead of the whole 1440px screen at about 10px. No site nav and no second H1 in the frames
  (review R2-MINOR-1), a compile moment in its own stage (the run reading the five sources and stopping for review), and
  tab labels that name what each cut shows (review R2-MINOR-2). New names: /film/* is immutable for a year, and the R2
  files stay byte-identical and locked so this can be rolled back by reverting the references.
*/
/** The four re-recorded cuts, in stage order (stage 1 also has the decoder-error fallbacks in HERO_CUT). */
export const HOME_FILM_CUTS = ["/film/hero-r3-c1.mp4", "/film/hero-r3-c2.mp4", "/film/hero-r3-c3.mp4", "/film/hero-r3-c4.mp4"] as const;

/*
  R3 (D1): the masters are H.264 High 4:4:4 (yuv444p), which Chromium decodes and WebKit -- every browser on an iPhone --
  does not reliably (Windows WebKit hangs on it; Apple's decoders take 4:2:0). Each cut therefore has a 2880px yuv420p
  twin (`-hq`): a phone (below 900px, `phoneSrc`) plays it first, and any decoder error elsewhere falls back to it, so
  stages 2-4 no longer stop on an error where stage 1 used to recover. Luma stays 2880px, so the pane's type is as sharp.
*/
const HOME_FILM_PHONE_CUTS = ["/film/hero-r3-c1-hq.mp4", "/film/hero-r3-c2-hq.mp4", "/film/hero-r3-c3-hq.mp4", "/film/hero-r3-c4-hq.mp4"] as const;

const HERO_CUT = {
  src: "/film/hero-r3-c1.mp4",
  fallbackSrc: "/film/hero-r3-c1-hq.mp4",
  fallbackPhoneSrc: "/film/hero-r3-c1-hq-1440.mp4",
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
  Re-record posters (2026-11-05; R2 2026-11-08, scripts/film/posters.mjs): one source frame of each new cut -- the lossless PNG the cut was encoded
  from -- with the D-11 encoders (AVIF quality 50, 4:4:4, each 2x AVIF at most 140,000 bytes; WebP quality 82
  as the fallback). Stage 1 at t = 13.60s (page 4 of the 10-Q beside its extracted lines, one line's region
  lit), stage 2 at 4.40s (Greater China and the five filings that mention it), stage 3 at 17.96s (the World
  after the four 2026 filings), stage 4 at 6.80s (a prepared question, its passage and the page region).
  None carries an overprint, so no stage has a Tier 2 mask. Rows: public/film/README.md and
  lib/locked-film-assets.json.
*/
/*
  R3 posters: each is the frame of a step's result -- stage 1 at 10.40s (the Operating expenses line and its page region
  lit), stage 2 at 17.96s (the run stopped: a review package ready for a person), stage 3 at 17.96s (Greater China and the
  filings that mention it, after the 2026 filings arrived), stage 4 at 8.80s (the passage's page region). Stage 1's phone
  still is its 848x1060 pane (STAGE_FRAMES.sources.phonePane).
*/
const HOME_POSTERS = [
  { poster: "/film/poster-r3-c1-t10.40-2x.webp", poster1x: "/film/poster-r3-c1-t10.40.webp", posterAvif: "/film/poster-r3-c1-t10.40-2x.avif", posterAvif1x: "/film/poster-r3-c1-t10.40.avif", phonePoster: "/film/poster-r3-c1-t10.40-pane1-848x1060.webp", phonePosterAvif: "/film/poster-r3-c1-t10.40-pane1-848x1060.avif" },
  { poster: "/film/poster-r3-c2-t17.96-2x.webp", poster1x: "/film/poster-r3-c2-t17.96.webp", posterAvif: "/film/poster-r3-c2-t17.96-2x.avif", posterAvif1x: "/film/poster-r3-c2-t17.96.avif" },
  { poster: "/film/poster-r3-c3-t17.96-2x.webp", poster1x: "/film/poster-r3-c3-t17.96.webp", posterAvif: "/film/poster-r3-c3-t17.96-2x.avif", posterAvif1x: "/film/poster-r3-c3-t17.96.avif" },
  { poster: "/film/poster-r3-c4-t8.80-2x.webp", poster1x: "/film/poster-r3-c4-t8.80.webp", posterAvif: "/film/poster-r3-c4-t8.80-2x.avif", posterAvif1x: "/film/poster-r3-c4-t8.80.avif" },
] as const;

/*
  The tab label names the cut's one action (review R2-MINOR-2: "Use with AI" promised an AI session over a cut that shows
  a prepared question in the public demo). Read: an extracted line lights its page region. Compile: the run. Update: the
  filings that arrived and what they changed. Trace: a prepared question followed to its page region.
*/
const HOME_STAGE_LABELS = { en: ["Read", "Compile", "Update", "Trace"], ko: ["읽기", "컴파일", "업데이트", "근거 추적"] } as const;

/** URL of the opening poster (stage 1, 2880px file). */
export const HERO_FILM_POSTER: string = HOME_POSTERS[0].poster;

function heroStages(korean: boolean): CompileStage[] {
  const lines = korean
    ? ["추출된 줄마다 그 줄을 읽은 페이지 영역이 표시됩니다.", "준비된 원본을 컴파일하면, 실행은 사람의 검토 앞에서 멈춥니다.", "새 공시가 도착하면 지식에서 무엇이 바뀌었는지 보여줍니다.", "준비된 질문을 골라 답을 페이지 영역까지 따라가 보세요."]
    : ["Pick an extracted line and see the page region it was read from.", "Compile the ready sources, and the run stops for a person's review.", "New filings arrive, and the knowledge shows what they changed.", "Pick a prepared question and follow the answer to its page region."];
  return COMPILE_STAGES.map((stage, index) => ({
    ...stage,
    ...HOME_POSTERS[index],
    src: HOME_FILM_CUTS[index]!,
    phoneSrc: HOME_FILM_PHONE_CUTS[index]!,
    fallbackSrc: HOME_FILM_PHONE_CUTS[index]!,
    ...(index === 0 ? HERO_CUT : {}),
    ...(korean ? LANDING_V2_FILM_STAGES_KO[index] : {}),
    label: HOME_STAGE_LABELS[korean ? "ko" : "en"][index]!,
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
