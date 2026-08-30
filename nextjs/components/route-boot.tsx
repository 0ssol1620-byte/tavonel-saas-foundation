"use client";

/**
 * D9 -- a route change gets a stamp, not a spinner.
 *
 * Next.js swaps route content the instant it can; there is nothing here to wait for, and this
 * component never delays that swap by a single frame. What it adds is a small monospace readout
 * that appears for a quarter second after `usePathname()` reports a new value and then removes
 * itself -- an instrument confirming a move already happened, in the same voice as the state
 * words along the bottom bar, rather than a loading affordance pretending to gate anything.
 *
 * Excluded on purpose: the "/" <-> "/film" pair, which has its own View Transitions crossfade
 * (canvas-transition-link.tsx) and does not need a second, competing cue on the same click.
 */

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const SILENT = new Set(["/", "/film"]);

export default function RouteBoot() {
  const pathname = usePathname();
  const previous = useRef(pathname);
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    const from = previous.current;
    previous.current = pathname;
    if (from === pathname) return;
    if (SILENT.has(from) && SILENT.has(pathname)) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setTarget(pathname);
    const timer = window.setTimeout(() => setTarget(null), 260);
    return () => window.clearTimeout(timer);
  }, [pathname]);

  if (!target) return null;
  return (
    <div className="route-boot" aria-hidden="true">
      <span className="route-boot-dot" />
      ROUTING &rarr; {target}
    </div>
  );
}
