"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { FILM_DURATION } from "@/lib/film-script";
import { COMPILE_STAGES, type CompileStage } from "@/lib/compile-stages";
import readingStyles from "./landing-v2/film-reading-layer.module.css";

const LIVE_FILMS = [
  dynamic(() => import("./opening-film"), { ssr: false }),
  dynamic(() => import("./opening-film-2"), { ssr: false }),
  dynamic(() => import("./opening-film-3"), { ssr: false }),
  dynamic(() => import("./opening-film-4"), { ssr: false }),
] as const;

/*
  A stage lasts as long as the cut it is showing.

  This was 5,000ms against an 18-second film, so a visitor saw the first 28% of each cut and
  never once reached an ending. Cut 3's whole argument is in its last third -- the trace line
  that follows the changed clause out to the documents it touches -- and cut 4 resolves at
  `FILM_ACT.end` at 16.8s. Both were cut off mid-sentence, four times a minute.

  The number comes from `lib/film-script.ts` rather than being typed here, because that file is
  what the locked films actually run on: if a cut is ever re-recorded at a different length the
  strip follows it instead of drifting.
*/
const STAGE_MS = FILM_DURATION * 1_000;

/*
  The first readable pane for each locked cut on a phone. Files opens on the source inventory,
  Read opens on the compiled Markdown, Updates opens on the changed-source diff, and Use with AI
  opens on the grounded assistant. The values select existing quarter-frame snap points; they do
  not crop or alter the film and the visitor can pan through all four panes or restore full fit.
  Non-Home callers only (their SSR markup is held to main304); Home opens on STAGE_FRAMES' pane.
*/
const MOBILE_FOCUS_PANE = [0, 1, 0, 0] as const;

/*
  Home reading target (redesign brief 2026-10-15, move 2b/2c). The cuts' own type is 8-10px and the
  micro-labels are baked into the pixels, so each stage names the ONE string a reader should find, and
  the pane it sits in. Keyed by stage id, not position, so a narrowed stage list cannot point a stage
  at another cut's string.

  The string has to be true for the whole loop, not for one frame (Release 1 critic: "Site visit
  notes" is on screen for 2 of 10 sampled seconds of cut 1). So `text` is on screen in `pane` at
  >= 80% of the sampled timestamps, proven in `compile-stage-player.frame-strings.json` (derived from
  the frame cross-check table FILM-STRING-CROSSCHECK.md, redesign-r2-20261015), and the desktop crop
  window below is chosen to hold it. The pane strip under the frame marks `pane`.

  FINAL-SPEC 2026-10-26 (§6 #6, T13): the HTML reading line that quoted `text` under the frame is no
  longer printed; the frame is the product, and its caption and alt still say what it shows.
*/
export type ReadingTarget = { pane: 0 | 1 | 2 | 3; text: string };

/*
  Home Focus crop (Release 3, brief move 2c). At 1200px the whole 2880x1800 cut draws its 7-9px
  (source) x-height at 3-4px, so on a desktop the Home film opens on a 2x window instead: two
  adjacent panes, half the frame's height, the poster and the playing cut cropped alike. `x`/`y`
  are where the window starts, as fractions of the frame, so the two panes it shows are
  `x * 4` and `x * 4 + 1`. Chosen per stage so the reading target is inside the window in
  10 of 10 sampled seconds (redesign-r3-20261015/demo/CROP-CHECK.json, template match over the
  Release 2 frame pool): WORKING COPY.md at y 1052, # Payment terms at y 242-1522 (the 450-1350
  window always holds one), CHANGED at y 278-720, nodes lit at y 1670. "Fit full frame" is one
  press away and shows the whole cut.

  Stage 1 starts at y 0.5, not 0.2 (Release 3 fix round, B1). Cut 1 loads a new document about
  every 1.08s, and each load clears EXTRACT's page copy (rows ~190-735) and wipes it back in from
  the top. A 1440x900 first screen shows only the window's top 359 of its 750px, so at y 0.2
  (rows 360-791) the right half of the first screen was nothing but dark in 129 of the cut's 446
  presented frames. At y 0.5 (rows 900-1800; first screen 900-1331) that half is the WORKING
  COPY.md editor under its label, and no presented frame of the 18s cut leaves either visible
  pane without ink (redesign-r3-20261015/fix/BLANK-SCAN.json; e2e hero-home-responsive "no blank
  pane"). The window's smallest text is then the editor's 9px (source) x-height, not 7px.

  The crop is the desktop default only where it stays inked (Release 3 fix round 3, B1). Every
  presented frame of each cut was scanned over the stage's whole 2x window with the same 24px-cell
  rule (blank = a pane with >= 99% of its cells ink-free); a stage opens cropped only when both
  panes hold ink in >= 85% of frames. Stages 1-3 score 100%. Stage 4's window on "nodes lit" leaves
  TERMINAL blank for its first ~11s (39.9%), and no window holds both its reading targets -- the
  ASSISTANT answers (pane 0) and WORLD's "nodes lit" (pane 3) -- so stage 4 opens on Fit, the whole
  frame, and its crop is what "Focus details" shows when the visitor asks for it. The numbers and
  the threshold are `blankScan` in compile-stage-player.frame-strings.json, which the unit test and
  e2e/hero-home-responsive hold `wideView` to (redesign-r3-20261015/fix2/BLANK-SCAN-2.json).
*/
export type FilmCrop = { x: 0 | 0.25 | 0.5; y: number };
export type WideView = "crop" | "fit";

/*
  Tier 2 mask (brief §5.3), stage 1 poster only. No frame of cut 1 is free of the document eyebrow
  overprint ("OPERATIONS · INTERNAL · REV 9" drawn over the title "Operations Manual"; every
  document in the cut carries one -- fine search every 0.25s, redesign-r3-20261015/demo/STAGE1-SEARCH.md).
  Two paper-coloured bars cover the eyebrow line in ORIGINAL and EXTRACT, in source pixels of that
  exact poster, and stop one row above the title's cap line, so the title is never covered; the
  eyebrow's bottom 2-3 rows, which overlap the cap tops, stay. Drawn only over the still whose
  bytes it was measured on (`poster`), never over the playing cut. It is an SVG in the cut's own
  2880 x 1800 coordinates with the still's box and xMidYMid meet, i.e. the same contain fit as the
  still, so it lands on the picture even where the frame is not exactly 16:10.
*/
export type PosterMask = { poster: string; color: string; rects: readonly { x: number; y: number; w: number; h: number }[] };

