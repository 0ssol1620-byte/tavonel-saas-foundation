/*
  Motion semantics, as data rather than as scattered CSS durations.

  Blueprint §14.4 gives motion a vocabulary -- fade means appear, tether means provenance, pulse
  means affected, dim means unaffected, settle means the world is stable -- and §58 gives it a
  budget: an object responds in under 100ms, a reveal lands between 250 and 600ms, and only the
  first entry into the stage is allowed to take about a second. Both are asserted in
  `visual-motion.test.ts`, so a duration that drifts out of the budget fails a run instead of
  quietly making the page feel slow.

  Nothing here loops. Every entry is a one-shot transition into a state, which is the same rule
  the rest of the product follows: motion reports a state change or it does not happen.
*/

export type MotionName = "fade" | "tether" | "pulse" | "dim" | "rewrite" | "settle";

export const MOTION: Record<MotionName, { ms: number; meaning: string }> = {
  fade: { ms: 260, meaning: "appear" },
  tether: { ms: 320, meaning: "provenance" },
  pulse: { ms: 560, meaning: "affected" },
  dim: { ms: 300, meaning: "unaffected" },
  rewrite: { ms: 420, meaning: "recompiled" },
  settle: { ms: 900, meaning: "stable world" },
};

/** §58: an object must feel selected before a transition is perceptible. */
export const FOCUS_RESPONSE_MS = 90;

/** §58: a reveal is a reveal, not a cutscene. */
export const REVEAL_MIN_MS = 250;
export const REVEAL_MAX_MS = 600;

/** §58: the first entry animation, and the only one allowed to approach a second. */
export const ENTRY_SETTLE_MS = MOTION.settle.ms;

/**
 * When one node of a settling world starts moving.
 *
 * The stagger is spread across the settle budget rather than added to it: the last node begins
 * before `ENTRY_SETTLE_MS` is up, so entering the stage never costs more than the budget no
 * matter how many objects are in focus. Reduced motion has no stagger, because there is nothing
 * to stagger -- the state is applied at once.
 */
export function nodeStagger(index: number, count: number, reduced: boolean): number {
  if (reduced || count <= 1) return 0;
  const span = ENTRY_SETTLE_MS - MOTION.fade.ms;
  return Math.round((span * Math.min(index, count - 1)) / (count - 1));
}
