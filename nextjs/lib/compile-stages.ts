import { PIPELINE_STAGES } from "@/lib/pipeline-vocabulary";

export type CompileStage = {
  id: string;
  label: string;
  line: string;
  src: string;
  poster: string;
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
export const COMPILE_STAGES: readonly CompileStage[] = [
  { id: "sources", label: "Files", line: "From the original page to extracted content and connected knowledge.", src: "/film/compile-cut.mp4", poster: "/film/poster-1.webp" },
  { id: "read", label: PIPELINE_STAGES[2].label, line: "Related information is organized into a connected knowledge structure.", src: "/film/compile-cut-2.mp4", poster: "/film/poster-2.webp" },
  { id: "structure", label: "Updates", line: "A changed source and its affected knowledge are shown together.", src: "/film/compile-cut-3.mp4", poster: "/film/poster-3.webp" },
  { id: "world", label: "Use with AI", line: "An assistant, editor and terminal use the same knowledge and its citations.", src: "/film/compile-cut-4.mp4", poster: "/film/poster-4.webp" },
] as const;
