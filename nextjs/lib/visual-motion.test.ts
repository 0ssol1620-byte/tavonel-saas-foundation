import { describe, expect, it } from "vitest";
import {
  ENTRY_SETTLE_MS,
  FOCUS_RESPONSE_MS,
  MOTION,
  REVEAL_MAX_MS,
  REVEAL_MIN_MS,
  nodeStagger,
} from "./visual-motion";

/*
  §58's interaction budget, asserted rather than remembered.

  A page gets slow one 40ms increase at a time, each of which looks better in isolation. These
  hold the two ends: nothing that is meant to feel immediate may be perceptible, and the whole
  entry -- stagger included -- has to be finished inside its budget no matter how many objects
  the focus rule chose.
*/

describe("the interaction budget", () => {
  it("keeps selection below the threshold where a transition is felt", () => {
    expect(FOCUS_RESPONSE_MS).toBeLessThan(100);
  });

  it("keeps every reveal inside 250-600ms", () => {
    for (const name of ["fade", "tether", "pulse", "dim", "rewrite"] as const) {
      expect(MOTION[name].ms, name).toBeGreaterThanOrEqual(REVEAL_MIN_MS);
      expect(MOTION[name].ms, name).toBeLessThanOrEqual(REVEAL_MAX_MS);
    }
  });

  it("spends at most about a second entering the stage", () => {
    expect(ENTRY_SETTLE_MS).toBeLessThanOrEqual(1000);
  });
});

describe("the entry stagger fits inside the entry", () => {
  it("finishes the last node within the settle budget", () => {
    for (const count of [1, 2, 7, 10, 12, 40]) {
      const last = nodeStagger(count - 1, count, false);
      expect(last + MOTION.fade.ms, `${count} nodes`).toBeLessThanOrEqual(ENTRY_SETTLE_MS);
    }
  });

  it("starts each node no earlier than the one before it", () => {
    const count = 10;
    let previous = -1;
    for (let index = 0; index < count; index += 1) {
      const delay = nodeStagger(index, count, false);
      expect(delay).toBeGreaterThanOrEqual(previous);
      previous = delay;
    }
  });

  it("has nothing to stagger under reduced motion", () => {
    for (let index = 0; index < 12; index += 1) expect(nodeStagger(index, 12, true)).toBe(0);
  });
});
