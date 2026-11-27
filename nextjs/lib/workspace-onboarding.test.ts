import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PER_FILE_LIMIT_SENTENCE } from "./compile-limits";
import {
  aiLastRequestSentence,
  deriveAttentionItems,
  deriveOnboardingSteps,
  deriveWorkspaceMode,
  deriveWorkspaceState,
  judgeTrialSelection,
  lastAiRequest,
  trialAllowanceLine,
  type WorkspaceStateInput,
} from "./workspace-onboarding";
import { failureSentence } from "./workspace-failure-copy";

const base: WorkspaceStateInput = {
  customerDataAccess: "open",
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
  hasAiConnection: false,
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

  /*
    Hotfix 2026-11-10. A first sign-in that has not accepted the processing terms has no trial, so
    /api/documents refuses it 402 SUBSCRIPTION_REQUIRED. That is an access state, and the terms
    step must render, not the load error. Everything else that fails stays `unavailable`.
  */
  it("renders the access step, not the load error, for a pre-terms inventory refusal", () => {
    for (const code of ["SUBSCRIPTION_REQUIRED", "CUSTOMER_DATA_NOT_ENABLED_FOR_WORKSPACE"]) {
      for (const sourcePending of ["terms_acceptance_required", "release_pending", "workspace_refused"]) {
        expect(deriveWorkspaceMode(input({ inventoryState: "unavailable", inventoryRefusalCode: code, customerDataAccess: "closed", sourcePending }))).toBe("source_pending");
      }
      const view = deriveWorkspaceState(input({ inventoryState: "unavailable", inventoryRefusalCode: code, customerDataAccess: "closed", sourcePending: "terms_acceptance_required" }));
      expect(view.mode).toBe("source_pending");
      expect(view.stateTitle).not.toMatch(/could not be loaded/);
      expect(view.nextAction.intent).toBeUndefined();
      // Until access is read, wait rather than flash the error.
      expect(deriveWorkspaceMode(input({ inventoryState: "unavailable", inventoryRefusalCode: code, customerDataAccess: "checking" }))).toBe("loading");
    }
  });

  /*
    REVIEW-PR227-R1 B1. Terms accepted, no plan or trial (lapsed, expired, exhausted, device reused):
    bootstrap answers ACCESS_READY_NO_ENTITLEMENT, closed with no reason, and the inventory is 402.
    That is a plan state with a route to pay, never the first-run access step.
  */
  it("sends a closed workspace with no gate reason and a 402 inventory to the plan state, not the terms step", () => {
    for (const sourcePending of [undefined, null, "legacy"]) {
      const view = deriveWorkspaceState(input({ inventoryState: "unavailable", inventoryRefusalCode: "SUBSCRIPTION_REQUIRED", customerDataAccess: "closed", sourcePending }));
      expect(view.mode).toBe("plan_required");
      expect(view.stateTitle).toBe("This workspace has no active plan.");
      expect(view.stateDescription).toContain("Choose a plan");
    }
    // Without a reason, a gate refusal is not a plan state either: nothing to buy names it.
    expect(deriveWorkspaceMode(input({ inventoryState: "unavailable", inventoryRefusalCode: "CUSTOMER_DATA_NOT_ENABLED_FOR_WORKSPACE", customerDataAccess: "closed" }))).toBe("unavailable");
  });

  it("keeps a genuine load failure unavailable", () => {
    const closed = { inventoryState: "unavailable", customerDataAccess: "closed", sourcePending: "terms_acceptance_required" } as const;
    // 5xx store and signer failures, an expired session, a network failure (no code).
    for (const code of ["SIGNER_NOT_CONFIGURED", "BILLING_STORE_READ_FAILED", "AUTH_REQUIRED", "AUTHORIZATION_CHANGED_RETRY", null]) {
      expect(deriveWorkspaceMode(input({ ...closed, inventoryRefusalCode: code }))).toBe("unavailable");
    }
    // A refusal code while access is open, or unverifiable, is not an access step either.
    expect(deriveWorkspaceMode(input({ inventoryState: "unavailable", inventoryRefusalCode: "SUBSCRIPTION_REQUIRED", customerDataAccess: "open" }))).toBe("unavailable");
    expect(deriveWorkspaceMode(input({ inventoryState: "unavailable", inventoryRefusalCode: "SUBSCRIPTION_REQUIRED", customerDataAccess: "unavailable" }))).toBe("unavailable");
    expect(deriveWorkspaceState(input({ ...closed, inventoryRefusalCode: "SIGNER_NOT_CONFIGURED" })).stateTitle).toBe("Your knowledge could not be loaded.");
  });

  it("is unchanged once access is accepted and the inventory loads", () => {
    expect(deriveWorkspaceMode(input({ inventoryRefusalCode: null }))).toBe("new");
    expect(deriveWorkspaceMode(input({ documentCount: 2, inventoryRefusalCode: null }))).toBe("returning");
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
  it("does not promise compilation of saved sources while admission is closed or unresolved", () => {
    const saved = { documentCount: 3, readyDocumentCount: 2 };
    const closed = deriveWorkspaceState(input({ ...saved, customerDataAccess: "closed" }));
    expect(closed.stateTitle).toBe("3 saved sources.");
    expect(closed.nextAction).toEqual({ label: "View saved sources", surface: "sources" });
    expect(closed.stateDescription).toContain("available to inspect");
    const checking = deriveWorkspaceState(input({ ...saved, customerDataAccess: "checking" }));
    expect(checking.stateTitle).toBe("Checking source access.");
    expect(checking.nextAction.surface).toBeUndefined();
    const unavailable = deriveWorkspaceState(input({ ...saved, customerDataAccess: "unavailable" }));
    expect(unavailable.stateTitle).toBe("Source access could not be verified.");
  });
  it("offers no action while the state is still being read", () => {
    const state = deriveWorkspaceState(input({ inventoryState: "loading" }));
    expect(state.stateTitle).toBe("Loading your knowledge.");
    expect(state.nextAction.surface).toBeUndefined();
    expect(state.nextAction.intent).toBeUndefined();
  });

  it("says so, and offers a retry, when the inventory could not be read", () => {
    const state = deriveWorkspaceState(input({ inventoryState: "unavailable" }));
    expect(state.stateTitle).toBe("Your knowledge could not be loaded.");
    expect(state.stateDescription).toContain("not described as empty or as populated");
    expect(state.nextAction).toEqual({ label: "Retry loading sources", intent: "refresh" });
  });

  it("follows the first-success spine in order", () => {
    expect(deriveWorkspaceState(input()).nextAction).toEqual({ label: "Choose sources", intent: "upload" });
    expect(deriveWorkspaceState(input({ documentCount: 2, readyDocumentCount: 2 })).nextAction.surface).toBe("sources");
    expect(deriveWorkspaceState(input({ hasCandidate: true, candidateNeedsDecision: true })).nextAction)
      .toEqual({ label: "Review & activate", surface: "review" });
    expect(deriveWorkspaceState(input({ hasCandidate: true, activeRevision: 1 })).nextAction)
      .toEqual({ label: "Use with AI", surface: "ask" });
  });

  it("prefers a live run over every other next action", () => {
    const state = deriveWorkspaceState(input({ documentCount: 3, activityCount: 2, activeRevision: 1 }));
    expect(state.stateTitle).toBe("Preparing your knowledge.");
    expect(state.stateDescription).toContain("latest recorded progress");
  });

  it("does not invite a re-compile without saying the last one stopped", () => {
    /*
      The defect this pins: sources read, no World built, the compile failed -- and the hero said
      "4 sources are ready to compile" with "Choose sources to compile" beside it, which is an
      invitation to repeat the run that just stopped, worded as if nothing had. The attention
      queue named the failure; the primary state answer (§13.2) did not.
    */
    const failed = deriveWorkspaceState(input({
      documentCount: 4,
      readyDocumentCount: 4,
      compileErrorCode: "COMPILE_CORE_UNAVAILABLE",
    }));
    expect(failed.stateTitle).toBe("The last compile stopped.");
    expect(failed.stateDescription).toContain("COMPILE_CORE_UNAVAILABLE");
    expect(failed.nextAction).toEqual({ label: "Open activity", surface: "activity" });

    // With nothing readable either, the failure is still the answer rather than "no source is
    // ready yet", which describes a symptom of it.
    expect(deriveWorkspaceState(input({ documentCount: 4, compileErrorCode: "COMPILE_TIMEOUT" })).stateTitle)
      .toBe("The last compile stopped.");
  });

  it("says a known compile stop in the compile panel's sentence, not as a bare code (WO-FIRST-5-MIN-1)", () => {
    const known = input({ documentCount: 4, compileErrorCode: "CORE_OUTPUT_TOO_LARGE" });
    const state = deriveWorkspaceState(known);
    expect(state.stateDescription).toContain(failureSentence("CORE_OUTPUT_TOO_LARGE", 500));
    expect(state.stateDescription).not.toContain("CORE_OUTPUT_TOO_LARGE");
    const item = deriveAttentionItems(known).find((entry) => entry.id === "compile-failed");
    expect(item?.detail).toContain(failureSentence("CORE_OUTPUT_TOO_LARGE", 500));
    expect(item?.detail).not.toContain("CORE_OUTPUT_TOO_LARGE");
    // An unmapped code still reaches the screen, as a reference.
    expect(deriveWorkspaceState(input({ documentCount: 4, compileErrorCode: "COMPILE_TIMEOUT" })).stateDescription)
      .toContain("Reference COMPILE_TIMEOUT.");
  });

  it("keeps newer news above a run that already ended", () => {
    // A live run, a candidate awaiting a decision and an active World each outrank a previous
    // failure -- the failure stays in the attention queue, which is where a second fact belongs.
    const withFailure = (state: Partial<WorkspaceStateInput>) =>
      deriveWorkspaceState(input({ documentCount: 4, compileErrorCode: "COMPILE_CORE_UNAVAILABLE", ...state })).stateTitle;

    expect(withFailure({ activityCount: 1 })).toBe("Preparing your knowledge.");
    expect(withFailure({ hasCandidate: true, candidateNeedsDecision: true })).toBe("Ready for your review.");
    expect(withFailure({ activeRevision: 2 })).toBe("Your published knowledge · v2");
    // And it is never lost: the attention queue still carries it in all three.
    expect(deriveAttentionItems(input({ activeRevision: 2, compileErrorCode: "COMPILE_CORE_UNAVAILABLE" }))
      .map((item) => item.id)).toEqual(["compile-failed"]);
  });

  it("does not tell a returning user with nothing readable to build their first World", () => {
    const state = deriveWorkspaceState(input({ documentCount: 2, operatorReviewCount: 2 }));
    expect(state.stateTitle).toBe("Your sources need review.");
    expect(state.nextAction).toEqual({ label: "Open sources needing review", surface: "sources" });
  });
});

describe("onboarding steps", () => {
  it("derives every step from workspace facts", () => {
    const done = (state: WorkspaceStateInput) =>
      Object.fromEntries(deriveOnboardingSteps(state).map((step) => [step.id, step.done]));

    expect(done(input())).toEqual({
      source: false, compile: false, review: false, activate: false, ask: false, connect: false,
    });
    expect(done(input({
      documentCount: 2,
      hasCandidate: true,
      activeRevision: 1,
      hasGroundedAnswer: true,
      hasAiConnection: true,
    }))).toEqual({
      source: true, compile: true, review: true, activate: true, ask: true, connect: true,
    });
  });

  it("offers §13.3's six steps in order, Connect to AI last", () => {
    // Five steps shipped where the blueprint's checklist has six, and the missing one was the
    // step that turns a trusted World into something an AI actually reads.
    expect(deriveOnboardingSteps(input()).map((step) => step.id))
      .toEqual(["source", "compile", "review", "activate", "ask", "connect"]);
  });

  it("closes Connect to AI on the act, not on reaching an Active World", () => {
    const connect = (state: Partial<WorkspaceStateInput>) =>
      deriveOnboardingSteps(input({ documentCount: 1, hasCandidate: true, activeRevision: 2, ...state }))
        .find((step) => step.id === "connect")!.done;

    // An activated, answerable World is not a connection: nothing has read it yet.
    expect(connect({ hasGroundedAnswer: true })).toBe(false);
    expect(connect({ hasAiConnection: true })).toBe(true);
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
    expect(items[0].detail).toBe("1 review reason needs a decision.");
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


describe("selected run and header consistency", () => {
  it.each([
    ["ready", "Compilation finished."],
    ["review_required", "This compile needs review."],
    ["cancelled", "The selected compile was cancelled."],
    ["failed", "The last compile stopped."],
  ] as const)("does not invite a new compile over a %s run without a loaded result", (compileJobState, title) => {
    const state = deriveWorkspaceState(input({ documentCount: 1, readyDocumentCount: 1, compileJobState }));
    expect(state.stateTitle).toBe(title);
    expect(state.nextAction.label).not.toBe("Choose sources to compile");
    expect(state.nextAction.surface).toBe(compileJobState === "failed" ? "activity" : "runs");
  });
  it("does not describe an existing saved run as an untouched workspace", () => {
    expect(deriveWorkspaceMode(input({ compileJobState: "cancelled" }))).toBe("returning");
  });
  it("does not tick candidate or activation steps from a ready job alone", () => {
    const steps = deriveOnboardingSteps(input({ compileJobState: "ready" }));
    expect(steps.find(s => s.id === "compile")?.done).toBe(false);
    expect(steps.find(s => s.id === "activate")?.done).toBe(false);
  });
  it("still prioritizes an actual loaded candidate and an actual active revision", () => {
    expect(deriveWorkspaceState(input({ compileJobState: "ready", hasCandidate: true, candidateNeedsDecision: true })).stateTitle).toBe("Ready for your review.");
    expect(deriveWorkspaceState(input({ compileJobState: "ready", hasCandidate: true, activeRevision: 2 })).stateTitle).toBe("Your published knowledge · v2");
  });
});

/*
  G2. `/api/documents` now says when its listing is incomplete instead of returning fewer rows.
  The workspace has to carry that through: a listing whose only source failed to load must not
  read as the first-run "add your knowledge" hero, and the reader is told in a sentence, never a
  raw code, with a way to retry.
*/
describe("an incomplete inventory", () => {
  const partial = { documentIds: ["doc-1", "doc-2"], truncated: false };

  it("is never an empty workspace, even when nothing else is listed", () => {
    expect(deriveWorkspaceMode(input({ inventoryPartial: partial }))).toBe("returning");
    expect(deriveWorkspaceMode(input({ inventoryPartial: null }))).toBe("new");
  });

  it("says so in the hero and offers a retry, before any next-step suggestion", () => {
    const state = deriveWorkspaceState(input({ inventoryPartial: partial, readyDocumentCount: 3, documentCount: 3 }));
    expect(state.stateTitle).toBe("Some sources could not be loaded.");
    expect(state.stateDescription).toContain("2 sources in this workspace could not be fully read");
    expect(state.nextAction).toEqual({ label: "Retry loading sources", intent: "refresh" });
  });

  it("puts an Incomplete item first in the attention queue, in words and without a code", () => {
    const items = deriveAttentionItems(input({ inventoryPartial: { documentIds: [], truncated: true }, operatorReviewCount: 1 }));
    expect(items.map((item) => item.id)).toEqual(["inventory-incomplete", "operator-review"]);
    expect(items[0]).toMatchObject({ label: "Incomplete", action: { intent: "refresh" } });
    // REVIEW-2026-10-17 N1: what lies past the bound is unknown, so the sentence names no state.
    expect(items[0].detail).toBe("The source listing stopped before its end, so some sources may not be shown. Retry; nothing was changed.");
    expect(items[0].detail).not.toMatch(/refused|unprepared|prepar/i);
    expect(items[0].detail).not.toMatch(/[A-Z]{3,}_[A-Z]/);
  });

  it("adds nothing when the listing was complete", () => {
    expect(deriveAttentionItems(input()).map((item) => item.id)).toEqual([]);
  });
});

/*
  Round 3 (direction C), placement series: the empty workspace's example-run capture is plain markup in the client page,
  so its sizes are literals. They must be the manifest's pixel size for the pair, or the image holds the wrong space.
*/
describe("the empty workspace's example run capture", () => {
  it("states MANIFEST.json's pixel size for both files of the compile-timeline pair", async () => {
    const { readFileSync } = await import("node:fs");
    const manifest = JSON.parse(readFileSync(new URL("../public/visuals/MANIFEST.json", import.meta.url), "utf8")) as { captures: { file: string; pixelWidth: number; pixelHeight: number }[] };
    const page = readFileSync(new URL("../app/workspace/page.tsx", import.meta.url), "utf8");
    for (const file of ["compile-timeline-1440.webp", "compile-timeline-390.webp"]) {
      const entry = manifest.captures.find((capture) => capture.file === file)!;
      expect(entry, file).toBeTruthy();
      expect(page).toContain(`/visuals/${file} ${entry.pixelWidth}w`);
      const at = page.indexOf(`/visuals/${file} ${entry.pixelWidth}w`);
      expect(page.indexOf(`width={${entry.pixelWidth}} height={${entry.pixelHeight}}`, at), file).toBeGreaterThan(at);
    }
    expect(page).not.toContain("@/components/landing-v2/product-capture");
  });
});

/*
  WO-FIRST5-P1: the free evaluation's allowance before upload (#6, #4), a refused access check (#9),
  the first-call confirmation (#12), citation details (#17) and the trial abstention (#18).
*/
describe("first five minutes, P1", () => {
  const page = readFileSync(new URL("../app/workspace/page.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const shell = readFileSync(new URL("../components/workspace-ultimate-shell.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const limits = { files: 3, pages: 50, worlds: 1 };

  it("states the free evaluation's allowance instead of the corpus and archive line", () => {
    const line = trialAllowanceLine(limits);
    expect(line).toContain("Your free evaluation covers 3 files and 50 pages in total, compiled into 1 World.");
    expect(line).toContain(PER_FILE_LIMIT_SENTENCE);
    expect(line).not.toMatch(/128|sources per run|ZIP|Connect a source/);
    expect(trialAllowanceLine({ files: 1, pages: 1, worlds: 2 })).toContain("1 file and 1 page in total, compiled into 2 Worlds.");
  });

  it("refuses a selection past the files or the counted pages, and nothing inside them", () => {
    expect(judgeTrialSelection(limits, 3, 50)).toBeNull();
    expect(judgeTrialSelection(limits, 1, 0)).toBeNull();
    expect(judgeTrialSelection(limits, 5, 10)).toBe("You chose 5 files, and your free evaluation covers 3 files in total. Remove 2, then upload.");
    expect(judgeTrialSelection(limits, 2, 64)).toBe("These files have 64 pages, and your free evaluation covers 50 pages in total. Remove a file, then upload.");
  });

  it("wires the allowance into the drop, the preflight verdict and the upload guard, for a free evaluation only", () => {
    expect(shell).toContain("{ limits: body.access.limits ?? null, failure: null }");
    expect(page).toContain('setTrialLimits(source === "trial" ? detail?.limits ?? null : null);');
    expect(page).toContain("judgeTrialSelection(trialLimits, stagedSelection?.files.length ?? 0, stagedPages)");
    expect(page).toContain("const stagedVerdict = corpusVerdict.ok && trialRefusal ? { ok: false as const, message: trialRefusal } : corpusVerdict;");
    expect(page).toContain('const intakeLimits = accessSource === "trial" && trialLimits ? trialAllowanceLine(trialLimits) : compileLimits;');
    expect(page).toContain('<small className="workspace-intake-limits">{intakeLimits}');
    expect(page).toContain('<p className="fine">{intakeLimits}</p>');
    // The upload handler refuses it too, from the same judgement, so the contract does not depend on the disabled prop.
    const guard = page.slice(page.indexOf("const startStagedCompile = async"));
    expect(guard.slice(0, 900)).toContain("if (trialRefusal) { setNotice(trialRefusal); return; }");
  });

  it("says what a refused access check was and offers a person instead of a refresh", () => {
    const sentence = failureSentence("TRIAL_RISK_GATE_NOT_CONFIGURED", 503);
    const view = deriveWorkspaceState(input({ customerDataAccess: "unavailable", accessFailureSentence: sentence }));
    expect(view.stateDescription).toBe(`${sentence} Your saved work remains available.`);
    expect(view.nextAction).toEqual({ label: "Contact support", intent: "contact" });
    // No code (a network failure) or an expired session: unchanged.
    const plain = deriveWorkspaceState(input({ customerDataAccess: "unavailable" }));
    expect(plain.nextAction).toEqual({ label: "Access unavailable" });
    expect(plain.stateDescription).toBe("Your saved work remains available. Sign in again before processing files.");
    // The shell keeps the code it was refused with; the page turns it into the sentence.
    expect(shell).toContain('failure: { code: typeof body?.code === "string" ? body.code : null, status: response.status }');
    expect(page).toContain("setAccessFailure(failure?.code && failure.status !== 401 ? failureSentence(failure.code, failure.status) : null);");
    expect(page).toContain(': accessFailure ?? "Source access could not be verified. Refresh before choosing files.";');
    const contact = page.slice(page.indexOf('customerDataAccess === "unavailable" && accessFailure ? ('));
    expect(contact.slice(0, 300)).toContain('<Link className="btn" href="/contact">Contact support</Link>');
    expect(page).toContain('if (intent === "contact") window.location.assign("/contact");');
  });

  it("reads the AI's last request from the remote MCP keys, and says nothing it cannot know", () => {
    const listing = (remoteMcpKeys: unknown, truncated: unknown = { keys: false, remoteMcpKeys: false }) => ({ code: "OK", keys: [], remoteMcpKeys, truncated });
    expect(lastAiRequest(listing([{ lastUsedAt: "2026-11-27T09:00:00Z" }, { lastUsedAt: "2026-11-27T10:30:00Z" }, { lastUsedAt: null }])))
      .toEqual({ lastUsedAt: "2026-11-27T10:30:00Z" });
    expect(lastAiRequest(listing([{ lastUsedAt: null }]))).toEqual({ lastUsedAt: null });
    // No connection, a cut-short listing, a missing truncation marker, a refusal body or garbage: nothing.
    expect(lastAiRequest(listing([]))).toBeNull();
    expect(lastAiRequest(listing([{ lastUsedAt: "2026-11-27T10:30:00Z" }], { keys: false, remoteMcpKeys: true }))).toBeNull();
    expect(lastAiRequest(listing([{ lastUsedAt: "2026-11-27T10:30:00Z" }], null))).toBeNull();
    expect(lastAiRequest({ code: "TRIAL_FEATURE_NOT_INCLUDED" })).toBeNull();
    expect(lastAiRequest(null)).toBeNull();
    expect(lastAiRequest(listing([{ lastUsedAt: "not a date" }]))).toEqual({ lastUsedAt: null });
    const format = (iso: string) => `<${iso}>`;
    expect(aiLastRequestSentence({ lastUsedAt: "2026-11-27T10:30:00Z" }, format)).toBe("Last request from your AI: <2026-11-27T10:30:00Z>.");
    expect(aiLastRequestSentence({ lastUsedAt: null }, format)).toBe("Your AI is connected and has not made a request yet.");
    // Read on Use with AI, only by an account the listing answers, and never left over from another surface.
    expect(page).toContain('if (surface !== "ask" || !(accessSource === "owner" || accessSource === "paid" || (accessSource === "trial" && trialAiAccess))) {');
    expect(page).toContain("const read = response.ok ? lastAiRequest(await response.json().catch(() => null)) : null;");
  });

  it("keeps citation ids, the box and the scores under a native disclosure, the excerpt first", () => {
    const item = page.slice(page.indexOf("<li key={`${index}-${citation.evidenceId}`}>"));
    const at = (text: string) => item.indexOf(text);
    expect(at("<q>{citation.excerpt}</q>")).toBeGreaterThan(-1);
    expect(at("<q>{citation.excerpt}</q>")).toBeLessThan(at("<details>"));
    expect(at("<details>")).toBeLessThan(at("<b>{citation.evidenceId}</b>"));
    expect(at("score {citation.relevance.toFixed(3)}")).toBeLessThan(at("</details>"));
    expect(at("bbox {citation.bbox1000")).toBeLessThan(at("</details>"));
  });

  it("does not send a free evaluation to add a source its one World cannot take", () => {
    const actions = page.slice(page.indexOf("WO-FIRST5-P1 (#18)"));
    expect(actions.slice(0, 500)).toContain('{accessSource === "trial"\n                          ? <Link className="btn" href="/pricing">See plans to add more sources</Link>');
    expect(actions.slice(0, 500)).toContain("Add the source that would answer this");
  });
});