/*
  Phone pane (FINAL-SPEC 2026-10-26 §2.1). Below 768px the Home film opens on Focus as ONE pane, a
  w x w*5/4 (4:5) rect of the 2880 x 1800 frame whose top-left corner is `phonePane`, in source px.
  The CSS (film-reading-layer.module.css) draws the poster and the playing cut at 2880/w of the
  panel's width and shifts both by the same corner, so the still and the video show the same pixels
  and an auto-advance changes only --pane-x / --pane-y / --pane-w: the panel stays 4:5, no layout moves.

  Each rect holds ink in >= 85% of the presented frames of its cut (the blankScan rule above, over the
  rect alone; phonePaneScan in compile-stage-player.frame-strings.json). Stage 4's first rect, the
  ASSISTANT pane at y 516, scored 78.1% -- the answer rows are empty until the question is asked -- so
  stage 4 uses the same pane at y 180, where the MCP session opens (96.2%).

  Fix round R3 (review 2026-10-26 B-4): the phone Focus view reads >= 9px equivalent on every stage, as
  main asserted. Stages 2 and 3 hold 7 source-px text, which a 684px rect draws at 7.21px on a 390 phone,
  so their rects are 520px wide: the same 4:5 panel, 684/520 times closer (9.49px). Stage 1 starts at row
  380, under the "photo · no text layer" box of the scan_0140 page, so its first row is that page's
  "Handwritten · 12 March 2026 · Warehouse B" line; its pane still is cut from that same rect.
*/
export type PhonePane = { x: number; y: number; w: number };

export const STAGE_FRAMES: Record<string, { panes: readonly [string, string, string, string]; readingTarget: ReadingTarget; crop: FilmCrop; wideView: WideView; phonePane: PhonePane; posterMask?: PosterMask }> = {
  sources: {
    panes: ["SOURCES", "ORIGINAL", "EXTRACT", "WORLD"],
    readingTarget: { pane: 1, text: "WORKING COPY.md" },
    crop: { x: 0.25, y: 0.5 },
    wideView: "crop",
    phonePane: { x: 746, y: 380, w: 684 },
    /* POSTER-RECUT (D-11): t = 8.16s shows the same document as t = 3.00s, and its eyebrow and title rows and
       columns measured identical (the same rects; README "Home posters -- POSTER-RECUT"). */
    posterMask: { poster: "/film/poster-1-t8.16-2x.webp", color: "#f2eee7", rects: [{ x: 796, y: 206, w: 282, h: 11 }, { x: 1499, y: 204, w: 278, h: 9 }] },
  },
  read: { panes: ["NODES", "MARKDOWN", "ONTOLOGY", "WORLD"], readingTarget: { pane: 1, text: "# Payment terms" }, crop: { x: 0.25, y: 0.25 }, wideView: "crop", phonePane: { x: 820, y: 238, w: 520 } },
  structure: { panes: ["SOURCES", "MARKDOWN", "ONTOLOGY", "WORLD"], readingTarget: { pane: 0, text: "CHANGED" }, crop: { x: 0, y: 0 }, wideView: "crop", phonePane: { x: 60, y: 186, w: 520 } },
  world: { panes: ["ASSISTANT · MCP", "EDITOR", "TERMINAL", "WORLD"], readingTarget: { pane: 3, text: "nodes lit" }, crop: { x: 0.5, y: 0.45 }, wideView: "fit", phonePane: { x: 44, y: 180, w: 684 } },
};

/*
  Where the live canvas is allowed to run, and why it is a width rule.

  The four cuts are not responsive drawings. Each composes a fixed stage in absolute pixels --
  cut 3 lays a four-column board across `clientWidth * 0.97` with `colW = (bw - 30) / 4`, and
  draws every pane header as a 10px monospace title plus a right-aligned 10px label -- and then
  sizes itself to `canvas.clientWidth`. Nothing in that scales with the frame, so a narrow frame
  does not shrink the film; it crushes it.

  Measured on this build (`docs/audit/mobile/2026-09-05/column-fit.mjs` and `frame-sweep.mjs`):
  the widest header pair, `SOURCES` + `ops-manual-r9.pdf`, needs a 144px column, which needs a
  625px frame. The frame is 350px at a 390px viewport and 372px at 412px -- columns of 77px and
  83px -- so the title and the label are drawn on top of each other and the four columns run
  together. That is the "PaymentTerms PaymentTerms" over "NODES MARKDOWN ONTOLOGY WORLD" smear
  the founder photographed. The header stops colliding around a 680px viewport, but clearing a
  collision is not the same as being readable: the composition is authored for the ~1354px frame
  a 1440px viewport gives it, and at 680px it runs at 43% of that with 8px body type.

  So the cut-off is 900px, which is the boundary the rest of the page already uses (`--rail`
  goes to 0, the scene rail disappears, scenes stop being full-height). Below it the landing is
  a stacked mobile flow and the live canvas has no business in it.

  The second arm is not a duplicate of the first. A phone in landscape is 844-932 CSS px wide --
  an iPhone 15 Pro Max is 932 -- so a pure `max-width: 899px` rule would hand the canvas straight
  back to the same phone the moment it was rotated. `(pointer: coarse)` up to 1023px also covers
  tablet portrait, where the frame is 707-866px and the device is paying for an animation-frame
  loop at devicePixelRatio 2-3. At 1024 and above with a fine pointer the canvas returns.
*/
const NARROW_FRAME = "(max-width: 899px), (pointer: coarse) and (max-width: 1023px)";

