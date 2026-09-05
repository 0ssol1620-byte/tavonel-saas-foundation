"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FILM_DURATION } from "@/lib/film-script";

export type CompileStage = {
  id: string;
  label: string;
  line: string;
  src: string;
  poster: string;
};

/*
  The caption reads the film that is playing, not a generic description of the stage.

  STRUCTURE said "Entities, claims and relations form, each bound to the region that supports
  it." That is true of cut 3, and it is also true of half the site — it describes a static
  result. Cut 3 does something narrower and much harder to claim: it changes one clause in one
  source, shows which documents that clause reaches, and stops. `CHANGED 1 + TOUCHED 3` is on
  screen. The caption now says the part the viewer is actually watching, which is also the part
  a RAG index cannot do. Nothing else about the film changes; the films are locked.
*/
export const COMPILE_STAGES: readonly CompileStage[] = [
  { id: "sources", label: "SOURCES", line: "Files, folders, archives and connected drives arrive together.", src: "/film/compile-cut.mp4", poster: "/film/poster-1.webp" },
  { id: "read", label: "READ", line: "Pages, regions, tables and layout are recovered with their coordinates.", src: "/film/compile-cut-2.mp4", poster: "/film/poster-2.webp" },
  { id: "structure", label: "STRUCTURE", line: "Meaning resolves across sources. Changes propagate only where they matter.", src: "/film/compile-cut-3.mp4", poster: "/film/poster-3.webp" },
  { id: "world", label: "WORLD", line: "One compiled world, read by Ask, search, the API and MCP.", src: "/film/compile-cut-4.mp4", poster: "/film/poster-4.webp" },
] as const;

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

export default function CompileStagePlayer({
  stages = COMPILE_STAGES,
  onStageChange,
}: {
  stages?: readonly CompileStage[];
  onStageChange?: (stage: CompileStage, index: number) => void;
}) {
  const [index, setIndex] = useState(0);
  const [inView, setInView] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [canvasReady, setCanvasReady] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [saveData, setSaveData] = useState(false);
  /*
    The stage the visitor chose, and which the player may not take back from them.

    Auto-advance and manual selection were fighting: tapping STRUCTURE started an 18-second
    clock that moved the strip to WORLD whether or not the reader was still watching. A tab
    press or a swipe holds the stage it selected; the timer is not armed for a held stage.
  */
  const [held, setHeld] = useState<number | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const active = stages[index] ?? stages[0]!;
  const admitted = useMemo(() => new Set([index]), [index]);

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

  const go = useCallback((next: number) => {
    const wrapped = ((next % stages.length) + stages.length) % stages.length;
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

  const cycling = !reducedMotion && inView && held !== index;

  useEffect(() => {
    if (!cycling) return;
    const timer = window.setTimeout(() => go(index + 1), STAGE_MS);
    return () => window.clearTimeout(timer);
  }, [cycling, index, go]);

  const focusStage = useCallback((position: number) => {
    const stage = stages[((position % stages.length) + stages.length) % stages.length];
    if (stage) document.getElementById(`compile-stage-tab-${stage.id}`)?.focus();
  }, [stages]);

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
    if (cycling) { go(index + 1); return; }
    const element = videoRef.current;
    if (!element) return;
    element.currentTime = 0;
    void element.play().catch(() => {});
  }, [cycling, go, index]);

  const LiveFilm = LIVE_FILMS[index] ?? LIVE_FILMS[0];
  const live = canvasReady && !narrow;
  const still = reducedMotion || saveData || !inView;

  return (
    <div className="compile-film-sequence rv" ref={frameRef} {...touchHandlers} data-film-renderer={live ? "live-canvas" : "video-fallback"}>
      <div className="compile-film-stages" role="tablist" aria-label="Compilation stages" onKeyDown={onKeyDown}>
        {stages.map((stage, position) => (
          <button key={stage.id} type="button" role="tab" id={`compile-stage-tab-${stage.id}`} aria-selected={position === index} aria-controls="compile-stage-panel" tabIndex={position === index ? 0 : -1} data-active={position === index ? 1 : 0} onClick={() => chooseStage(position)}>{stage.label}</button>
        ))}
      </div>

      <div className="compile-film-viewport" role="tabpanel" id="compile-stage-panel" tabIndex={0} aria-labelledby={`compile-stage-tab-${active.id}`}>
        {still ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="compile-film-still" src={active.poster} width={1440} height={900} alt={`${active.label} — ${active.line}`} />
        ) : live ? (
          <div className="compile-film-live" aria-hidden="true"><LiveFilm /></div>
        ) : (
          /*
            One decoder, keyed to the stage that owns it.

            Swapping the <source> children of a live element does nothing on its own -- the
            browser has already committed to the resource it loaded -- so the four cuts shared a
            frame that only ever played the first one. Keying the element to the stage replaces
            it, which is also what keeps exactly one decoder open on a phone.
          */
          <video key={active.id} ref={videoRef} className="compile-film-video" data-active={1} muted autoPlay playsInline preload="metadata" poster={active.poster} aria-label={`${active.label} — ${active.line}`} onEnded={onEnded}>
            {stages.map((stage, position) => admitted.has(position) ? <source key={stage.id} src={stage.src} type="video/mp4" /> : null)}
          </video>
        )}
      </div>

      <div className="compile-film-caption">
        <p>{active.line}</p>
        <span className="compile-film-progress" aria-hidden="true">{String(index + 1).padStart(2, "0")} / {String(stages.length).padStart(2, "0")}</span>
      </div>
    </div>
  );
}
