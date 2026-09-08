import { describe, expect, it } from "vitest";
import {
  deriveAttentionItems,
  deriveOnboardingSteps,
  deriveWorkspaceMode,
  deriveWorkspaceState,
  type WorkspaceStateInput,
} from "./workspace-onboarding";

const base: WorkspaceStateInput = {
  inventoryState: "ready",
  documentCount: 0,
  readyDocumentCount: 0,
  operatorReviewCount: 0,
  activityCount: 0,
  hasCandidate: false,
  candidateNeedsDecision: false,
  collectionReviewRequired: false,
  reviewCount: 0,
  activeRevision: null,
  compileErrorCode: null,
  blockedSourceCount: 0,
  hasGroundedAnswer: false,
};

const input = (overrides: Partial<WorkspaceStateInput> = {}): WorkspaceStateInput => ({ ...base, ...overrides });

describe("workspace mode", () => {
  it("never calls an unresolved inventory empty", () => {
    /*
      The flicker in §13.4 is exactly this: `documents === null` scored as zero sources, the
      brand-new hero painted, then the fetch landed and the page collapsed. Neither of the two
      unresolved states may reach `new`.
    */
    expect(deriveWorkspaceMode(input({ inventoryState: "loading" }))).toBe("loading");
    expect(deriveWorkspaceMode(input({ inventoryState: "unavailable" }))).toBe("unavailable");
  });

  it("reaches the first-run hero only from a resolved, genuinely untouched workspace", () => {
    expect(deriveWorkspaceMode(input())).toBe("new");
    expect(deriveWorkspaceMode(input({ documentCount: 1 }))).toBe("returning");
    expect(deriveWorkspaceMode(input({ hasCandidate: true }))).toBe("returning");
    expect(deriveWorkspaceMode(input({ activeRevision: 3 }))).toBe("returning");
    expect(deriveWorkspaceMode(input({ activityCount: 1 }))).toBe("returning");
  });

  it("keeps a returning workspace out of the large intake copy", () => {
    const returning = deriveWorkspaceState(input({ documentCount: 4, readyDocumentCount: 4 }));
    expect(returning.mode).toBe("returning");
    expect(returning.stateTitle).toBe("4 sources are ready to compile.");
    expect(returning.nextAction).toEqual({ label: "Choose sources to compile", surface: "sources" });
  });
});

describe("workspace state", () => {
  it("offers no action while the state is still being read", () => {
    const state = deriveWorkspaceState(input({ inventoryState: "loading" }));
    expect(state.stateTitle).toBe("Reading your workspace state.");
    expect(state.nextAction.surface).toBeUndefined();
    expect(state.nextAction.intent).toBeUndefined();
  });

  it("says so, and offers a retry, when the inventory could not be read", () => {
    const state = deriveWorkspaceState(input({ inventoryState: "unavailable" }));
    expect(state.stateTitle).toBe("Workspace state could not be read.");
    expect(state.stateDescription).toContain("not described as empty or as populated");
    expect(state.nextAction).toEqual({ label: "Retry loading sources", intent: "refresh" });
  });

  it("follows the first-success spine in order", () => {
    expect(deriveWorkspaceState(input()).nextAction).toEqual({ label: "Choose sources", intent: "upload" });
    expect(deriveWorkspaceState(input({ documentCount: 2, readyDocumentCount: 2 })).nextAction.surface).toBe("sources");
    expect(deriveWorkspaceState(input({ hasCandidate: true, candidateNeedsDecision: true })).nextAction)
      .toEqual({ label: "Review candidate", surface: "review" });
    expect(deriveWorkspaceState(input({ hasCandidate: true, activeRevision: 1 })).nextAction)
      .toEqual({ label: "Ask active World", surface: "ask" });
  });

  it("prefers a live run over every other next action", () => {
    const state = deriveWorkspaceState(input({ documentCount: 3, activityCount: 2, activeRevision: 1 }));
    expect(state.stateTitle).toBe("2 sources are becoming a world.");
    expect(state.stateDescription).toContain("does not estimate progress");
  });

  it("does not tell a returning user with nothing readable to build their first World", () => {
    const state = deriveWorkspaceState(input({ documentCount: 2, operatorReviewCount: 2 }));
    expect(state.stateTitle).toBe("No source is ready to compile yet.");
    expect(state.nextAction).toEqual({ label: "Open sources", surface: "sources" });
  });
});

describe("onboarding steps", () => {
  it("derives every step from workspace facts", () => {
    const done = (state: WorkspaceStateInput) =>
      Object.fromEntries(deriveOnboardingSteps(state).map((step) => [step.id, step.done]));

    expect(done(input())).toEqual({ source: false, compile: false, review: false, activate: false, ask: false });
    expect(done(input({
      documentCount: 2,
      hasCandidate: true,
      activeRevision: 1,
      hasGroundedAnswer: true,
    }))).toEqual({ source: true, compile: true, review: true, activate: true, ask: true });
  });

  it("holds Review open while anything is still outstanding", () => {
    const review = (state: Partial<WorkspaceStateInput>) =>
      deriveOnboardingSteps(input({ documentCount: 1, hasCandidate: true, ...state }))
        .find((step) => step.id === "review")!.done;

    expect(review({})).toBe(true);
    expect(review({ collectionReviewRequired: true })).toBe(false);
    expect(review({ operatorReviewCount: 1 })).toBe(false);
    expect(review({ blockedSourceCount: 1 })).toBe(false);
  });

  it("never marks a step done from a compile that has not happened", () => {
    // A dismissed guide is not progress: the steps take no dismissal or "seen it" input at all.
    const steps = deriveOnboardingSteps(input({ documentCount: 9 }));
    expect(steps.filter((step) => step.done).map((step) => step.id)).toEqual(["source"]);
  });
});

describe("attention items", () => {
  it("shows nothing when nothing is blocked", () => {
    expect(deriveAttentionItems(input({ documentCount: 3, hasCandidate: true, activeRevision: 1 }))).toEqual([]);
  });

  it("keeps every blocked state visible at once, each with a written label", () => {
    const items = deriveAttentionItems(input({
      collectionReviewRequired: true,
      reviewCount: 1,
      operatorReviewCount: 2,
      blockedSourceCount: 1,
      compileErrorCode: "COMPILE_CORE_UNAVAILABLE",
    }));
    expect(items.map((item) => item.id)).toEqual(["candidate-review", "operator-review", "refused", "compile-failed"]);
    expect(items.map((item) => item.label)).toEqual(["Review required", "Operator action", "Refused", "Failed"]);
    expect(items[0].detail).toBe("1 review item needs a decision.");
    expect(items[1].detail).toBe("2 sources need review before reading can continue.");
    expect(items[3].detail).toContain("COMPILE_CORE_UNAVAILABLE");
  });

  it("names the singular operator-review case the way the receipt reads", () => {
    const items = deriveAttentionItems(input({ operatorReviewCount: 1 }));
    expect(items[0].detail).toBe("This source needs review before reading can continue.");
  });

  it("reports a review-required candidate even when no reason count came back", () => {
    const items = deriveAttentionItems(input({ collectionReviewRequired: true, reviewCount: 0 }));
    expect(items[0].detail).toBe("The compiled candidate requires review before it can become active.");
  });
});