/* Below this the Home film's Focus view is one 4:5 pane (STAGE_FRAMES[].phonePane), not the pan surface. */
export const PHONE_PANE_MEDIA = "(max-width: 767.98px)";

/*
  What the one motion control says, and therefore what it does (film-01, film-02).

  The button was rendered only when reduced motion was *off*, which inverted it: the two states
  where the frame is a still and nothing will ever start it -- `prefers-reduced-motion` and
  Save-Data -- were exactly the states with no control at all. A visitor who asked their browser
  to spend less, or not to animate, was shown a poster of a film with no way to watch it.

  Three states, one button:
  - "Play" while a still is standing in for an unstarted film. A click starts it, which WCAG
    2.2.2 allows because the visitor initiated it -- the preference bars *auto*-play, not play.
  - "Resume" once a playing film has been paused.
  - "Pause" while it is running.

  Pure, and exported, so both branches are tested without a DOM.
*/
export type FilmControl = "play" | "pause" | "resume" | "replay";

export function filmMotionControl(state: {
  reducedMotion: boolean;
  saveData: boolean;
  paused: boolean;
  playRequested: boolean;
  /** The single-stage film has run to its last frame (MED-12): the control offers a replay. */
  ended?: boolean;
}): FilmControl {
  if ((state.reducedMotion || state.saveData) && !state.playRequested) return "play";
  if (state.ended) return "replay";
  return state.paused ? "resume" : "pause";
}

/*
  BQ-129 replaced the pause glyph `Ⅱ` (U+2161, the Roman numeral two) with `▮▮`, which is the
  right mark and still the wrong way to put it on screen.

  type-09: the webfont is subset. app/tavonel.css declares Wanted Sans Variable over ranges that
  contain neither U+25AE nor U+25B6, so both marks ALWAYS came from the next entry in the stack --
  -apple-system, Segoe UI, system-ui -- and their weight, size, baseline and colour were whatever
  the viewer's OS supplied. On the landing hero that is mid-grey bars with subpixel fringing
  instead of the declared cream, different on Windows, macOS and Android.

  The site draws its own marks (components/logomark.tsx). These are drawn too: one 16x16 box,
  `fill: currentColor` so the control's own colour and its states still reach them, and the
  accessible name stays on the button where it always was.
*/
export const FILM_CONTROL_LABEL: Record<FilmControl, { label: string }> = {
  play: { label: "Play the compilation film" },
  resume: { label: "Resume the compilation film" },
  replay: { label: "Replay the compilation film" },
  pause: { label: "Pause the compilation film" },
};

export function FilmControlMark({ control }: { control: FilmControl }) {
  return (
    <svg className="compile-film-motion-mark" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false">
      {control === "pause"
        ? <><rect x="4" y="2.5" width="3" height="11" /><rect x="9" y="2.5" width="3" height="11" /></>
        : <path d="M4 2.5 13 8 4 13.5Z" />}
    </svg>
  );
}

/*
  BQ-013. The half of the locale thread that is not visible copy.

  /ko passes Korean stages, so the tab labels and the caption follow the page. Five strings do
  not, because they live in the player rather than in the stage list: the tablist name and the
  three control names -- which are the accessible name of every control in the film -- and the
  sentence shown when a decoder refuses. A Korean reader on a screen reader heard the whole film
  in English.

  D12: literal translations of the strings above, not new copy. The English record stays the
  default, so every English surface and the e2e specs that select on those names are unchanged.
*/
export const FILM_CONTROL_LABEL_KO: Record<FilmControl, string> = {
  play: "컴파일 영상 재생",
  resume: "컴파일 영상 이어서 재생",
  replay: "컴파일 영상 다시 재생",
  pause: "컴파일 영상 일시정지",
};

const FILM_ERROR = "This browser could not play the film. The poster remains visible.";
const FILM_ERROR_KO = "이 브라우저에서는 영상을 재생할 수 없습니다. 대표 이미지는 그대로 표시됩니다.";

const MOBILE_FILM_VIEW = {
  en: {
    focus: "Focus details",
    focusedHint: "Focused view · Swipe or use arrow keys to inspect the frame.",
    fittedHint: "Full frame · Focus details to inspect small type.",
    panes: "Film panes",
  },
  ko: {
    focus: "세부 내용 확대",
    focusedHint: "확대 보기 · 옆으로 밀거나 방향키로 화면을 살펴보세요.",
    fittedHint: "전체 프레임 · 작은 글자는 세부 내용 확대에서 확인하세요.",
    panes: "영상 패널",
  },
} as const;

/*
  Which mobile view the player opens on. The shared default is "fit": a narrow frame opens on the
  whole composition, and "Focus details" stays one tap away. A caller that wants the readable pane
  above first asks for "focus". Only the starting state changes: the toggle below still moves
  between the two.
*/
export type MobileFilmView = "fit" | "focus";

/* Poster `sizes` (see posterSizes in the player); the hero preload uses FILM_POSTER_SIZES too. */
export const FILM_POSTER_SIZES = "(min-width: 900px) 2400px, 100vw";
export const FILM_POSTER_FOCUS_SIZES = "1960px";
export const filmPosterSrcSet = (stage: Pick<CompileStage, "poster" | "poster1x">) =>
  stage.poster1x ? `${stage.poster1x} 1440w, ${stage.poster} 2880w` : undefined;
/* The same srcset in AVIF (D-11), only when the stage has both AVIF files. */
export const filmPosterAvifSrcSet = (stage: Pick<CompileStage, "posterAvif" | "posterAvif1x">) =>
  stage.posterAvif && stage.posterAvif1x ? `${stage.posterAvif1x} 1440w, ${stage.posterAvif} 2880w` : undefined;
/* Whether the still's <picture> took its AVIF source. `currentSrc` is empty until the browser has chosen one. */
export const stillTookAvif = (image: Pick<HTMLImageElement, "currentSrc"> | null) => Boolean(image?.currentSrc.endsWith(".avif"));

/** The mobile-tools toggle, Fit full frame <-> Focus details. Pure, so the transition is tested without a DOM. */
export function toggleMobileFilmFit(fit: boolean): boolean {
  return !fit;
}

