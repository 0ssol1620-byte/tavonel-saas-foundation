import { PIPELINE_STAGES } from "@/lib/pipeline-vocabulary";

export type CompileStage = {
  id: string;
  label: string;
  line: string;
  src: string;
  /** A lighter encode for the phone pan (below 900px); the master when absent. */
  phoneSrc?: string;
  /** Compatibility encode used only after the preferred source raises a decoder error. */
  fallbackSrc?: string;
  /** Narrow-screen compatibility encode; falls back to fallbackSrc when absent. */
  fallbackPhoneSrc?: string;
  poster: string;
  /** A 1440px copy of `poster` (which is then the 2880px file), so a phone in Fit can take the smaller one. */
  poster1x?: string;
  /**
   * AVIF encodes of the same frame as `poster` and `poster1x`, same sizes (POSTER-RECUT, D-11). With both, the
   * still is a <picture> whose AVIF source a browser takes when it can decode it; the WebP pair is the fallback.
   */
  posterAvif?: string;
  posterAvif1x?: string;
  /**
   * The phone pane still (FINAL-SPEC 2026-10-26 §2.1): one 684x855 source-px rect of `poster`, the pane a phone
   * below 768px shows in Focus (STAGE_FRAMES[].phonePane), as WebP and AVIF. A stage without one is cropped from
   * `poster` by CSS instead.
   */
  phonePoster?: string;
  phonePosterAvif?: string;
};

/*
  The stage list lives here, not in the player, because the player is a "use client" module.

  landing-01 / regressions-01: `app/ko/page.tsx` is a server component and built KO_WORK_STAGES by
  spreading `COMPILE_STAGES[1]` / `[2]` imported from `components/compile-stage-player.tsx`. Every
  export of a "use client" module reaches a server component as a client reference, not as the
  value, so `id`, `src` and `poster` came through undefined and the second Korean film rendered as
  a blank 1280x600 panel: `<img class="compile-film-still">` with no `src` and no <video> at all.
  A plain module is readable from both sides, so the data cannot silently become a proxy again.

  The caption reads the film that is playing, not a generic description of the stage.

  STRUCTURE said "Entities, claims and relations form, each bound to the region that supports
  it." That is true of cut 3, and it is also true of half the site — it describes a static
  result. Cut 3 does something narrower and much harder to claim: it changes one clause in one
  source, shows which documents that clause reaches, and stops. `CHANGED 1 + TOUCHED 3` is on
  screen. The caption now says the part the viewer is actually watching, which is also the part
  a RAG index cannot do. Nothing else about the film changes; the films are locked.
*/
/*
  BQ-056. Sentence case, and the one stage name that is a pipeline stage comes from the constant.

  These were set in monospace caps -- FILES / ORGANIZE / UPDATES / USE WITH AI -- which is the
  instrument voice, and a tab label is not machine state. They are the page's own face now.

  What they are *not* is `PIPELINE_STAGES` relabelled. Two of these cuts show something the
  pipeline has no stage for: cut 3 changes one clause in one source and traces what it reaches,
  and cut 4 shows three tools reading the same citations. Naming them "Read" and "Ready for AI"
  to make one list out of two would put a stage name on a film that does not show that stage,
  which is the mislabelling this row was opened about. The cut that *is* a pipeline stage takes
  its name from the constant, so that one cannot drift.
*/
/*
  Film re-record on design C (2026-11-05, W2): the four cuts are `hero-c1..4.mp4`, recorded frame by frame from
  the real product UI on the published sample (the workspace's live OCR view, the World, its change view, its
  prepared questions). The earlier `compile-cut*.mp4` files stay byte-locked under their own names.
*/
export const COMPILE_STAGES: readonly CompileStage[] = [
  { id: "sources", label: "Files", line: "From the original page to extracted content and connected knowledge.", src: "/film/hero-c1.mp4", poster: "/film/poster-c1-t13.60-2x.webp" },
  { id: "read", label: PIPELINE_STAGES[2].label, line: "Related information is organized into a connected knowledge structure.", src: "/film/hero-c2.mp4", poster: "/film/poster-c2-t4.40-2x.webp" },
  { id: "structure", label: "Updates", line: "A changed source and its affected knowledge are shown together.", src: "/film/hero-c3.mp4", poster: "/film/poster-c3-t17.96-2x.webp" },
  { id: "world", label: "Use with AI", line: "A prepared question returns the passage and the page region behind its result.", src: "/film/hero-c4.mp4", poster: "/film/poster-c4-t6.80-2x.webp" },
] as const;
