"use client";

/**
 * One queue, so the films load in the order a visitor meets them.
 *
 * Measured on a cold 1.6Mbps connection, cuts 3 and 4 began downloading 1ms after the hero —
 * both a full screen or more below the fold, both sharing the pipe with the only film anyone
 * was looking at. The hero's first frame landed at 6.5s. The cause was a 1400px rootMargin,
 * chosen so a band would already be running by the time it was scrolled to, which at page load
 * happens to reach almost every band at once.
 *
 * The margin is worth keeping — it is what stops a band being a black rectangle on arrival.
 * What has to change is that a band below the fold may not compete with the one on screen. So
 * a band asks to load rather than loading, the queue admits them strictly in document order,
 * and a band is admitted only once the ones above it are playing (or have given up).
 *
 * A gate rather than a scheduler: no timers, no bandwidth estimation. The queue is released by
 * the thing that actually matters — the film above it reaching `playing`.
 */

type Waiter = { index: number; start: () => void };

const waiting: Waiter[] = [];
/** Indices that have been let through. A band is never admitted twice. */
const admitted = new Set<number>();
/** Indices that have reported first frame, or failed. Both unblock what is below them. */
const settled = new Set<number>();

/** The lowest index that has asked to load but has not yet been let through. */
function nextIndex(): number | null {
  if (waiting.length === 0) return null;
  return waiting.reduce((low, w) => (w.index < low ? w.index : low), Number.POSITIVE_INFINITY);
}

/**
 * Admit whatever is now allowed to load.
 *
 * A band may start when every earlier band that wants to load has settled. The hero has nothing
 * above it, so it starts immediately; the next cut waits for the hero's first frame rather than
 * for a guessed delay.
 */
function pump() {
  const index = nextIndex();
  if (index === null) return;
  const blockedBy = [...admitted].some((i) => i < index && !settled.has(i));
  if (blockedBy) return;
  const at = waiting.findIndex((w) => w.index === index);
  if (at < 0) return;
  const [waiter] = waiting.splice(at, 1);
  admitted.add(waiter.index);
  waiter.start();
}

/**
 * Ask to load. Returns a cancel function for React cleanup.
 *
 * The hero is admitted at once — nothing is above it — but it still goes through the queue so
 * that its index is registered as in-flight. Skipping it let the next band through while the
 * hero was still downloading, which is the contention this queue exists to prevent.
 */
export function requestLoad(index: number, start: () => void): () => void {
  if (admitted.has(index)) {
    start();
    return () => undefined;
  }
  waiting.push({ index, start });
  pump();
  return () => {
    const at = waiting.findIndex((w) => w.index === index);
    if (at >= 0) waiting.splice(at, 1);
  };
}

/**
 * Report that a band is playing, or that it failed.
 *
 * Failure settles too: a cut that cannot decode must not hold up the rest of the page.
 */
export function settle(index: number) {
  settled.add(index);
  pump();
}

/*
  Only one film runs at a time.

  A phone caps how many hardware video decoders exist simultaneously, and four 18s cuts at once
  starves whichever one the reader is actually looking at — measured on a throttled phone as
  readyState 2 on the visible band while three off-screen films held decoders. Desktop hid this
  because it has the headroom to get away with it.

  So visibility is a competition rather than a broadcast: each band reports how much of it is on
  screen, and only the leader plays. Everything else pauses and holds its position, ready to
  resume the moment it wins.
*/
type Player = { ratio: number; play: () => void; pause: () => void };
const players = new Map<number, Player>();

export function registerPlayer(index: number, player: Omit<Player, "ratio">) {
  /*
    Re-registering keeps the band's last known visibility.

    A band re-registers whenever its effect re-runs — notably the moment the queue admits it and
    its <source> appears. Resetting `ratio` to 0 there meant a band that filled the screen was
    ranked as invisible, so the coordinator left a band nobody could see playing and paused the
    one being read. Measured as share=1 with paused=true.
  */
  const previous = players.get(index)?.ratio ?? 0;
  const entry = { ...player, ratio: previous };
  players.set(index, entry);
  // A newly admitted band may already be the most visible one, so settle the contest now
  // rather than waiting for the next scroll event to arrive.
  if (previous > 0) setVisibility(index, previous);
  // Only remove this registration, never a newer one that replaced it: React runs the next
  // effect's setup before the previous cleanup in some orders, and deleting unconditionally
  // would drop a live band from the contest entirely.
  return () => { if (players.get(index) === entry) players.delete(index); };
}

/** A band's share of the viewport changed; recompute who should be running. */
export function setVisibility(index: number, ratio: number) {
  const player = players.get(index);
  if (!player) return;
  player.ratio = ratio;

  // The most-visible band wins; ties go to the one higher up the page, which is the one being
  // read into. Iterating in index order means a later band must strictly beat the leader.
  let leader: number | null = null;
  let best = 0;
  for (const i of [...players.keys()].sort((a, b) => a - b)) {
    const p = players.get(i);
    if (p && p.ratio > best) { best = p.ratio; leader = i; }
  }
  for (const [i, p] of players) {
    if (i === leader) p.play();
    else p.pause();
  }
}