/*
  The Home desktop toggle records the visitor's choice against the stage's own default, not as an
  absolute view (Release 3 fix round 4, M1). It stored "crop" after a Fit -> Focus round trip on
  stages 1-3, and that "crop" then opened stage 4 -- whose default is Fit because its crop leaves
  TERMINAL blank for 60% of the cut (blankScan) -- on the blank window. Now a press that lands back
  on the stage default clears the choice, so every stage opens on its own default again. A Fit asked
  for anywhere holds across stages (Fit is never blank); a Focus asked for on a Fit-default stage
  belongs to that stage and clears when the stage changes. Pure, so the walk is tested without a DOM.
*/
export function nextWideChoice(shown: WideView, stageDefault: WideView): WideView | null {
  const next: WideView = shown === "fit" ? "crop" : "fit";
  return next === stageDefault ? null : next;
}

export function wideChoiceOnStageChange(choice: WideView | null): WideView | null {
  return choice === "crop" ? null : choice;
}

export const FILM_TEXT = {
  en: { stages: "Compilation stages", error: FILM_ERROR, errorLong: `${FILM_ERROR.slice(0, -1)}; try another stage or inspect the public sample.` },
  ko: { stages: "컴파일 단계", error: FILM_ERROR_KO, errorLong: `${FILM_ERROR_KO} 다른 단계를 선택하거나 공개 샘플을 확인해 보세요.` },
} as const;

