import { describe, expect, it } from "vitest";
import { PURPOSES, deriveJourney, parsePurpose, type JourneyInput } from "./workspace-journey";

const base: JourneyInput = {
  customerDataAccess: "open", inventoryState: "ready", documentCount: 0, readyDocumentCount: 0,
  operatorReviewCount: 0, activityCount: 0, hasCandidate: false, candidateNeedsDecision: false,
  collectionReviewRequired: false, reviewCount: 0, activeRevision: null, compileErrorCode: null,
  blockedSourceCount: 0, hasGroundedAnswer: false, hasAiConnection: false,
  purpose: null, libraryAvailable: false,
};
const journey = (o: Partial<JourneyInput> = {}) => deriveJourney({ ...base, ...o });
const byId = (o: Partial<JourneyInput> = {}) => Object.fromEntries(journey(o).map((s) => [s.id, s.state]));

describe("workspace journey", () => {
  it("lists the nine V30 steps in order", () => {
    expect(journey().map((s) => s.id)).toEqual([
      "intent", "source", "preflight", "processing", "organizing", "first-world", "ai-connection", "ongoing", "control",
    ]);
    expect(journey().map((s) => s.step)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("has exactly one current step, the first that is neither done nor unavailable", () => {
    for (const o of [{}, { purpose: "other" as const }, { purpose: "other" as const, documentCount: 3, hasCandidate: true, activeRevision: 1 }]) {
      expect(journey(o).filter((s) => s.state === "current")).toHaveLength(1);
    }
    expect(journey().find((s) => s.state === "current")?.id).toBe("intent");
    expect(journey({ purpose: "knowledge-graph" }).find((s) => s.state === "current")?.id).toBe("source");
  });

  it("marks organizing unavailable, not todo or done, when the library is off", () => {
    expect(byId().organizing).toBe("unavailable");
    expect(byId({ libraryAvailable: true }).organizing).toBe("todo");
    expect(byId({ purpose: "other", documentCount: 1, hasCandidate: true, compileJobState: "ready" }).organizing).toBe("unavailable");
  });

  it("marks nothing done from a compile that has not happened", () => {
    const s = byId({ documentCount: 9 });
    expect(Object.entries(s).filter(([, v]) => v === "done").map(([k]) => k)).toEqual(["source"]);
  });

  it("never completes control and exit", () => {
    const s = byId({ purpose: "other", documentCount: 1, hasCandidate: true, activeRevision: 3, hasAiConnection: true, libraryAvailable: true });
    expect(s.organizing).toBe("current");
    expect(byId({ purpose: "other", documentCount: 1, hasCandidate: true, activeRevision: 3, hasAiConnection: true }).control).toBe("current");
  });

  it("counts purpose other as set, and refuses a stale stored value", () => {
    expect(byId({ purpose: "other" }).intent).toBe("done");
    expect(PURPOSES).toHaveLength(6);
    expect(parsePurpose("retired-niche")).toBeNull();
    expect(parsePurpose(null)).toBeNull();
    expect(byId({ purpose: parsePurpose("retired-niche") }).intent).toBe("current");
  });
});
