"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { FILM_DURATION } from "@/lib/film-script";
import { COMPILE_STAGES, type CompileStage } from "@/lib/compile-stages";

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
*/
const MOBILE_FOCUS_PANE = [0, 1, 0, 0] as const;

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
    fit: "Fit full frame",
    focusedHint: "Focused view · Swipe or use arrow keys to inspect the frame.",
    fittedHint: "Full frame · Focus details to inspect small type.",
  },
  ko: {
    focus: "세부 내용 확대",
    fit: "전체 화면 보기",
    focusedHint: "확대 보기 · 옆으로 밀거나 방향키로 화면을 살펴보세요.",
    fittedHint: "전체 화면 · 작은 글자는 세부 내용 확대에서 확인하세요.",
  },
} as const;

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
  priorityPoster = false,
  korean = false,
}: {
  stages?: readonly CompileStage[];
  onStageChange?: (stage: CompileStage, index: number) => void;
  /** Use the approved encoded films rather than rerendering a canvas version. */
  preferVideo?: boolean;
  /** Presentation-only acceleration. The source asset remains untouched. */
  playbackRate?: number;
  /** Hide chapter navigation/caption for a single-purpose hero presentation. */
  compact?: boolean;
  /** Mark an above-the-fold poster as the page's priority image without changing its bytes. */
  priorityPoster?: boolean;
  /** BQ-013. Name the controls and the fallback in the page's language. The stage list carries its own. */
  korean?: boolean;
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
  // The single-stage film plays once and stops on its last frame; the control then offers a replay.
  const [ended, setEnded] = useState(false);
  const [saveData, setSaveData] = useState(false);
  const [documentVisible, setDocumentVisible] = useState(true);
  const [mobileFilmFit, setMobileFilmFit] = useState(false);
  const [videoError, setVideoError] = useState(false);
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
  /*
    Route-level compositions may supply a narrowed stage list. Rendering must remain fail-safe if
    that list is temporarily empty or malformed during a server/client boundary transition: a
    missing stage is not allowed to turn a public entry route into a 500. The locked first stage is
    the conservative visual fallback and does not change any source asset.
  */
  const active = stages[index] ?? stages[0] ?? COMPILE_STAGES[0]!;

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const frame = window.matchMedia(NARROW_FRAME);
    const apply = () => setReducedMotion(query.matches);
    const applyFrame = () => setNarrow(frame.matches);
    apply();
    applyFrame();
    query.addEventListener("change", apply);
    frame.addEventListener("change", applyFrame);
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
    };
  }, []);

  useEffect(() => { onStageChange?.(active, index); }, [active, index, onStageChange]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !narrow || mobileFilmFit) return;
    const frame = window.requestAnimationFrame(() => {
      const pane = MOBILE_FOCUS_PANE[index] ?? 0;
      viewport.scrollTo({ left: Math.round((viewport.scrollWidth / 4) * pane), top: 0, behavior: "auto" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [index, mobileFilmFit, narrow]);

  const go = useCallback((next: number) => {
    const wrapped = ((next % stages.length) + stages.length) % stages.length;
    setVideoError(false);
    setIndex(wrapped);
  }, [stages.length]);

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
    const move = (next: number) => {
      event.preventDefault();
      chooseStage(next, true);
    };
    if (event.key === "ArrowRight") move(index + 1);
    if (event.key === "ArrowLeft") move(index - 1);
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
  const control = filmMotionControl({ reducedMotion, saveData, paused, playRequested, ended });
  const preferredVideoSrc = narrow && active.phoneSrc ? active.phoneSrc : active.src;
  const fallbackVideoSrc = narrow
    ? active.fallbackPhoneSrc ?? active.fallbackSrc
    : active.fallbackSrc;
  const videoSrc = failedPreferredSrc === preferredVideoSrc && fallbackVideoSrc
    ? fallbackVideoSrc
    : preferredVideoSrc;

  return (
    /* Below 900px the horizontal gesture pans the film (G1-012), so it may not also change the
       stage -- the tab strip above stays the way to do that. */
    <div className="compile-film-sequence rv" ref={frameRef} {...(narrow ? {} : touchHandlers)} data-film-renderer={live ? "live-canvas" : "video-fallback"} data-video-src={videoSrc} data-video-primary-src={preferredVideoSrc} data-compact={compact ? 1 : 0} data-narrow={narrow ? 1 : 0} data-mobile-view={mobileFilmFit ? "fit" : "focus"} data-mobile-focus-pane={MOBILE_FOCUS_PANE[index] ?? 0}>
      {!compact ? <div className="compile-film-stages" role="tablist" aria-label={text.stages} onKeyDown={onKeyDown}>
        {stages.map((stage, position) => (
          <button key={stage.id} type="button" role="tab" id={tabId(stage.id)} aria-selected={position === index} aria-controls={panelId} tabIndex={position === index ? 0 : -1} data-active={position === index ? 1 : 0} onClick={() => chooseStage(position)}>{stage.label}</button>
        ))}
      </div> : null}

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
      <div ref={viewportRef} className="compile-film-viewport" role={compact ? undefined : "tabpanel"} id={panelId} tabIndex={compact && !narrow ? -1 : 0} aria-labelledby={compact ? undefined : tabId(active.id)}>
        <div className="compile-film-panes" aria-hidden="true"><span /><span /><span /><span /></div>
        {still ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="compile-film-still"
            src={active.poster}
            width={1440}
            height={900}
            alt={`${active.label} — ${active.line}`}
            /* The landing's poster is the LCP element again (founder decision 2026-09-20), and
               `lib/landing-v2-page.test.ts` holds every image on the entry pages to a declared box
               and an off-main-thread decode. Unconditional: a poster that blocks the parser while
               it decodes costs the same on /film as it does on /. */
            decoding="async"
            fetchPriority={priorityPoster ? "high" : undefined}
            loading={priorityPoster ? "eager" : undefined}
          />
        ) : live ? (
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
          <video ref={videoRef} className="compile-film-video" src={videoSrc} data-active={1} muted autoPlay playsInline preload="metadata" disablePictureInPicture disableRemotePlayback poster={active.poster} aria-label={`${active.label} — ${active.line}`} onLoadedMetadata={(event) => { event.currentTarget.playbackRate = Math.max(0.1, playbackRate); }} onEnded={onEnded} onError={() => {
            if (videoSrc === preferredVideoSrc && fallbackVideoSrc) {
              setFailedPreferredSrc(preferredVideoSrc);
              return;
            }
            setVideoError(true);
            setPaused(true);
          }} />
        )}
        {/* Always rendered: the two states that most need it were the two that hid it. */}
        <button
          type="button"
          className="compile-film-motion-control"
          data-control={control}
          aria-label={korean ? FILM_CONTROL_LABEL_KO[control] : FILM_CONTROL_LABEL[control].label}
          aria-pressed={control === "pause"}
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
      </div>

      <div className="compile-film-mobile-tools">
        <button
          type="button"
          className="compile-film-focus-control"
          aria-controls={panelId}
          aria-pressed={!mobileFilmFit}
          onClick={() => setMobileFilmFit(value => !value)}
        >
          {mobileFilmFit
            ? MOBILE_FILM_VIEW[korean ? "ko" : "en"].focus
            : MOBILE_FILM_VIEW[korean ? "ko" : "en"].fit}
        </button>
        <p aria-live="polite">
          {mobileFilmFit
            ? MOBILE_FILM_VIEW[korean ? "ko" : "en"].fittedHint
            : MOBILE_FILM_VIEW[korean ? "ko" : "en"].focusedHint}
        </p>
      </div>

      {compact && videoError ? <p className="compile-film-inline-error" role="status">{text.error}</p> : null}
      {!compact ? <div className="compile-film-caption">
        <p>{videoError ? text.errorLong : active.line}</p>
        {/*
          `data-derived` because both halves of this counter are read rather than typed: the
          position is the player's own index and the total is `stages.length`. The landing's
          figure walk (`e2e/landing-v2.spec.ts`, `lib/landing-v2-page.test.ts`) accepts a digit on
          the entry pages only inside an element that declares it was measured, and contract rule
          4's other half is satisfied too -- the figure is printed with its denominator.
        */}
        <span className="compile-film-progress" aria-hidden="true" data-derived="1">{String(index + 1).padStart(2, "0")} / {String(stages.length).padStart(2, "0")}</span>
      </div> : null}
    </div>
  );
}
