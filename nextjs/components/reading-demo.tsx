"use client";

/**
 * B5 -- the reading, on the page that has to earn the sign-in.
 *
 * The workspace has always been able to show a document being read while it is being read. The
 * landing page could only claim it, and the claim is the least convincing form of the best thing
 * this product does. This renders the same `ReadingView` the workspace renders, with no demo
 * mode and no alternate markup, driven by the declared fixture in `lib/demo-reading`.
 *
 * A region at a time, because that is how reports actually arrive. Under reduced motion the page
 * is drawn complete rather than quickly -- the finished state, not a faster animation.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import ReadingView from "@/components/reading-view";
import { CHANGE } from "@/lib/demo-world";
import { DEMO_REGION_COUNT, demoProgress } from "@/lib/demo-reading";

/** Slow enough to watch a line appear, fast enough that the page finishes inside a scroll. */
const REGION_MS = 190;

export default function ReadingDemo({ active }: { active: boolean }) {
  const [revealed, setRevealed] = useState(0);
  const timers = useRef<number[]>([]);
  const played = useRef(false);

  const clear = () => {
    for (const timer of timers.current) window.clearTimeout(timer);
    timers.current = [];
  };

  const play = useCallback(() => {
    clear();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setRevealed(DEMO_REGION_COUNT);
      return;
    }
    setRevealed(0);
    for (let i = 1; i <= DEMO_REGION_COUNT; i += 1) {
      timers.current.push(window.setTimeout(() => setRevealed(i), i * REGION_MS));
    }
  }, []);

  useEffect(() => {
    if (!active || played.current) return;
    played.current = true;
    play();
  }, [active, play]);

  useEffect(() => clear, []);

  return (
    <div className="panel rv">
      <div className="panel-head">
        <span>reading {CHANGE.document}</span>
        <button className="mini" onClick={play} type="button">
          Run again
        </button>
      </div>
      <ReadingView progress={demoProgress(revealed)} />
    </div>
  );
}
