"use client";

import dynamic from "next/dynamic";
import { preload } from "react-dom";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { FILM_DURATION } from "@/lib/film-script";
import styles from "./hero-compile-tabs.module.css";

/*
  The hero film, 2026-11-10 (founder variant A): the four locked cuts -- Extract, Link, Update, Use -- in the site's light
  tone, each node coloured by the source document its entity came from and the ring's centre filled with the entities
  several documents resolve to (lib/film-tone.ts). One slot, four tabs. The drop zone above it stays the hero's action
  (CLAUDE.md G-C); this only surrounds it.

  What plays where:
  - >= 900px, motion allowed: the cut's live canvas, mounted once the slot is in view, the next cut's chunk prefetched.
  - < 900px, motion allowed: the same desktop cut as a pre-rendered video at full width (founder 2026-11-10: the 4:5
    phone composition read as missing content). No live canvas below ~900px (the founder's phone rule).
  - reduced motion, Save-Data or prefers-reduced-data: the cut's poster, no autoplay, until the visitor presses Play
    (the phone's cut is 0.2-1.4 MB of video); the tabs still switch.
  The tabs autoplay the four cuts in order, one FILM_DURATION each, with a progress bar in the active tab. A click, an
  arrow key, or keyboard focus entering the tablist stops the rotation (the APG carousel rule): the chosen cut plays to
  its end once and holds there. Playback also pauses while the slot is offscreen or the document is hidden.

  WCAG 2.2.2 (PR #235 review R1, B1; the precedent is compile-stage-player.tsx's motion control): Pause / Play beside
  the tabs. Pausing takes the reduced-motion path -- the poster, no advance, playing=false -- rather than a second
  mechanism per renderer, because the wide renderer is a canvas rAF loop with no pause() to call.

  Posters and videos are frames of these same components, captured from their own clock (scripts/film/hero-tabs.mjs).
*/

const FILM_PROPS = { tone: "light", compiled: true } as const;
const loaders = [
  () => import("@/components/opening-film"),
  () => import("@/components/opening-film-2"),
  () => import("@/components/opening-film-3"),
  () => import("@/components/opening-film-4"),
] as const;
const FILMS = loaders.map((load) => dynamic(load, { ssr: false }));

export const HERO_TABS = [
  { id: "extract", label: "Extract", ko: "추출" },
  { id: "link", label: "Link", ko: "연결" },
  { id: "update", label: "Update", ko: "업데이트" },
  { id: "use", label: "Use", ko: "사용" },
] as const;

/** Poster (the cut's resolved frame) and phone video for tab `n` (1-based). */
export const heroTabMedia = (n: number) => ({
  poster: `/film/hero-tab-${n}.webp`,
  poster2x: `/film/hero-tab-${n}-2x.webp`,
  posterAvif: `/film/hero-tab-${n}.avif`,
  posterAvif2x: `/film/hero-tab-${n}-2x.avif`,
  video: `/film/hero-tab-${n}.mp4`,
});

type Mode = "poster" | "canvas" | "video";
const WIDE = "(min-width: 900px)";
const POSTER_SIZES = "(min-width: 1280px) 1200px, 100vw";
const REDUCED = "(prefers-reduced-motion: reduce)";
const REDUCED_DATA = "(prefers-reduced-data: reduce)";

