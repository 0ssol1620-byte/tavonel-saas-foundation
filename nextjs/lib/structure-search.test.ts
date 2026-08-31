import { describe, expect, it } from "vitest";
import { rankByStructuralOverlap, type StructureCandidate } from "./structure-search";

describe("rankByStructuralOverlap", () => {
  it("ranks a unit sharing both a seed claim and a seed entity above one sharing only one", () => {
    const candidates: StructureCandidate[] = [
      { unitId: "u-both", claimIds: ["claim-a"], entityIds: ["entity-a"] },
      { unitId: "u-claim-only", claimIds: ["claim-a"], entityIds: [] },
    ];
    const ranked = rankByStructuralOverlap(candidates, { seedClaimIds: ["claim-a"], seedEntityIds: ["entity-a"] });
    expect(ranked).toEqual([
      { id: "u-both", rank: 1 },
      { id: "u-claim-only", rank: 2 },
    ]);
  });

  it("drops a unit with zero overlap entirely rather than ranking it last with a zero score", () => {
    const candidates: StructureCandidate[] = [
      { unitId: "u-related", claimIds: ["claim-a"], entityIds: [] },
      { unitId: "u-unrelated", claimIds: ["claim-z"], entityIds: ["entity-z"] },
    ];
    const ranked = rankByStructuralOverlap(candidates, { seedClaimIds: ["claim-a"], seedEntityIds: [] });
    expect(ranked).toEqual([{ id: "u-related", rank: 1 }]);
  });

  it("breaks ties deterministically by unit id", () => {
    const candidates: StructureCandidate[] = [
      { unitId: "u-z", claimIds: ["claim-a"], entityIds: [] },
      { unitId: "u-a", claimIds: ["claim-a"], entityIds: [] },
    ];
    const ranked = rankByStructuralOverlap(candidates, { seedClaimIds: ["claim-a"], seedEntityIds: [] });
    expect(ranked.map((item) => item.id)).toEqual(["u-a", "u-z"]);
  });

  it("returns an empty list when there are no seed ids at all", () => {
    const candidates: StructureCandidate[] = [{ unitId: "u-1", claimIds: ["claim-a"], entityIds: [] }];
    expect(rankByStructuralOverlap(candidates, { seedClaimIds: [], seedEntityIds: [] })).toEqual([]);
  });

  it("returns an empty list for no candidates", () => {
    expect(rankByStructuralOverlap([], { seedClaimIds: ["claim-a"], seedEntityIds: [] })).toEqual([]);
  });
});
