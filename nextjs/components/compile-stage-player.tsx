"use client";

/**
 * Scene 03, as one frame instead of four.
 *
 * The four compile cuts used to be stacked vertically inside a single scene. The scene counter
 * said five, but a visitor scrolled past eight screens of film to get through it, watching the
 * same claim restated four times, while four <video> elements competed for bandwidth and — on a
 * phone, which caps concurrent hardware decoders — for decoders. The cuts are good; the reading
 * order was the problem.
 *
 * Now there is one viewport and a stage strip above it. Scrolling through the scene advances the
 * stage, the tabs are clickable, and exactly one video holds a decoder at a time. The other
 * three are not merely paused: their <source> is not in the DOM, so there is no request.
 *
 * `prefers-reduced-motion` gets the four posters and the tab strip, with no video mounted and no
 * timer running. That is the honest reading here: unlike the standalone bands, this player moves
 * on its own — a stage changes under the reader every few seconds without being asked — and
 * automatic transitions are exactly what the setting is about.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type CompileStage = {
  id: string;
  label: string;
  line: string;
  src: string;
  poster: string;
};

export const COMPILE_STAGES: readonly CompileStage[] = [
  {
    id: "sources",
    label: "SOURCES",
    line: "Files, folders, archives and connected drives arrive together.",
    src: "/film/compile-cut.mp4",
    poster: "/film/poster-1.webp",
  },
  {
    id: "read",
    label: "READ",
    line: "Pages, regions, tables and layout are recovered with their coordinates.",
    src: "/film/compile-cut-2.mp4",
    poster: "/film/poster-2.webp",
  },
  {
    id: "structure",
    label: "STRUCTURE",
    line: "Entities, claims and relations form, each bound to the region that supports it.",
    src: "/film/compile-cut-3.mp4",
    poster: "/film/poster-3.webp",
  },
  {
    id: "world",
    label: "WORLD",
    line: "One compiled world, read by Ask, search, the API and MCP.",
    src: "/film/compile-cut-4.mp4",
    poster: "/film/poster-4.webp",
  },
] as const;

/** Long enough to read the frame, short enough that four of them is not a wait. */
const STAGE_MS = 5_500;

