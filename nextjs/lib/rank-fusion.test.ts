import { describe, expect, it } from "vitest";
import { reciprocalRankFusion, toRankedList } from "./rank-fusion";

describe("reciprocalRankFusion", () => {
  it("ranks an id appearing near the top of two lists above an id appearing in only one", () => {
    const fused = reciprocalRankFusion(
      {
        lexical: [{ id: "a", rank: 1 }, { id: "b", rank: 2 }],
        dense: [{ id: "a", rank: 2 }, { id: "c", rank: 1 }],
      },
      60,
    );
    expect(fused[0].id).toBe("a");
    expect(fused[0].fusedScore).toBeCloseTo(1 / 61 + 1 / 62, 10);
    expect(fused.map((item) => item.id)).toContain("b");
    expect(fused.map((item) => item.id)).toContain("c");
  });

  it("computes the exact RRF formula per list, not a renamed weighted sum of native scores", () => {
    const fused = reciprocalRankFusion({ onlyList: [{ id: "x", rank: 5 }] }, 10);
    expect(fused).toEqual([{ id: "x", fusedScore: 1 / 15, fusedRank: 1, ranks: { onlyList: 5 } }]);
  });

  it("records null for a list that does not contain the id, rather than treating it as rank 0", () => {
    const fused = reciprocalRankFusion(
      { lexical: [{ id: "a", rank: 1 }], dense: [{ id: "b", rank: 1 }] },
      60,
    );
    const a = fused.find((item) => item.id === "a")!;
    expect(a.ranks).toEqual({ lexical: 1, dense: null });
  });

  it("breaks ties deterministically by id when fused scores are equal", () => {
    const fused = reciprocalRankFusion(
      { lexical: [{ id: "z", rank: 1 }, { id: "a", rank: 1 }] },
      60,
    );
    expect(fused.map((item) => item.id)).toEqual(["a", "z"]);
  });

  it("a larger k flattens the score gap between rank 1 and rank 2 of the same list", () => {
    const small = reciprocalRankFusion({ l: [{ id: "a", rank: 1 }, { id: "b", rank: 2 }] }, 1);
    const large = reciprocalRankFusion({ l: [{ id: "a", rank: 1 }, { id: "b", rank: 2 }] }, 1000);
    const gapSmallK = small[0].fusedScore - small[1].fusedScore;
    const gapLargeK = large[0].fusedScore - large[1].fusedScore;
    expect(gapLargeK).toBeLessThan(gapSmallK);
  });

  it("returns an empty result for empty input", () => {
    expect(reciprocalRankFusion({}, 60)).toEqual([]);
  });

  it("rejects a non-positive or non-integer k", () => {
    expect(() => reciprocalRankFusion({ l: [{ id: "a", rank: 1 }] }, 0)).toThrow();
    expect(() => reciprocalRankFusion({ l: [{ id: "a", rank: 1 }] }, 1.5)).toThrow();
  });
});

describe("toRankedList", () => {
  it("assigns 1-based ranks in the order given, dropping the source's native score", () => {
    expect(toRankedList(["c", "a", "b"])).toEqual([
      { id: "c", rank: 1 },
      { id: "a", rank: 2 },
      { id: "b", rank: 3 },
    ]);
  });

  it("returns an empty list for no results", () => {
    expect(toRankedList([])).toEqual([]);
  });
});
