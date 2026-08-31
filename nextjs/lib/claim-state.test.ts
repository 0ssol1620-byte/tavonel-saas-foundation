import { describe, expect, it } from "vitest";
import {
  AFFIRMATIVE_CLAIM_STATES,
  CLAIM_STATE,
  claimState,
  isQualifiedClaim,
} from "./claim-state";

describe("claim-state vocabulary", () => {
  it("keeps one exact label for every cross-product state", () => {
    expect(Object.fromEntries(Object.entries(CLAIM_STATE).map(([key, value]) => [key, value.label]))).toEqual({
      qualified: "QUALIFIED",
      demonstrated: "DEMONSTRATED",
      research: "RESEARCH FRONTIER",
      humanGate: "HUMAN GATE",
      blocked: "BLOCKED",
      unknown: "STATUS UNKNOWN",
    });
  });

  it("treats only qualified evidence as affirmative", () => {
    expect(AFFIRMATIVE_CLAIM_STATES).toEqual(["qualified"]);
    expect(isQualifiedClaim("qualified")).toBe(true);
    expect(isQualifiedClaim("demonstrated")).toBe(false);
    expect(isQualifiedClaim("research")).toBe(false);
    expect(isQualifiedClaim("humanGate")).toBe(false);
    expect(isQualifiedClaim("blocked")).toBe(false);
    expect(isQualifiedClaim("unknown")).toBe(false);
  });

  it("returns immutable vocabulary entries without inventing fallback states", () => {
    expect(claimState("research")).toBe(CLAIM_STATE.research);
    expect(claimState("unknown").meaning).toContain("never treated as available");
  });
});
