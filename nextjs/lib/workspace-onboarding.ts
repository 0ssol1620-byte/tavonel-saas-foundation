import type { WorkspaceSurface } from "@/components/workspace-ultimate-shell";

/*
  One derivation of "what is true about this workspace, and what should be said about it".

  It exists because the same four questions -- what state am I in, what do I do next, is
  anything blocked, what did I get -- were answered by four separate ternary ladders inside a
  2,600-line client component, and every one of them treated "not loaded yet" as "empty".
  `documents === null` scored as zero sources, so the first paint of a workspace holding a
  hundred sources said "Build your first Compiled World" and then collapsed. Making the
  inventory state an explicit input, and refusing to answer the new/returning question until
  it resolves, is what removes that class of flicker rather than one instance of it.
*/

export type WorkspaceInventoryState = "loading" | "ready" | "unavailable";

export type WorkspaceStateInput = {
  /** Whether the source inventory is known. Never assume "loading" means "empty". */
  inventoryState: WorkspaceInventoryState;
  documentCount: number;
  readyDocumentCount: number;
  operatorReviewCount: number;
  /** Pipeline rows currently mid-transition, plus any synchronous busy work. */
  activityCount: number;
  hasCandidate: boolean;
  candidateNeedsDecision: boolean;
  collectionReviewRequired: boolean;
  reviewCount: number;
  activeRevision: number | null;
  /** Terminal error code of the last compile job, when it stopped. */
  compileErrorCode: string | null;
  /** Sources the compile refused to read. */
  blockedSourceCount: number;
  /** A grounded answer has come back from the Active World in this session. */
  hasGroundedAnswer: boolean;
};

/** An action the page has to run itself; anything else is a surface navigation. */
export type WorkspaceIntent = "upload" | "refresh";

export type WorkspaceNextAction = {
  label: string;
  surface?: WorkspaceSurface;
  intent?: WorkspaceIntent;
};

/**
 * `loading` and `unavailable` are not "empty". Only `new` may show the first-run intake hero,
 * and it is reachable exclusively from a resolved, genuinely empty inventory.
 */
export type WorkspaceMode = "loading" | "unavailable" | "new" | "returning";

export type WorkspaceStateView = {
  mode: WorkspaceMode;
  stateTitle: string;
  stateDescription: string;
  nextAction: WorkspaceNextAction;
};

export function deriveWorkspaceMode(input: WorkspaceStateInput): WorkspaceMode {
  if (input.inventoryState === "loading") return "loading";
  if (input.inventoryState === "unavailable") return "unavailable";
  const untouched =
    input.documentCount === 0 &&
    !input.hasCandidate &&
    input.activeRevision === null &&
    input.activityCount === 0;
  return untouched ? "new" : "returning";
}

export function deriveWorkspaceState(input: WorkspaceStateInput): WorkspaceStateView {
  const mode = deriveWorkspaceMode(input);

  if (mode === "loading") {
    return {
      mode,
      stateTitle: "Reading your workspace state.",
      stateDescription:
        "Loading your sources and World state. Nothing is described until the workspace answers.",
      nextAction: { label: "Loading" },
    };
  }

  if (mode === "unavailable") {
    return {
      mode,
      stateTitle: "Workspace state could not be read.",
      stateDescription:
        "The source inventory did not load, so this workspace is not described as empty or as populated. Retry, or sign in again if the session expired.",
      nextAction: { label: "Retry loading sources", intent: "refresh" },
    };
  }

  if (input.activityCount > 0) {
    return {
      mode,
      stateTitle: `${input.activityCount} ${input.activityCount === 1 ? "source is" : "sources are"} becoming a world.`,
      stateDescription:
        "Follow only observed pipeline transitions. TAVONEL does not estimate progress between receipts.",
      nextAction: { label: "Inspect current run", surface: "activity" },
    };
  }

  if (input.candidateNeedsDecision) {
    return {
      mode,
      stateTitle: "Candidate World ready for review.",
      stateDescription:
        "Inspect the immutable candidate, evidence bindings, and review gates before any active-pointer decision.",
      nextAction: { label: "Review candidate", surface: "review" },
    };
  }

  if (input.activeRevision !== null) {
    return {
      mode,
      stateTitle: `World v${input.activeRevision} is active and source-grounded.`,
      stateDescription:
        "Ask with exact citations, connect an AI through the read-only interfaces, or export a signed portable snapshot.",
      nextAction: { label: "Ask active World", surface: "ask" },
    };
  }

  if (input.readyDocumentCount > 0) {
    return {
      mode,
      stateTitle: `${input.readyDocumentCount} source${input.readyDocumentCount === 1 ? " is" : "s are"} ready to compile.`,
      stateDescription:
        "Choose the ready sources you want in the candidate, then compile. Nothing becomes active until you review and approve it.",
      nextAction: { label: "Choose sources to compile", surface: "sources" },
    };
  }

  return {
    mode,
    stateTitle: mode === "new" ? "Build your first Compiled World." : "No source is ready to compile yet.",
    stateDescription:
      mode === "new"
        ? "Add sources, compile a candidate, then review and activate it. The workspace keeps each step explicit."
        : "Your sources are still being prepared and read. A source joins a candidate only once its reading is complete.",
    nextAction:
      mode === "new"
        ? { label: "Choose sources", intent: "upload" }
        : { label: "Open sources", surface: "sources" },
  };
}

