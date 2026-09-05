"use client";

import { useEffect, useState } from "react";

/**
 * A media query, read after mount.
 *
 * Both callers start `false` and correct on the client, which is the right way round: the server
 * has no media query, and a first paint that guessed would either animate for a reader who asked
 * for stillness or ship the phone composition to a desktop.
 */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(query);
    const sync = () => setMatches(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [query]);
  return matches;
}

/**
 * Whether this reader asked for reduced motion.
 *
 * The CSS blocks in the stage stylesheets are what actually remove the transitions; this exists
 * for the two decisions CSS cannot make -- the per-node entry stagger and whether the tether
 * draws or simply appears.
 */
export function useReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}

/**
 * Whether the stage is laid out as a stacked flow rather than a field.
 *
 * The same breakpoint the stylesheets use. It is read in JS as well because the act machine
 * differs: a wide stage opens an object and its source together, a narrow one walks World →
 * Object → Evidence → Source as separate steps (§57 step 10).
 */
export const NARROW_STAGE_QUERY = "(max-width: 820px)";

export function useNarrowStage(): boolean {
  return useMediaQuery(NARROW_STAGE_QUERY);
}
