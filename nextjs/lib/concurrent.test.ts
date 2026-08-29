/**
 * The ceiling has to hold, and a failure has to stay local to its own item.
 *
 * Both are load-bearing for the upload floor: without the ceiling the transfers queue invisibly in
 * the connection pool and the panels stop updating, and without the isolation one bad scan takes
 * the rest of the batch down with it -- which is exactly what the serial loop used to do.
 */

import { describe, expect, it } from "vitest";
import { runBounded } from "./concurrent";

const defer = () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  return { gate, release };
};

describe("runBounded", () => {
  it("never has more than the ceiling in flight", async () => {
    let live = 0;
    let peak = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);
    const out = await runBounded(items, 3, async (item) => {
      live += 1;
      peak = Math.max(peak, live);
      await Promise.resolve();
      await Promise.resolve();
      live -= 1;
      return item * 2;
    });
    expect(peak).toBe(3);
    expect(out.map((r) => (r.ok ? r.value : null))).toEqual(items.map((i) => i * 2));
  });

  it("actually overlaps rather than running one at a time", async () => {
    const a = defer();
    const b = defer();
    const started: number[] = [];
    const work = runBounded([a, b], 2, async (item, index) => {
      started.push(index);
      await item.gate;
      return index;
    });
    await Promise.resolve();
    // Both are running before either finishes. A serial loop could not produce this.
    expect(started).toEqual([0, 1]);
    b.release();
    a.release();
    expect(await work).toEqual([{ ok: true, value: 0 }, { ok: true, value: 1 }]);
  });

  it("keeps input order even when the work finishes out of order", async () => {
    const out = await runBounded([30, 10, 20], 3, async (ms) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return ms;
    });
    expect(out.map((r) => (r.ok ? r.value : null))).toEqual([30, 10, 20]);
  });

  it("lets the rest of the batch finish when one item throws", async () => {
    const out = await runBounded([1, 2, 3], 2, async (item) => {
      if (item === 2) throw new Error("scan refused");
      return item;
    });
    expect(out[0]).toEqual({ ok: true, value: 1 });
    expect(out[1].ok).toBe(false);
    expect(out[2]).toEqual({ ok: true, value: 3 });
  });

  it("treats a nonsense ceiling as one rather than as none", async () => {
    for (const limit of [0, -4, 0.5, Number.NaN]) {
      const out = await runBounded([1, 2], limit, async (item) => item);
      expect(out.map((r) => (r.ok ? r.value : null))).toEqual([1, 2]);
    }
  });

  it("does nothing, successfully, with nothing to do", async () => {
    expect(await runBounded([], 4, async () => 1)).toEqual([]);
  });
});