export default function CompileStagePlayer({
  stages = COMPILE_STAGES,
  onStageChange,
}: {
  stages?: readonly CompileStage[];
  onStageChange?: (stage: CompileStage, index: number) => void;
}) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [inView, setInView] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  /*
    Which stages may hold a <source>.

    Empty until the scene is actually reached. Admitting stage 0 at mount would put a
    `preload="auto"` video into the initial load for a frame three screens below the fold —
    the same mistake as the high-priority preload link that used to sit in the landing page,
    competing with the fonts for text the visitor can see.

    After that: the active stage, plus every stage already visited, so going back is instant.
    The stage *after* the active one is admitted only once the active one is playing, never
    before — preloading ahead is what gave the old stacked version four parallel downloads.
  */
  const [admitted, setAdmitted] = useState<ReadonlySet<number>>(() => new Set<number>());

  const frameRef = useRef<HTMLDivElement | null>(null);
  const videoRefs = useRef<Array<HTMLVideoElement | null>>([]);

  const active = stages[index] ?? stages[0]!;

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReducedMotion(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  useEffect(() => { onStageChange?.(active, index); }, [active, index, onStageChange]);

  const go = useCallback((next: number) => {
    const wrapped = ((next % stages.length) + stages.length) % stages.length;
    setIndex(wrapped);
    setAdmitted((current) => (current.has(wrapped) ? current : new Set([...current, wrapped])));
  }, [stages.length]);

  // Nothing runs while the scene is off screen. A film advancing in a part of the page nobody
  // is looking at spends a decoder and battery to arrive at a stage the reader did not choose.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(Boolean(entry?.isIntersecting)),
      { threshold: 0.4 },
    );
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  // Reaching the scene is what admits the first film. Nothing is fetched before that.
  useEffect(() => {
    if (!inView || reducedMotion) return;
    setAdmitted((current) => (current.has(index) ? current : new Set([...current, index])));
  }, [inView, reducedMotion, index]);

  useEffect(() => {
    if (reducedMotion || !playing || !inView) return;
    const timer = window.setTimeout(() => go(index + 1), STAGE_MS);
    return () => window.clearTimeout(timer);
  }, [reducedMotion, playing, inView, index, go]);

  /*
    One decoder. Every non-active element is paused and rewound, so returning to a stage starts
    it from the top rather than resuming a loop the reader never saw the beginning of.
  */
  useEffect(() => {
    if (reducedMotion) return;
    videoRefs.current.forEach((video, position) => {
      if (!video) return;
      if (position === index) {
        if (playing && inView) void video.play().catch(() => undefined);
        else video.pause();
      } else {
        video.pause();
        if (video.currentTime > 0) video.currentTime = 0;
      }
    });
  // `admitted` is a dependency because the <source> for a stage lands one render after the
  // stage becomes active. Without it, the only play() call for that stage happens while the
  // element still has no resource, and whether it starts rests on the pending-play-promise
  // path in the spec rather than on anything this component did.
  }, [index, playing, inView, reducedMotion, admitted]);

  /*
    Arrow keys move the selection and the focus together.

    A roving tabindex without focus movement leaves the ring behind on the tab the reader
    started from, so the next Arrow press is measured from a stage they are no longer on. The
    tab ids are derived from the stage id, which is why they are stable enough to focus by
    lookup rather than by holding four more refs.
  */
  const focusStage = (position: number) => {
    const stage = stages[((position % stages.length) + stages.length) % stages.length];
    if (stage) document.getElementById(`compile-stage-tab-${stage.id}`)?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const move = (next: number) => {
      event.preventDefault();
      setPlaying(false);
      go(next);
      focusStage(next);
    };
    if (event.key === "ArrowRight") move(index + 1);
    if (event.key === "ArrowLeft") move(index - 1);
    if (event.key === "Home") move(0);
    if (event.key === "End") move(stages.length - 1);
  };

  // Swipe, because on a phone the tab strip is four narrow targets and the frame is the page.
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
      setPlaying(false);
      go(index + (delta < 0 ? 1 : -1));
    },
  }), [go, index]);

  return (
    <div className="compile-film-sequence rv" ref={frameRef} {...touchHandlers}>
      <div className="compile-film-stages" role="tablist" aria-label="Compilation stages" onKeyDown={onKeyDown}>
        {stages.map((stage, position) => (
          <button
            key={stage.id}
            type="button"
            role="tab"
            id={`compile-stage-tab-${stage.id}`}
            aria-selected={position === index}
            aria-controls="compile-stage-panel"
            tabIndex={position === index ? 0 : -1}
            data-active={position === index ? 1 : 0}
            onClick={() => { setPlaying(false); go(position); }}
          >
            {stage.label}
          </button>
        ))}
      </div>

      <div
        className="compile-film-viewport"
        role="tabpanel"
        id="compile-stage-panel"
        tabIndex={0}
        aria-labelledby={`compile-stage-tab-${active.id}`}
      >
        {reducedMotion ? (
          /*
            The same poster the <video> would show, as a plain <img>.

            next/image is skipped deliberately: these are pre-sized WebP stills shipped from
            /public at the exact aspect the frame reserves, so the optimizer has nothing to do
            but add a request and a layout pass. The width and height keep the box stable.
          */
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="compile-film-still"
            src={active.poster}
            width={1440}
            height={900}
            alt={`${active.label} — ${active.line}`}
          />
        ) : (
          stages.map((stage, position) => (
            <video
              key={stage.id}
              ref={(element) => { videoRefs.current[position] = element; }}
              className="compile-film-video"
              data-active={position === index ? 1 : 0}
              muted
              loop
              playsInline
              preload={admitted.has(position) ? "auto" : "none"}
              poster={stage.poster}
              aria-label={`${stage.label} — ${stage.line}`}
              // The stage after this one becomes eligible only once this one has real frames,
              // so the connection is never split between the film being watched and the next.
              onPlaying={() => setAdmitted((current) => {
                const next = (position + 1) % stages.length;
                return current.has(next) ? current : new Set([...current, next]);
              })}
            >
              {admitted.has(position) ? <source src={stage.src} type="video/mp4" /> : null}
            </video>
          ))
        )}
      </div>

      <div className="compile-film-caption">
        <p>{active.line}</p>
        {reducedMotion ? null : (
          <button type="button" className="compile-film-toggle" onClick={() => setPlaying((value) => !value)}>
            {playing ? "Pause" : "Play"}
          </button>
        )}
      </div>
    </div>
  );
}
