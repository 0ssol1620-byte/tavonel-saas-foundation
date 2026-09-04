"use client";

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

const STAGE_MS = 5_000;

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

  useEffect(() => {
    if (!inView || reducedMotion) return;
    setAdmitted((current) => (current.has(index) ? current : new Set([...current, index])));
  }, [inView, reducedMotion, index]);

  useEffect(() => {
    if (reducedMotion || !playing || !inView) return;
    const timer = window.setTimeout(() => go(index + 1), STAGE_MS);
    return () => window.clearTimeout(timer);
  }, [reducedMotion, playing, inView, index, go]);

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
  }, [index, playing, inView, reducedMotion, admitted]);

  const focusStage = (position: number) => {
    const stage = stages[((position % stages.length) + stages.length) % stages.length];
    if (stage) document.getElementById(`compile-stage-tab-${stage.id}`)?.focus();
  };

  const chooseStage = useCallback((next: number, moveFocus = false) => {
    setPlaying(true);
    go(next);
    if (moveFocus) focusStage(next);
  }, [go]);

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
            onClick={() => chooseStage(position)}
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
              autoPlay
              playsInline
              preload={admitted.has(position) ? "auto" : "none"}
              poster={stage.poster}
              aria-label={`${stage.label} — ${stage.line}`}
              onPlaying={() => setAdmitted((current) => {
                const next = (position + 1) % stages.length;
                return current.has(next) ? current : new Set([...current, next]);
              })}
            >
              {admitted.has(position) ? <source src={stage.src} type="video/mp4" /> : null}
            </video>
          ))
        )}
        {reducedMotion ? null : (
          <button
            type="button"
            className="compile-film-motion-control"
            aria-label={playing ? "Pause compilation film" : "Resume compilation film"}
            aria-pressed={!playing}
            onClick={() => setPlaying((value) => !value)}
          >
            <span aria-hidden="true">{playing ? "Ⅱ" : "▶"}</span>
          </button>
        )}
      </div>

      <div className="compile-film-caption">
        <p>{active.line}</p>
        <span className="compile-film-progress" aria-hidden="true">{String(index + 1).padStart(2, "0")} / {String(stages.length).padStart(2, "0")}</span>
      </div>
    </div>
  );
}