export default function HeroCompileTabs({ korean = false }: { korean?: boolean }) {
  const base = useId();
  const [active, setActive] = useState(0);
  const [auto, setAuto] = useState(true);
  const [wide, setWide] = useState(false);
  // Until the effect below has read the preferences the slot is the poster: server render and first paint agree.
  const [hold, setHold] = useState(true);
  const [paused, setPaused] = useState(false);
  // Only the control lifts a reduced-motion or Save-Data hold; nothing else overrides the visitor's preference.
  const [playRequested, setPlayRequested] = useState(false);
  const [inView, setInView] = useState(false);
  const [visible, setVisible] = useState(true);
  const [seen, setSeen] = useState(false);
  // A new key restarts the progress bar (and the video) when the same tab plays again.
  const [round, setRound] = useState(0);
  const rootRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const tabsRef = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    const wideQuery = window.matchMedia(WIDE);
    const reduced = window.matchMedia(REDUCED);
    const reducedData = window.matchMedia(REDUCED_DATA);
    const saveData = Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData);
    const pick = () => { setWide(wideQuery.matches); setHold(reduced.matches || reducedData.matches || saveData); };
    pick();
    wideQuery.addEventListener("change", pick);
    reduced.addEventListener("change", pick);
    const onVisibility = () => setVisible(document.visibilityState === "visible");
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    const root = rootRef.current;
    const observer = root ? new IntersectionObserver(([entry]) => setInView(Boolean(entry?.isIntersecting)), { threshold: 0.2 }) : null;
    if (root) observer?.observe(root);
    return () => {
      wideQuery.removeEventListener("change", pick);
      reduced.removeEventListener("change", pick);
      document.removeEventListener("visibilitychange", onVisibility);
      observer?.disconnect();
    };
  }, []);

  useEffect(() => { if (inView) setSeen(true); }, [inView]);

  const still = paused || (hold && !playRequested);
  const mode: Mode = still ? "poster" : wide ? "canvas" : "video";
  const playing = mode !== "poster" && inView && visible;
  // The canvas mounts lazily: not before the slot has been in view once.
  const live = mode === "canvas" && seen;

  // While a cut plays, fetch the next one: its chunk on a wide screen, its poster on a phone.
  useEffect(() => {
    if (!playing) return;
    const next = (active + 1) % FILMS.length;
    if (mode === "canvas") void loaders[next]().catch(() => undefined);
    else { const still = new Image(); still.src = heroTabMedia(next + 1).poster; }
  }, [active, mode, playing]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (playing) void video.play().catch(() => undefined);
    else video.pause();
  }, [playing, active, round, mode]);

  // A held cut (chosen, or the tablist has focus) plays once and stops on its last frame, which the poster is.
  const advance = useCallback(() => {
    if (!auto) { setPaused(true); return; }
    setActive((a) => (a + 1) % FILMS.length);
    setRound((r) => r + 1);
  }, [auto]);

  // Choosing a tab asks for that cut, so it plays (unless a reduced-motion or Save-Data hold stands); it does not rotate on.
  const choose = (index: number) => {
    setAuto(false);
    setPaused(false);
    setActive(index);
    setRound((r) => r + 1);
  };

  const toggleMotion = () => {
    if (still) { setPaused(false); setPlayRequested(true); setRound((r) => r + 1); }
    else setPaused(true);
  };
  const motionLabel = still
    ? korean ? "컴파일 영상 재생" : "Play the compile film"
    : korean ? "컴파일 영상 일시정지" : "Pause the compile film";

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = HERO_TABS.length - 1;
    const next = event.key === "ArrowRight" ? (active === last ? 0 : active + 1)
      : event.key === "ArrowLeft" ? (active === 0 ? last : active - 1)
      : event.key === "Home" ? 0
      : event.key === "End" ? last
      : -1;
    if (next < 0) return;
    event.preventDefault();
    choose(next);
    tabsRef.current[next]?.focus();
  };

  // The first poster is the first screen's priority image; the hint carries the same srcset, AVIF first.
  const first = heroTabMedia(1);
  preload(first.posterAvif, { as: "image", type: "image/avif", fetchPriority: "high", imageSrcSet: `${first.posterAvif} 1440w, ${first.posterAvif2x} 2880w`, imageSizes: POSTER_SIZES });
  const Film = FILMS[active]!;
  const media = heroTabMedia(active + 1);
  const panelId = `${base}-panel`;
  return (
    <figure ref={rootRef} className={styles.tabs} data-testid="hero-compile-tabs" data-mode={mode} data-playing={playing ? "1" : "0"}>
      <div role="tablist" aria-label={korean ? "컴파일 과정" : "How a compile runs"} className={styles.list} onKeyDown={onKeyDown}
        onFocus={() => setAuto(false)}>
        {HERO_TABS.map((tab, index) => {
          const on = index === active;
          return (
            <button
              key={tab.id}
              ref={(el) => { tabsRef.current[index] = el; }}
              type="button"
              role="tab"
              id={`${base}-tab-${index}`}
              aria-selected={on}
              aria-controls={panelId}
              tabIndex={on ? 0 : -1}
              className={styles.tab}
              onClick={() => choose(index)}
            >
              <span>{korean ? tab.ko : tab.label}</span>
              <span className={styles.track} aria-hidden="true">
                {on && mode !== "poster" ? (
                  <span
                    key={round}
                    className={styles.fill}
                    style={{ animationDuration: `${FILM_DURATION}s`, animationPlayState: playing ? "running" : "paused" }}
                    // The canvas is driven by this clock; a phone's video ends on its own (onEnded below).
                    onAnimationEnd={mode === "canvas" ? advance : undefined}
                  />
                ) : on ? <span className={styles.fillStatic} /> : null}
              </span>
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={panelId} aria-labelledby={`${base}-tab-${active}`} className={styles.stage}>
        <picture>
          <source type="image/avif" srcSet={`${media.posterAvif} 1440w, ${media.posterAvif2x} 2880w`} sizes={POSTER_SIZES} />
          <img
            className={styles.poster}
            src={media.poster}
            srcSet={`${media.poster} 1440w, ${media.poster2x} 2880w`}
            sizes={POSTER_SIZES}
            width={1440}
            height={900}
            alt={korean ? "TAVONEL 컴파일 화면 예시" : "A TAVONEL compile: sources, Markdown, ontology and the knowledge graph"}
            loading="eager"
            fetchPriority={active === 0 ? "high" : "auto"}
            decoding="async"
          />
        </picture>
        {live ? <div className={styles.live}><Film key={`${active}-${round}`} {...FILM_PROPS} playing={playing} /></div> : null}
        <button type="button" className={styles.motion} onClick={toggleMotion} aria-label={motionLabel}
          data-motion-control={still ? "play" : "pause"}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
            {still ? <path d="M2.5 1.5v9l7.5-4.5z" fill="currentColor" /> : <path d="M2.5 1.5h2.5v9H2.5zM7 1.5h2.5v9H7z" fill="currentColor" />}
          </svg>
        </button>
        {mode === "video" ? (
          <video
            key={`${active}-${round}`}
            ref={videoRef}
            className={styles.video}
            src={media.video}
            poster={media.poster}
            muted
            playsInline
            preload="metadata"
            onEnded={advance}
            aria-hidden="true"
          />
        ) : null}
      </div>
      <figcaption className={styles.caption}>{korean ? "제품 흐름 예시 · 고객 결과가 아닙니다." : "Illustrative demo · not customer results."}</figcaption>
    </figure>
  );
}
