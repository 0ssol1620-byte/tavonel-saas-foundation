"use client";

/**
 * Cinematic director clock.
 *
 * SPEC §4.1 and §18.6 impose the rules this hook exists to keep:
 *   - playback time comes from a monotonic clock, never a setTimeout chain
 *   - the director pauses when the tab is hidden or the frame leaves the viewport
 *   - IDLE means still: when nothing is playing, no frame is scheduled at all
 *   - auto-start at most once, and never auto-loop
 *   - reduced motion gets the same argument, not a lesser page
 *
 * "Pause" here stops the presentation clock only. In a live deployment it must not stop event
 * ingestion — the separation is why this hook owns time and nothing else.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { SEQUENCE_DURATION_SECONDS } from "./shots";

export type DirectorMode = "IDLE" | "PLAYING" | "PAUSED" | "ENDED";

export type Director = {
  readonly seconds: number;
  readonly mode: DirectorMode;
  readonly reducedMotion: boolean;
  readonly play: () => void;
  readonly pause: () => void;
  readonly toggle: () => void;
  readonly replay: () => void;
  readonly skipToEnd: () => void;
  readonly seek: (seconds: number) => void;
};

const SEEN_KEY = "tavonel_cinematic_intro_seen";
const SEEN_VALUE = "v2";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function hasSeenIntro(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === SEEN_VALUE;
  } catch {
    return false;
  }
}

function markIntroSeen(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, SEEN_VALUE);
  } catch {
    /* private mode, blocked storage — a returning visitor simply sees the intro again */
  }
}

export function useDirector(stageRef: React.RefObject<HTMLElement | null>): Director {
  const [seconds, setSeconds] = useState(0);
  const [mode, setMode] = useState<DirectorMode>("IDLE");
  const [reducedMotion, setReducedMotion] = useState(false);

  const rafRef = useRef<number | null>(null);
  /** Wall-clock origin such that now - origin === current playback position. */
  const originRef = useRef(0);
  const autoStartedRef = useRef(false);
  const inViewRef = useRef(false);

  const stopFrame = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const tick = useCallback(() => {
    const elapsed = (performance.now() - originRef.current) / 1000;
    if (elapsed >= SEQUENCE_DURATION_SECONDS) {
      setSeconds(SEQUENCE_DURATION_SECONDS);
      setMode("ENDED");
      stopFrame();
      markIntroSeen();
      return;
    }
    setSeconds(elapsed);
    rafRef.current = requestAnimationFrame(tick);
  }, [stopFrame]);

  const playFrom = useCallback(
    (from: number) => {
      originRef.current = performance.now() - from * 1000;
      setMode("PLAYING");
      stopFrame();
      rafRef.current = requestAnimationFrame(tick);
    },
    [stopFrame, tick],
  );

  const play = useCallback(() => {
    const from = seconds >= SEQUENCE_DURATION_SECONDS ? 0 : seconds;
    playFrom(from);
  }, [playFrom, seconds]);

  const pause = useCallback(() => {
    stopFrame();
    setMode((m) => (m === "PLAYING" ? "PAUSED" : m));
  }, [stopFrame]);

  const toggle = useCallback(() => {
    if (mode === "PLAYING") pause();
    else play();
  }, [mode, pause, play]);

  const replay = useCallback(() => {
    setSeconds(0);
    playFrom(0);
  }, [playFrom]);

  /** §8.5 — skip settles on the latest fully valid projection, it does not fast-forward. */
  const skipToEnd = useCallback(() => {
    stopFrame();
    setSeconds(SEQUENCE_DURATION_SECONDS);
    setMode("ENDED");
    markIntroSeen();
  }, [stopFrame]);

  const seek = useCallback(
    (to: number) => {
      const clamped = Math.min(Math.max(to, 0), SEQUENCE_DURATION_SECONDS);
      setSeconds(clamped);
      if (mode === "PLAYING") playFrom(clamped);
    },
    [mode, playFrom],
  );

  // Reduced motion: settle on the finished world rather than animating toward it.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      setReducedMotion(query.matches);
      if (query.matches) {
        stopFrame();
        setSeconds(SEQUENCE_DURATION_SECONDS);
        setMode("ENDED");
      }
    };
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [stopFrame]);

  // A returning visitor is not made to sit through the intro again (§4.1).
  useEffect(() => {
    if (prefersReducedMotion()) return;
    if (hasSeenIntro()) {
      setSeconds(SEQUENCE_DURATION_SECONDS);
      setMode("ENDED");
      autoStartedRef.current = true;
    }
  }, []);

  // Auto-start exactly once, only while the stage is actually on screen.
  useEffect(() => {
    const node = stageRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        inViewRef.current = entry.isIntersecting;
        if (entry.isIntersecting) {
          if (!autoStartedRef.current && !prefersReducedMotion()) {
            autoStartedRef.current = true;
            playFrom(0);
          }
        } else {
          // OFFSCREEN → stop. Not a user pause, so it does not change the label they see.
          stopFrame();
        }
      },
      { threshold: 0.45 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [playFrom, stageRef, stopFrame]);

  // HIDDEN TAB → pause. Resume only if the visitor had it playing.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        stopFrame();
      } else if (mode === "PLAYING" && inViewRef.current) {
        playFrom(seconds);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [mode, playFrom, seconds, stopFrame]);

  useEffect(() => stopFrame, [stopFrame]);

  return { seconds, mode, reducedMotion, play, pause, toggle, replay, skipToEnd, seek };
}
