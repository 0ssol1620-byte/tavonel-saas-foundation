"use client";

/** Scene tracking, reveal and a native-scroll snap marker for the cinematic landing page. */
import { useEffect, useState } from "react";

export function useScrollScenes(sceneCount: number) {
  const [scene, setScene] = useState(1);
  const [band, setBand] = useState("scatter");

  useEffect(() => {
    document.documentElement.classList.add("js", "landing-scroll");

    const revealAll = () => {
      document.querySelectorAll(".rv").forEach((element) => element.classList.add("in"));
    };

    if (typeof IntersectionObserver === "undefined") {
      revealAll();
      return () => document.documentElement.classList.remove("landing-scroll");
    }

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

    let attached = false;
    const check = window.setTimeout(() => {
      if (!attached) revealAll();
    }, 3000);
    attached = sections.length > 0;

    return () => {
      document.documentElement.classList.remove("landing-scroll");
      window.clearTimeout(check);
      sceneObserver.disconnect();
      bandObserver.disconnect();
      revealObserver.disconnect();
    };
  }, [sceneCount]);

  return { scene, band };
}

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