export default function CompileStagePlayer({
  stages = COMPILE_STAGES,
  onStageChange,
  preferVideo = false,
  playbackRate = 1,
  compact = false,
  stageDisclosureLabel,
  priorityPoster = false,
  lazyPoster = false,
  korean = false,
  initialMobileFilmView = "fit",
  storyLayout = false,
}: {
  stages?: readonly CompileStage[];
  onStageChange?: (stage: CompileStage, index: number) => void;
  /** Use the approved encoded films rather than rerendering a canvas version. */
  preferVideo?: boolean;
  /** Presentation-only acceleration. The source asset remains untouched. */
  playbackRate?: number;
  /** Hide chapter navigation/caption for a single-purpose hero presentation. */
  compact?: boolean;
  /** Keep a film visible while making its secondary cut selector optional. */
  stageDisclosureLabel?: string;
  /** Mark an above-the-fold poster as the page's priority image without changing its bytes. */
  priorityPoster?: boolean;
  /** Load a poster that sits below the first screen lazily (P2-32: Home while the specimen strip renders above it). */
  lazyPoster?: boolean;
  /** BQ-013. Name the controls and the fallback in the page's language. The stage list carries its own. */
  korean?: boolean;
  /** The view a narrow frame opens on. Defaults to "fit"; the visitor's toggle still switches it. */
  initialMobileFilmView?: MobileFilmView;
  /** Home-only story ordering; other callers keep their existing composition. */
  storyLayout?: boolean;
}) {
  const text = korean ? FILM_TEXT.ko : FILM_TEXT.en;
  const instanceId = useId().replaceAll(":", "");
  const panelId = `${instanceId}-compile-stage-panel`;
  const tabId = useCallback((stageId: string) => `${instanceId}-compile-stage-tab-${stageId}`, [instanceId]);
  const [index, setIndex] = useState(0);
  const [inView, setInView] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [canvasReady, setCanvasReady] = useState(false);
  const [narrow, setNarrow] = useState(false);
  /* Below PHONE_PANE_MEDIA: Home's Focus view is one fixed pane, which neither pans nor scrolls. */
  const [phoneFrame, setPhoneFrame] = useState(false);
  // The single-stage film plays once and stops on its last frame; the control then offers a replay.
  const [ended, setEnded] = useState(false);
  const [saveData, setSaveData] = useState(false);
  const [documentVisible, setDocumentVisible] = useState(true);
  const [mobileFilmFit, setMobileFilmFit] = useState(initialMobileFilmView === "fit");
  /* Home desktop (not narrow): the visitor's own choice where it differs from the stage default
     (nextWideChoice / wideChoiceOnStageChange). */
  const [wideChoice, setWideChoice] = useState<WideView | null>(null);
  const [videoError, setVideoError] = useState(false);
  /* The recording whose first frame is on screen (`loadeddata`); until then a phone pane keeps its own still over it. */
  const [framedSrc, setFramedSrc] = useState<string | null>(null);
  const [failedPreferredSrc, setFailedPreferredSrc] = useState<string | null>(null);
  /*
    WCAG 2.2.2. A cut runs ~18s and then advances on its own — auto-playing motion well past the
    five-second bound — so a mechanism to stop it is not optional.

    The control existed until `0d550fa` ("UX: complete 120-point visual, interaction and intake
    polish"), which rewrote the viewport down to one keyed decoder and dropped the button with
    it. `.compile-film-motion-control` in `app/ux-polish.css`, and its "the motion control
    remains for WCAG" note, were left behind pointing at nothing. Restored here.

    Pausing shows the stage's own still and disarms the auto-advance — the same path reduced
    motion already takes, rather than a second mechanism per renderer. It has to be that path:
    the wide-viewport renderer is a canvas rAF loop, not a <video> with a `pause()` to call.
  */
  const [paused, setPaused] = useState(false);
  /*
    The visitor pressed Play on a frame that was never going to start by itself.

    This is not the same thing as "not paused": under reduced motion or Save-Data the film is
    held as a still deliberately, and only an explicit request may lift that. Nothing sets it but
    the control, so neither preference is ever overridden by the page.
  */
  const [playRequested, setPlayRequested] = useState(false);
  /*
    The stage the visitor chose, and which the player may not take back from them.

    Auto-advance and manual selection were fighting: tapping STRUCTURE started an 18-second
    clock that moved the strip to WORLD whether or not the reader was still watching. A tab
    press or a swipe holds the stage it selected; the timer is not armed for a held stage.
  */
  const [held, setHeld] = useState<number | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stillRef = useRef<HTMLImageElement | null>(null);
  /* D-11: whether this browser took the still's AVIF source. It is a capability, so once true it stays true. */
  const [posterAvifTaken, setPosterAvifTaken] = useState(false);
  /*
    Route-level compositions may supply a narrowed stage list. Rendering must remain fail-safe if
    that list is temporarily empty or malformed during a server/client boundary transition: a
    missing stage is not allowed to turn a public entry route into a 500. The locked first stage is
    the conservative visual fallback and does not change any source asset.
  */
  const active = stages[index] ?? stages[0] ?? COMPILE_STAGES[0]!;
  const stageFrame = storyLayout ? STAGE_FRAMES[active.id] : undefined;
  const target = stageFrame?.readingTarget;
  const focusPane = storyLayout ? (target?.pane ?? 0) : (MOBILE_FOCUS_PANE[index] ?? 0);
  const crop = stageFrame?.crop;
  /* Until the visitor chooses, each stage opens on its own default (STAGE_FRAMES[].wideView). */
  const wideFit = (wideChoice ?? stageFrame?.wideView ?? "crop") === "fit";
  /* A Home phone in Focus starts on the same rows the desktop crop shows. */
  const cropTop = crop?.y;
  /* The quarter-frame pane a panning phone is looking at; drives the visible pane indicator. */
  const [visiblePane, setVisiblePane] = useState(0);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const frame = window.matchMedia(NARROW_FRAME);
    const phone = window.matchMedia(PHONE_PANE_MEDIA);
    const apply = () => setReducedMotion(query.matches);
    const applyFrame = () => setNarrow(frame.matches);
    const applyPhone = () => setPhoneFrame(phone.matches);
    apply();
    applyFrame();
    applyPhone();
    query.addEventListener("change", apply);
    frame.addEventListener("change", applyFrame);
    phone.addEventListener("change", applyPhone);
    const probe = document.createElement("canvas");
    setCanvasReady(Boolean(probe.getContext("2d")));
    /*
      Save-Data is a request, not a hint to weigh against other things: a visitor who has asked
      their browser to spend less has asked not to be sent 18 seconds of video for a frame they
      have not chosen to play. They get the poster, which they were being sent anyway.
    */
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    setSaveData(Boolean(connection?.saveData));
    return () => {
      query.removeEventListener("change", apply);
      frame.removeEventListener("change", applyFrame);
      phone.removeEventListener("change", applyPhone);
    };
  }, []);

  useEffect(() => { onStageChange?.(active, index); }, [active, index, onStageChange]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !narrow || mobileFilmFit) return;
    const frame = window.requestAnimationFrame(() => {
      viewport.scrollTo({ left: Math.round((viewport.scrollWidth / 4) * focusPane), top: Math.round(viewport.scrollHeight * (cropTop ?? 0)), behavior: "auto" });
      setVisiblePane(focusPane);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [cropTop, focusPane, index, mobileFilmFit, narrow]);

  const go = useCallback((next: number) => {
    const wrapped = ((next % stages.length) + stages.length) % stages.length;
    setVideoError(false);
    if (wrapped !== index) setWideChoice(wideChoiceOnStageChange);
    setIndex(wrapped);
  }, [index, stages.length]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(Boolean(entry?.isIntersecting)),
      { threshold: 0.35 },
    );
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  /* A held preference is lifted only by the visitor's own Play, never by the page. */
  const autoplay = (!reducedMotion && !saveData) || playRequested;
  useEffect(() => {
    const update = () => setDocumentVisible(document.visibilityState !== "hidden");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  const cycling = autoplay && !paused && inView && documentVisible && !videoError && held !== index;

  useEffect(() => {
    if (!cycling) return;
    const timer = window.setTimeout(() => go(index + 1), STAGE_MS / Math.max(0.1, playbackRate));
    return () => window.clearTimeout(timer);
  }, [cycling, index, go, playbackRate]);

  const focusStage = useCallback((position: number) => {
    const stage = stages[((position % stages.length) + stages.length) % stages.length];
    if (stage) document.getElementById(tabId(stage.id))?.focus();
  }, [stages, tabId]);

  const chooseStage = useCallback((next: number, moveFocus = false) => {
    const wrapped = ((next % stages.length) + stages.length) % stages.length;
    setHeld(wrapped);
    go(wrapped);
    if (moveFocus) focusStage(wrapped);
  }, [focusStage, go, stages.length]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // Arrow navigation follows the focused tab, including externally restored focus.
    const focusedTab = event.target instanceof HTMLElement ? event.target.closest('[role="tab"]') : null;
    const focusedIndex = stages.findIndex(stage => tabId(stage.id) === focusedTab?.id);
    const origin = focusedIndex >= 0 ? focusedIndex : index;
    const move = (next: number) => {
      event.preventDefault();
      chooseStage(next, true);
    };
    if (event.key === "ArrowRight") move(origin + 1);
    if (event.key === "ArrowLeft") move(origin - 1);
    if (event.key === "Home") move(0);
    if (event.key === "End") move(stages.length - 1);
  };

  const touchStart = useRef<number | null>(null);
  const touchHandlers = useMemo(() => ({
    onTouchStart: (event: React.TouchEvent) => { touchStart.current = event.touches[0]?.clientX ?? null; },
    onTouchEnd: (event: React.TouchEvent) => {
      const start = touchStart.current;
      touchStart.current = null;
      const end = event.changedTouches[0]?.clientX;
      if (start === null || end === undefined) return;
      const delta = end - start;
      if (Math.abs(delta) < 48) return;
      chooseStage(index + (delta < 0 ? 1 : -1));
    },
  }), [chooseStage, index]);

  /*
    The film's own ending is the cut point, and a held stage loops in place.

    The element carries no `loop`, so `ended` is the real boundary of the recording rather than
    a timer's guess at it; the timer above stays armed as the fallback for a decoder that never
    reports one. When the visitor is holding this stage the cut restarts instead of advancing.
  */
  const onEnded = useCallback(() => {
    if (stages.length === 1) {
      /*
        Landing replan, 2026-09-18 (MED-12). This restarted the cut, which made the hero an infinite
        autoplay loop for as long as the tab was open. The film ends on the frame it was cut to end on,
        and the control becomes a replay.
      */
      setEnded(true);
      return;
    }
    if (cycling) { go(index + 1); return; }
    const element = videoRef.current;
    if (!element) return;
    element.currentTime = 0;
    void element.play().catch(() => {});
  }, [cycling, go, index, stages.length]);

  const LiveFilm = LIVE_FILMS[index] ?? LIVE_FILMS[0];
  /*
    A Play under reduced motion gets the recording, not the canvas.

    Each live renderer reads `prefers-reduced-motion` itself and, when it is set, paints one
    frame and stops -- correct for a film nobody asked to watch, and useless as the answer to a
    visitor who just pressed Play. The <video> path plays the same cut, so an explicit request
    is routed there and the button does what it says.
  */
  const live = !preferVideo && canvasReady && !narrow && !(reducedMotion && playRequested);
  const still = !autoplay || paused || !inView || !documentVisible || videoError;
  useEffect(() => {
    if (still && stillTookAvif(stillRef.current)) setPosterAvifTaken(true);
  }, [still, active]);
  /* A still unmounts the <video>; the next one starts without a frame, so the pane hold applies again. */
  useEffect(() => { if (still) setFramedSrc(null); }, [still]);
  const control = filmMotionControl({ reducedMotion, saveData, paused, playRequested, ended });
  const preferredVideoSrc = narrow && active.phoneSrc ? active.phoneSrc : active.src;
  const fallbackVideoSrc = narrow
    ? active.fallbackPhoneSrc ?? active.fallbackSrc
    : active.fallbackSrc;
  const videoSrc = failedPreferredSrc === preferredVideoSrc && fallbackVideoSrc
    ? fallbackVideoSrc
    : preferredVideoSrc;

  /*
    Which poster file a still asks for. The desktop crop draws the frame at 2x its box, so it takes
    the 2880px file at any density; a phone in Fit draws ~350px and takes the 1440px file; Focus on a
    phone asks for the 2880px file again. FILM_POSTER_SIZES is also the hero preload's imageSizes.
  */
  const posterSizes = narrow && !mobileFilmFit ? FILM_POSTER_FOCUS_SIZES : FILM_POSTER_SIZES;
  const posterSrcSet = filmPosterSrcSet(active);
  const posterAvifSrcSet = filmPosterAvifSrcSet(active);
  const mask = stageFrame?.posterMask?.poster === active.poster ? stageFrame.posterMask : undefined;
  /* Home phone in Focus details: from 768px the frame pans across its four panes; below it shows one pane. */
  const paneView = storyLayout && phoneFrame && !mobileFilmFit;
  const panning = storyLayout && narrow && !mobileFilmFit && !paneView;
  /* The phone pane's own still, decided from state alone (SSR); the <source media> keeps it off a desktop. */
  const panePoster = storyLayout && !mobileFilmFit && active.phonePosterAvif ? active : undefined;
  /*
    D-11: the <video poster> attribute cannot negotiate a format, so it names the file the still already
    chose -- AVIF where the <picture> took AVIF, WebP otherwise -- and a browser fetches one poster, not two.
    `posterAvifTaken` is read off the still's `currentSrc`, which the browser sets when it selects a source.
  */
  /*
    Review 2026-10-26 B-2 (acceptance 25, D-11 "one poster"): a phone showing the pane's own still gives the
    <video> no poster -- the attribute could only name the 1440px frame, a second first-screen request -- and
    keeps that still (already in the cache) over the recording until its first frame is up (`paneHold`).
  */
  const paneHold = paneView && panePoster && framedSrc !== videoSrc ? panePoster : undefined;
  const videoPoster = paneView && panePoster ? undefined : posterAvifTaken && active.posterAvif
    ? (narrow && active.posterAvif1x ? active.posterAvif1x : active.posterAvif)
    : (narrow && active.poster1x ? active.poster1x : active.poster);

  const stageTabs = !compact ? <div className={storyLayout ? `compile-film-stages ${readingStyles.tabs}` : "compile-film-stages"} role="tablist" aria-label={text.stages} onKeyDown={onKeyDown}>
    {stages.map((stage, position) => (
      <button key={stage.id} type="button" role="tab" id={tabId(stage.id)} aria-selected={position === index} aria-controls={panelId} tabIndex={position === index ? 0 : -1} data-active={position === index ? 1 : 0} onClick={() => chooseStage(position)}>{stage.label}</button>
    ))}
  </div> : null;

  const panTo = (pane: number) => {
    const viewport = viewportRef.current;
    viewport?.scrollTo({ left: Math.round((viewport.scrollWidth / 4) * pane), top: viewport.scrollTop, behavior: reducedMotion ? "auto" : "smooth" });
  };
  const motionControl = (
        <button
          type="button"
          className="compile-film-motion-control"
          data-control={control}
          aria-label={korean ? FILM_CONTROL_LABEL_KO[control] : FILM_CONTROL_LABEL[control].label}
          /* The label names the next action (Play/Pause/Resume/Replay), so on Home it carries no
             pressed state: "Pause, pressed" while the film plays was the inverted reading (fix
             round 2, M1). Other callers keep main304's markup (home-player-main304-parity). */
          aria-pressed={storyLayout ? undefined : control === "pause"}
          onClick={() => {
            if (control === "pause") { setPaused(true); return; }
            if (control === "replay") {
              const element = videoRef.current;
              if (element) { element.currentTime = 0; void element.play().catch(() => {}); }
              setEnded(false);
            }
            setVideoError(false);
            setPaused(false);
            setPlayRequested(true);
          }}
        >
          <FilmControlMark control={control} />
        </button>
  );

  /*
    Both view toggles are one WAI-ARIA toggle button each (Release 3 fix round 3, M1): the label
    names the action and never changes ("Focus details"), and aria-pressed names the state -- true
    exactly while the focused view (the desktop 2x crop, the phone's panning frame) is on screen.
    The round before dropped the pressed state and flipped the label instead, and non-Home callers
    flipped the label while pressed, which read "Fit full frame, pressed" with the frame focused.
    A first render in Fit is unchanged for every caller ("Focus details", aria-pressed="false"), so
    main304's server markup still holds (home-player-main304-parity.test.ts).

    FINAL-SPEC 2026-10-26 (§6 #6-7, T7/T13/T15): on Home both toggles are one 16px drawn mark with the
    same name as an aria-label, and the phone's hint paragraph is not printed. Other callers keep the
    label and the hint, which main304's markup holds.
  */
  const viewLabel = MOBILE_FILM_VIEW[korean ? "ko" : "en"].focus;
  const viewMark = (
    <svg className="compile-film-view-mark" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" focusable="false">
      <path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" />
    </svg>
  );
  const mobileTools = (<div className="compile-film-mobile-tools">
        <button
          type="button"
          className="compile-film-focus-control"
          aria-controls={panelId}
          aria-pressed={!mobileFilmFit}
          aria-label={storyLayout ? viewLabel : undefined}
          onClick={() => setMobileFilmFit(toggleMobileFilmFit)}
        >
          {storyLayout ? viewMark : viewLabel}
        </button>
        {panning ? motionControl : null}
        {storyLayout ? null : <p aria-live="polite">
          {mobileFilmFit
            ? MOBILE_FILM_VIEW[korean ? "ko" : "en"].fittedHint
            : MOBILE_FILM_VIEW[korean ? "ko" : "en"].focusedHint}
        </p>}
      </div>);
  /* Home desktop: the same toggle as the phone, on its own crop state (CSS shows one of the two). */
  const viewControl = storyLayout ? (
    <button type="button" className={`compile-film-view-control ${readingStyles.viewControl}`} aria-controls={panelId} aria-pressed={!wideFit} aria-label={viewLabel} onClick={() => setWideChoice(nextWideChoice(wideFit ? "fit" : "crop", stageFrame?.wideView ?? "crop"))}>
      {viewMark}
    </button>
  ) : null;
  const stageCaption = !compact ? <div className="compile-film-caption">
        {/*
          Keyed by stage for the reason the reading line is (UX-L6, R4-MJ1): where a stage's caption
          takes one line and the next two (KO 430), the reused text node moved inside the caption
          row on each auto-advance and Chrome scored it as a layout shift without input (0.00073
          over three advances, p2-06-film-line). A new stage's caption is new text.
        */}
        <p key={active.id}>{videoError ? text.errorLong : active.line}</p>
        {/*
          `data-derived` because both halves of this counter are read rather than typed: the
          position is the player's own index and the total is `stages.length`. The landing's
          figure walk (`e2e/landing-v2.spec.ts`, `lib/landing-v2-page.test.ts`) accepts a digit on
          the entry pages only inside an element that declares it was measured, and contract rule
          4's other half is satisfied too -- the figure is printed with its denominator.
        */}
        <span className="compile-film-progress" aria-hidden="true" data-derived="1">{String(index + 1).padStart(2, "0")} / {String(stages.length).padStart(2, "0")}</span>
      </div> : null;

  /*
    Below the frame, outside the source pixels: the four pane headers as a strip aligned under the
    panes, the target pane marked. On a panning phone the strip is the pane indicator -- real
    buttons, the visible pane `aria-current` -- for the snap targets that are aria-hidden; elsewhere
    it only names the panes in view and is hidden from assistive tech. A phone pane hides it (CSS).
  */
  const markedPane = panning ? visiblePane : target?.pane;
  const readingLayer = stageFrame && target ? (
    <div className={readingStyles.reading} data-film-reading="">
      <ol className={readingStyles.panes} lang={korean ? "en" : undefined} aria-label={panning ? MOBILE_FILM_VIEW[korean ? "ko" : "en"].panes : undefined} aria-hidden={panning ? undefined : true}>
        {stageFrame.panes.map((name, pane) => (
          <li key={pane} data-marked={pane === markedPane ? 1 : undefined} data-in-crop={crop && (pane === crop.x * 4 || pane === crop.x * 4 + 1) ? 1 : undefined}>
            {panning
              ? <button type="button" aria-current={pane === visiblePane ? "true" : undefined} onClick={() => panTo(pane)}>{name}</button>
              : name}
          </li>
        ))}
      </ol>
    </div>
  ) : null;

  return (
    /* Below 900px the horizontal gesture pans the film (G1-012). The separate tab strip chooses
       the cut and may sit behind a native disclosure on the landing page. */
    <div className={storyLayout ? `compile-film-sequence rv ${readingStyles.story}` : "compile-film-sequence rv"} ref={frameRef} {...(narrow ? {} : touchHandlers)} data-story-layout={storyLayout ? 1 : undefined} data-wide-view={storyLayout ? (wideFit ? "fit" : "crop") : undefined} data-pane-poster={panePoster ? 1 : undefined} style={stageFrame ? ({ "--film-crop-x": `${stageFrame.crop.x * 100}%`, "--film-crop-y": `${stageFrame.crop.y * 100}%`, "--pane-x": String(stageFrame.phonePane.x), "--pane-y": String(stageFrame.phonePane.y), "--pane-w": String(stageFrame.phonePane.w) } as React.CSSProperties) : undefined} data-film-renderer={live ? "live-canvas" : "video-fallback"} data-video-src={videoSrc} data-video-primary-src={preferredVideoSrc} data-compact={compact ? 1 : 0} data-narrow={narrow ? 1 : 0} data-mobile-view={mobileFilmFit ? "fit" : "focus"} data-mobile-focus-pane={focusPane}>
      {stageDisclosureLabel && stageTabs ? <details className="compile-film-stage-disclosure">
        <summary>{stageDisclosureLabel}</summary>
        {stageTabs}
      </details> : stageTabs}

      {storyLayout ? mobileTools : null}
      {viewControl}

      {/*
        G1-012. The live canvas already refuses to mount below 900px (NARROW_FRAME above), but the
        recording standing in for it is the same four-column composition, and it was being scaled
        to a ~370px frame: 3-4px type, unreadable, the mobile defect the founder photographs first.

        A phone gets the film at the size it was authored for and moves across it instead. The
        frame keeps its height, the recording is sized off that height rather than off the frame's
        width, and `scroll-snap` stops on one pane at a time -- one panel per stage, swipeable, and
        with the tab strip above it unchanged. The four spans below exist only as snap targets: a
        <video> is a single element with nothing inside it to align, they carry no text, and they
        are hidden from assistive technology, which reads the caption instead.

        Above 900px they are `display: none` and the frame does not scroll, so the desktop
        composition is exactly what it was.
      */}
      <div ref={viewportRef} className="compile-film-viewport" role={compact ? undefined : "tabpanel"} id={panelId} tabIndex={compact && !narrow ? -1 : 0} aria-labelledby={compact ? undefined : tabId(active.id)} onScroll={panning ? (event) => {
        const { scrollLeft, scrollWidth } = event.currentTarget;
        setVisiblePane(Math.min(3, Math.round(scrollLeft / (scrollWidth / 4))));
      } : undefined}>
        <div className="compile-film-panes" aria-hidden="true"><span /><span /><span /><span /></div>
        {still ? (() => {
          // eslint-disable-next-line @next/next/no-img-element
          const image = <img
            ref={stillRef}
            className="compile-film-still"
            src={active.poster}
            srcSet={posterSrcSet}
            sizes={posterSrcSet ? posterSizes : undefined}
            width={1440}
            height={900}
            alt={`${active.label} — ${active.line}`}
            /* The landing's poster is the LCP element again (founder decision 2026-09-20), and
               `lib/landing-v2-page.test.ts` holds every image on the entry pages to a declared box
               and an off-main-thread decode. Unconditional: a poster that blocks the parser while
               it decodes costs the same on /film as it does on /. */
            decoding="async"
            fetchPriority={priorityPoster ? "high" : undefined}
            loading={priorityPoster ? "eager" : lazyPoster ? "lazy" : undefined}
            /* A lazy still often has no data at mount; its load reports the format the effect above missed (merge review A1). */
            onLoad={(event) => { if (stillTookAvif(event.currentTarget)) setPosterAvifTaken(true); }}
          />;
          /* D-11: AVIF first, the WebP <img> as the fallback. `display: contents` keeps the <img> the grid item.
             FINAL-SPEC 2026-10-26: ahead of them, a phone pane's own still for a screen below PHONE_PANE_MEDIA. */
          return posterAvifSrcSet || panePoster
            ? <picture className={readingStyles.picture}>
                {panePoster ? <source media={PHONE_PANE_MEDIA} type="image/avif" srcSet={panePoster.phonePosterAvif} /> : null}
                {panePoster?.phonePoster ? <source media={PHONE_PANE_MEDIA} type="image/webp" srcSet={panePoster.phonePoster} /> : null}
                {posterAvifSrcSet ? <source type="image/avif" srcSet={posterAvifSrcSet} sizes={posterSizes} /> : null}
                {image}
              </picture>
            : image;
        })() : live ? (
          <div className="compile-film-live" aria-hidden="true"><LiveFilm /></div>
        ) : (
          /*
            One decoder, one element, and `src` as an attribute rather than `<source>` children.

            The problem this replaces: swapping `<source>` children of a live element does nothing
            on its own -- the browser has already committed to the resource it loaded -- so the
            four cuts shared a frame that only ever played the first one. That was fixed by
            keying the element to the stage, which works, and which is also why the console
            reported `ERR_ABORTED` on `compile-cut-2.mp4` on every advance (BQ-130): React
            unmounted an element with a request in flight, and the browser cancelled the fetch it
            had already partly paid for.

            `src` on the element itself is the version that does both. Setting it re-runs the
            media resource selection algorithm, so the cut really does change; the element
            survives, so nothing is torn down mid-fetch, and there is still exactly one decoder
            open on a phone.
          */
          <video ref={videoRef} className="compile-film-video" src={videoSrc} data-active={1} muted autoPlay playsInline preload="metadata" disablePictureInPicture disableRemotePlayback poster={videoPoster} aria-label={`${active.label} — ${active.line}`} onLoadedMetadata={(event) => { event.currentTarget.playbackRate = Math.max(0.1, playbackRate); }} onLoadedData={() => setFramedSrc(videoSrc)} onEnded={onEnded} onError={() => {
            if (videoSrc === preferredVideoSrc && fallbackVideoSrc) {
              setFailedPreferredSrc(preferredVideoSrc);
              return;
            }
            setVideoError(true);
            setPaused(true);
          }} />
        )}
        {!still && !live && paneHold ? (
          <picture className={readingStyles.picture} data-pane-hold="">
            <source type="image/avif" srcSet={paneHold.phonePosterAvif} />
            <img className="compile-film-still" src={paneHold.phonePoster ?? paneHold.phonePosterAvif} width={684} height={855} alt="" decoding="async" />
          </picture>
        ) : null}
        {still && mask ? (
          <svg className={`compile-film-mask ${readingStyles.mask}`} aria-hidden="true" focusable="false" data-poster-mask={mask.poster} viewBox="0 0 2880 1800" preserveAspectRatio="xMidYMid meet">
            {mask.rects.map(rect => <rect key={`${rect.x}-${rect.y}`} x={rect.x} y={rect.y} width={rect.w} height={rect.h} fill={mask.color} />)}
          </svg>
        ) : null}
        {/* Focus inspection keeps the motion control outside the source pixels. */}
        {!panning ? motionControl : null}
      </div>

      {readingLayer}
      {!storyLayout ? mobileTools : null}

      {compact && videoError ? <p className="compile-film-inline-error" role="status">{text.error}</p> : null}
      {/* Home prints no caption row (FINAL-SPEC 2026-10-26), so a film that cannot play says so here instead: never a silent poster. */}
      {storyLayout && videoError ? <p className="compile-film-inline-error" role="status">{text.errorLong}</p> : null}
      {!storyLayout ? stageCaption : null}
    </div>
  );
}
