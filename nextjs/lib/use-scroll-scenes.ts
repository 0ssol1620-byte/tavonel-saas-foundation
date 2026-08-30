"use client";

/**
 * Scene tracking and reveal, for a page that is one continuous world rather than a stack of
 * sections.
 *
 * Two observers, deliberately separate. The scene observer picks whichever section owns the
 * middle band of the viewport and reports it, which drives the canvas mode, the rail and the
 * instrument bar. The reveal observer fires once per element and never again -- content that
 * has been read should not fade back out when it scrolls away.
 *
 * The reveal is opt-in from the client: `.rv` is hidden only under `html.js`, and that class is
 * added here. If this module never runs -- an old browser, a bundle that failed, a thrown error
 * upstream -- the page renders complete and static instead of blank. That failure mode is not
 * hypothetical; an earlier build of this design shipped with everything below the hero
 * invisible because one script threw before the observers attached.
 */

import { useEffect, useState } from "react";

/**
 * B1 -- what a reader counts and what the world behind them does are two different rhythms.
 *
 * They used to be one. Every numbered scene owned exactly one state of the canvas, so shortening
 * the page by merging two scenes would have thrown away one of the six states the field can be
 * in -- which is the page's best asset, not its packaging. Splitting the two lets a single
 * numbered scene move the world twice: `data-scene` is what the rail, the eyebrow and the
 * instrument bar count, `data-band` is what the field, the state pill and the version read.
 */
export function useScrollScenes(sceneCount: number) {
  const [scene, setScene] = useState(1);
  const [band, setBand] = useState("scatter");

  useEffect(() => {
    document.documentElement.classList.add("js");

    const revealAll = () => {
      document.querySelectorAll(".rv").forEach((element) => element.classList.add("in"));
    };

    if (typeof IntersectionObserver === "undefined") {
      revealAll();
      return;
    }

    /** Whichever element of a kind owns the middle band of the viewport wins. */
    const pick = (entries: IntersectionObserverEntry[]) => {
      let best: IntersectionObserverEntry | null = null;
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        if (!best || entry.intersectionRatio > best.intersectionRatio) best = entry;
      }
      return best;
    };
    const middleBand = { rootMargin: "-42% 0px -42% 0px", threshold: [0, 0.01, 0.5, 1] };

    const sections = Array.from(document.querySelectorAll<HTMLElement>("[data-scene]"));
    const sceneObserver = new IntersectionObserver((entries) => {
      const best = pick(entries);
      if (best) setScene(Number(best.target.getAttribute("data-scene")));
    }, middleBand);
    for (const section of sections) sceneObserver.observe(section);

    const bandObserver = new IntersectionObserver((entries) => {
      const best = pick(entries);
      const name = best?.target.getAttribute("data-band");
      if (name) setBand(name);
    }, middleBand);
    for (const element of document.querySelectorAll("[data-band]")) bandObserver.observe(element);

    const revealObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("in");
          revealObserver.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.08 },
    );
    for (const element of document.querySelectorAll(".rv")) revealObserver.observe(element);

    // Failsafe, deliberately conditional. An unconditional timer would quietly destroy the
    // scroll choreography for anyone who pauses near the top -- a fix that hides its own bug.
    let attached = false;
    const check = window.setTimeout(() => {
      if (!attached) revealAll();
    }, 3000);
    attached = sections.length > 0;

    return () => {
      window.clearTimeout(check);
      sceneObserver.disconnect();
      bandObserver.disconnect();
      revealObserver.disconnect();
    };
  }, [sceneCount]);

  return { scene, band };
}

/** Scroll progress 0..1, for the meter along the top of the instrument bar. */
export function useScrollProgress() {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(() => {
        const max = document.body.scrollHeight - window.innerHeight;
        setProgress(max > 0 ? Math.min(1, window.scrollY / max) : 0);
        ticking = false;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return progress;
}