export type OnboardingStep = {
  id: "source" | "compile" | "review" | "activate" | "ask";
  title: string;
  detail: string;
  done: boolean;
};

/**
 * Every step's state comes from workspace facts, never from a local "seen it" flag. Dismissing
 * the guide hides it; it cannot mark a step complete that the workspace has not reached.
 */
export function deriveOnboardingSteps(input: WorkspaceStateInput): OnboardingStep[] {
  const nothingOutstanding =
    !input.collectionReviewRequired && input.operatorReviewCount === 0 && input.blockedSourceCount === 0;
  return [
    {
      id: "source",
      title: "Add a source",
      detail: "Upload files, a folder or a ZIP, or connect the system your knowledge already lives in.",
      done: input.documentCount > 0,
    },
    {
      id: "compile",
      title: "Compile a candidate",
      detail: "Ready sources compile into one evidence-bound Candidate World.",
      done: input.hasCandidate,
    },
    {
      id: "review",
      title: "Review",
      detail: "Review required, operator action, refused and unresolved states stay visible until you decide.",
      done: input.hasCandidate && nothingOutstanding,
    },
    {
      id: "activate",
      title: "Activate World",
      detail: "Activation is explicit. A compile never silently becomes organizational truth.",
      done: input.activeRevision !== null,
    },
    {
      id: "ask",
      title: "Ask a grounded question",
      detail: "Ask the Active World, then follow each citation back to its exact source region.",
      done: input.hasGroundedAnswer,
    },
  ];
}

export type AttentionItem = {
  id: "candidate-review" | "operator-review" | "refused" | "compile-failed";
  /** Rendered as text, not as a colour. */
  label: string;
  detail: string;
  action: { label: string; surface?: WorkspaceSurface; intent?: WorkspaceIntent } | null;
};

/**
 * §13.6: review required, operator action, failed, refused and unresolved are never hidden and
 * never signalled by colour alone. Each item carries its own written state label.
 */
export function deriveAttentionItems(input: WorkspaceStateInput): AttentionItem[] {
  const items: AttentionItem[] = [];

  if (input.collectionReviewRequired) {
    items.push({
      id: "candidate-review",
      label: "Review required",
      detail:
        input.reviewCount > 0
          ? `${input.reviewCount} review item${input.reviewCount === 1 ? "" : "s"} need${input.reviewCount === 1 ? "s" : ""} a decision.`
          : "The compiled candidate requires review before it can become active.",
      action: { label: "Open review", surface: "review" },
    });
  }

  if (input.operatorReviewCount > 0) {
    items.push({
      id: "operator-review",
      label: "Operator action",
      detail:
        input.operatorReviewCount === 1
          ? "This source needs review before reading can continue."
          : `${input.operatorReviewCount} sources need review before reading can continue.`,
      action: { label: "Open sources needing review", surface: "sources" },
    });
  }

  if (input.blockedSourceCount > 0) {
    items.push({
      id: "refused",
      label: "Refused",
      detail: `${input.blockedSourceCount} source${input.blockedSourceCount === 1 ? " was" : "s were"} refused and left out of the candidate. Nothing was silently dropped.`,
      action: { label: "Open activity", surface: "activity" },
    });
  }

  if (input.compileErrorCode) {
    items.push({
      id: "compile-failed",
      label: "Failed",
      detail: `The last compile stopped with ${input.compileErrorCode}. Nothing was activated.`,
      action: { label: "Open activity", surface: "activity" },
    });
  }

  return items;
}
