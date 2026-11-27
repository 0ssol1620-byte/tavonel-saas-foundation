import type { TrialLimits, WorkspaceSurface } from "@/components/workspace-ultimate-shell";
import { PER_FILE_LIMIT_SENTENCE } from "./compile-limits";
import type { CompileState } from "./compile-job-store";
import type { DocumentListPartial } from "./pipeline";
import { failureSentence } from "./workspace-failure-copy";

/*
  WO-FIRST5-P1 (#6, #4). A free evaluation was shown "Up to 128 sources per run" under the drop and
  could stage any number of files; the upload then refused the ones past its allowance, file by file.
  Bootstrap sends the allowance as totals for the evaluation (not what is left), so the drop states
  those totals and the preflight refuses a selection that alone is past them -- which the server would
  refuse too. What is already spent is not sent to the page, so nothing here claims to know it.
*/
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/*
  WO-FIRST5-P1 (#12). What the Developers listing (GET /api/developer/keys) says about the remote MCP
  keys, the connection an assistant makes: the latest `lastUsedAt` across them. Null -- say nothing --
  when there is no connection, the body is not the listing, or the listing was cut short, because the
  latest use could be in the rows it did not return.
*/
export type AiLastRequest = { lastUsedAt: string | null };

export function lastAiRequest(body: unknown): AiLastRequest | null {
  const listing = body as { remoteMcpKeys?: unknown; truncated?: { remoteMcpKeys?: unknown } } | null;
  if (!listing || !Array.isArray(listing.remoteMcpKeys) || listing.truncated?.remoteMcpKeys !== false) return null;
  if (listing.remoteMcpKeys.length === 0) return null;
  const used = listing.remoteMcpKeys
    .map((key) => (key as { lastUsedAt?: unknown } | null)?.lastUsedAt)
    .filter((value): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)));
  return { lastUsedAt: used.length ? used.reduce((latest, value) => Date.parse(value) > Date.parse(latest) ? value : latest) : null };
}

export function aiLastRequestSentence(read: AiLastRequest, format: (iso: string) => string): string {
  return read.lastUsedAt ? `Last request from your AI: ${format(read.lastUsedAt)}.` : "Your AI is connected and has not made a request yet.";
}

/** The drop-zone line for a free evaluation, in place of the corpus and archive line. */
export function trialAllowanceLine(limits: TrialLimits): string {
  return `${PER_FILE_LIMIT_SENTENCE} Your free evaluation covers ${plural(limits.files, "file")} and ${plural(limits.pages, "page")} in total, compiled into ${plural(limits.worlds, "World")}.`;
}

/** Why a staged selection is past the free evaluation's allowance, or null when it is not. `countedPages` holds counted files only. */
export function judgeTrialSelection(limits: TrialLimits, files: number, countedPages: number): string | null {
  if (files > limits.files) {
    return `You chose ${plural(files, "file")}, and your free evaluation covers ${plural(limits.files, "file")} in total. Remove ${files - limits.files}, then upload.`;
  }
  if (countedPages > limits.pages) {
    return `These files have ${plural(countedPages, "page")}, and your free evaluation covers ${plural(limits.pages, "page")} in total. Remove a file, then upload.`;
  }
  return null;
}

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
  /** Per-workspace admission is distinct from having saved, readable sources. */
  customerDataAccess: "checking" | "open" | "closed" | "unavailable";
  /** Whether the source inventory is known. Never assume "loading" means "empty". */
  inventoryState: WorkspaceInventoryState;
  /** The code `/api/documents` refused with, when it answered with one. Null for a network failure or a success. */
  inventoryRefusalCode?: string | null;
  /** Bootstrap's reason a closed workspace is closed (v2). Absent or "legacy" when it sent none. */
  sourcePending?: string | null;
  /** `/api/documents`'s `partial` marker: the inventory loaded but is known to be incomplete. */
  inventoryPartial?: DocumentListPartial | null;
  documentCount: number;
  readyDocumentCount: number;
  operatorReviewCount: number;
  /** Pipeline rows currently mid-transition, plus any synchronous busy work. */
  activityCount: number;
  hasCandidate: boolean;
  candidateNeedsDecision: boolean;
  collectionReviewRequired: boolean;
  /**
   * The answer to "what became of the latest compile" is still on its way (D-06). While it is, the
   * workspace says it is checking instead of choosing a verdict and an action the next response would
   * contradict. Absent means settled, which is what every caller before this field meant.
   */
  resultPending?: boolean;
  reviewCount: number;
  activeRevision: number | null;
  /** Terminal error code of the last compile job, when it stopped. */
  compileErrorCode: string | null;
  /** The selected durable run may be complete even while its result has not loaded. */
  compileJobState?: CompileState | null;
  /** Sources the compile refused to read. */
  blockedSourceCount: number;
  /** A grounded answer has come back from the Active World in this session. */
  hasGroundedAnswer: boolean;
  /**
   * A successful external consumer request has been verified for the active knowledge.
   * Guide opening, key creation and package download are setup intent, not this receipt.
   * The current workspace has no authenticated consumer receipt to read and therefore passes
   * false. A future integration may set it only from evidence bound to the current workspace,
   * active revision and consumer request, never from a locally remembered click.
   */
  hasAiConnection: boolean;
  /**
   * WO-FIRST5-P1 (#9): the sentence for the code a refused access check answered with. Null when it
   * answered none (a network failure) or an expired session, where "sign in again" is the next step.
   */
  accessFailureSentence?: string | null;
};

/** An action the page has to run itself; anything else is a surface navigation. */
export type WorkspaceIntent = "upload" | "refresh" | "contact";

export type WorkspaceNextAction = {
  label: string;
  surface?: WorkspaceSurface;
  intent?: WorkspaceIntent;
};

/**
 * `loading` and `unavailable` are not "empty". Only `new` may show the first-run intake hero,
 * and it is reachable exclusively from a resolved, genuinely empty inventory.
 */
export type WorkspaceMode = "loading" | "unavailable" | "source_pending" | "plan_required" | "new" | "returning";

/*
  Hotfix 2026-11-10. The refusals the inventory gives a workspace that has no file access yet.

  A first sign-in has accepted no processing terms, so bootstrap mints no trial (the trial waits for
  the customer-data gate) and `/api/documents` answers 402 SUBSCRIPTION_REQUIRED from the product
  gate. That is the workspace's access state, not a failed read, and it was rendering the
  "could not be loaded" error over the terms step that opens access. Only these two codes, only
  with access read as closed and only with a gate reason bootstrap named: a 5xx, a network failure or
  an expired session stays `unavailable`.

  Closed with no reason is a different workspace (REVIEW-PR227-R1 B1): bootstrap answered
  ACCESS_READY_NO_ENTITLEMENT because the terms are accepted but there is no plan or trial (lapsed,
  expired, exhausted, device reused). Its 402 is `plan_required`, which routes to /pricing, so a
  paying customer never meets a first-run screen with no way to pay.
*/
export const SOURCE_PENDING_INVENTORY_REFUSALS: ReadonlySet<string> = new Set([
  "SUBSCRIPTION_REQUIRED",
  "CUSTOMER_DATA_NOT_ENABLED_FOR_WORKSPACE",
]);
const SOURCE_PENDING_REASONS: ReadonlySet<string> = new Set(["terms_acceptance_required", "release_pending", "workspace_refused"]);

export type WorkspaceStateView = {
  mode: WorkspaceMode;
  stateTitle: string;
  stateDescription: string;
  nextAction: WorkspaceNextAction;
};

export function deriveWorkspaceMode(input: WorkspaceStateInput): WorkspaceMode {
  if (input.inventoryState === "loading") return "loading";
  if (input.inventoryState === "unavailable") {
    if (input.inventoryRefusalCode && SOURCE_PENDING_INVENTORY_REFUSALS.has(input.inventoryRefusalCode)) {
      // Wait for the access read rather than flash the error before the terms step.
      if (input.customerDataAccess === "checking") return "loading";
      if (input.customerDataAccess === "closed") {
        if (input.sourcePending && SOURCE_PENDING_REASONS.has(input.sourcePending)) return "source_pending";
        if (input.inventoryRefusalCode === "SUBSCRIPTION_REQUIRED") return "plan_required";
      }
    }
    return "unavailable";
  }
  // An incomplete inventory with nothing listed is not an empty workspace; it is a failed read.
  const untouched =
    !input.inventoryPartial &&
    input.documentCount === 0 &&
    !input.hasCandidate &&
    input.activeRevision === null &&
    input.activityCount === 0 &&
    input.compileJobState == null;
  return untouched ? "new" : "returning";
}

export function deriveWorkspaceState(input: WorkspaceStateInput): WorkspaceStateView {
  const mode = deriveWorkspaceMode(input);

  if (mode === "loading") {
    return {
      mode,
      stateTitle: "Loading your knowledge.",
      stateDescription:
        "Checking your files and the latest processing state.",
      nextAction: { label: "Loading" },
    };
  }

  if (mode === "source_pending") {
    return {
      mode,
      stateTitle: "Your workspace is ready.",
      stateDescription:
        "Your sources load here once this workspace can process files. The step that opens it is below.",
      nextAction: { label: "See the step below" },
    };
  }

  if (mode === "plan_required") {
    return {
      mode,
      stateTitle: "This workspace has no active plan.",
      stateDescription:
        "Sources and Worlds load here while a plan or free evaluation is active. Choose a plan to continue.",
      nextAction: { label: "See plans" },
    };
  }

  if (mode === "unavailable") {
    return {
      mode,
      stateTitle: "Your knowledge could not be loaded.",
      stateDescription:
        "The source inventory did not load, so this workspace is not described as empty or as populated. Retry, or sign in again if the session expired.",
      nextAction: { label: "Retry loading sources", intent: "refresh" },
    };
  }

  if (mode === "returning" && input.resultPending) {
    return {
      mode,
      stateTitle: "Checking your latest result.",
      stateDescription: "Looking up what became of your last compile. This takes a moment.",
      nextAction: { label: "Loading" },
    };
  }

  if (input.activityCount > 0) {
    return {
      mode,
      stateTitle: "Preparing your knowledge.",
      stateDescription:
        `${input.activityCount} ${input.activityCount === 1 ? "source is" : "sources are"} being processed. View the latest recorded progress.`,
      nextAction: { label: "View progress", surface: "activity" },
    };
  }

  /*
    D-01. A result the checks held back cannot be activated from the workspace (the promote route takes
    only a passed, completed candidate), so it is not offered as something to "review and activate": that
    led to a screen where the only control was disabled. It is said as what it is, with the one place
    that explains it and shows what can be done now.
  */
  if (input.candidateNeedsDecision && input.collectionReviewRequired) {
    return {
      mode,
      stateTitle: "Your result is on hold.",
      stateDescription:
        "TAVONEL read your documents and held the result back, so your AI cannot use it yet. Nothing was changed. See why, and what you can do now.",
      nextAction: { label: "See why it is on hold", surface: "review" },
    };
  }

  if (input.candidateNeedsDecision) {
    return {
      mode,
      stateTitle: "Ready for your review.",
      stateDescription:
        "Check the prepared result and anything that needs attention. You decide when this version becomes active.",
      nextAction: { label: "Review & activate", surface: "review" },
    };
  }

  if (input.activeRevision !== null) {
    return {
      mode,
      stateTitle: `Your published knowledge · v${input.activeRevision}`,
      stateDescription:
        "Choose how to use it with your AI, or try a question here. Current source permissions still apply.",
      nextAction: { label: "Use with AI", surface: "ask" },
    };
  }

  /*
    A compile that stopped is the state, not a footnote to it (§13.6, program §35).

    The attention queue below the hero has always named the failure. The hero itself did not: with
    the sources still read and no World built, the next branch answered "4 sources are ready to
    compile" and offered "Choose sources to compile" -- inviting the customer to repeat, without
    a word about it, the exact run that had just stopped. It sits below the live-run, candidate
    and active-World branches because each of those is newer news than a run that already ended,
    and above every "here is what you could do next" branch because none of them is true until
    the customer knows the last attempt failed.
  */
  if (input.compileErrorCode) {
    return {
      mode,
      stateTitle: "The last compile stopped.",
      // WO-FIRST-5-MIN-1: the sentence the compile panel shows for the same code, not the bare code.
      stateDescription: `${failureSentence(input.compileErrorCode, 500)} Nothing was activated. The run's own record says which sources it had read when it stopped.`,
      nextAction: { label: "Open activity", surface: "activity" },
    };
  }

  // Do not invite an accidental duplicate compile just because the result payload is absent.
  if (input.compileJobState === "ready" && !input.hasCandidate) {
    return { mode, stateTitle: "Compilation finished.",
      stateDescription: "Open the saved run to inspect its result. Completion does not activate knowledge for AI use.",
      nextAction: { label: "View compile runs", surface: "runs" } };
  }
  if (input.compileJobState === "review_required") {
    return { mode, stateTitle: "This compile needs review.",
      stateDescription: "TAVONEL held this result back, so your AI cannot use it yet. Open the run details to see why.",
      nextAction: { label: "View compile runs", surface: "runs" } };
  }
  if (input.compileJobState === "cancelled") {
    return { mode, stateTitle: "The selected compile was cancelled.",
      stateDescription: "This run is no longer processing. Your stored sources remain in Knowledge; inspect the run before trying again.",
      nextAction: { label: "View compile runs", surface: "runs" } };
  }
  if (input.compileJobState === "failed") {
    return { mode, stateTitle: "The last compile stopped.",
      stateDescription: "The run did not finish. Inspect its recorded status before retrying; no error detail was provided.",
      nextAction: { label: "Open activity", surface: "activity" } };
  }

  // Below the live and decided states, above every "here is what you could do next" branch: none
  // of those counts is trustworthy while the inventory says it is missing sources.
  if (input.inventoryPartial) {
    return { mode, stateTitle: "Some sources could not be loaded.",
      stateDescription: incompleteInventorySentence(input.inventoryPartial),
      nextAction: { label: "Retry loading sources", intent: "refresh" } };
  }

  if (input.customerDataAccess !== "open") {
    if (input.customerDataAccess === "checking") {
      return { mode, stateTitle: "Checking source access.",
        stateDescription: "Your saved work remains available while we verify whether this workspace can process files.",
        nextAction: { label: "Checking access" } };
    }
    if (input.customerDataAccess === "unavailable") {
      // A server that answered with a code fails the same way on every refresh, so a person is the next step.
      if (input.accessFailureSentence) {
        return { mode, stateTitle: "Source access could not be verified.",
          stateDescription: `${input.accessFailureSentence} Your saved work remains available.`,
          nextAction: { label: "Contact support", intent: "contact" } };
      }
      return { mode, stateTitle: "Source access could not be verified.",
        stateDescription: "Your saved work remains available. Sign in again before processing files.",
        nextAction: { label: "Access unavailable" } };
    }
    return { mode, stateTitle: `${input.documentCount} saved source${input.documentCount === 1 ? "" : "s"}.`,
      stateDescription: "Your saved sources remain available to inspect.",
      nextAction: { label: "View saved sources", surface: "sources" } };
  }

  if (input.readyDocumentCount > 0) {
    return {
      mode,
      stateTitle: `${input.readyDocumentCount} source${input.readyDocumentCount === 1 ? " is" : "s are"} ready to compile.`,
      stateDescription:
        "Choose which ready sources to compile. Review and activate the result when it is finished.",
      nextAction: { label: "Choose sources to compile", surface: "sources" },
    };
  }

  if (input.operatorReviewCount > 0) {
    return { mode, stateTitle: "Your sources need review.",
      stateDescription: `${input.operatorReviewCount} ${input.operatorReviewCount === 1 ? "source needs" : "sources need"} a decision before reading can continue.`,
      nextAction: { label: "Open sources needing review", surface: "sources" } };
  }

  return {
    mode,
    stateTitle: mode === "new" ? "Add your knowledge." : "Your files are being prepared.",
    stateDescription:
      mode === "new"
        ? "Choose files, a folder or a ZIP. You can also connect a source."
        : "Your sources are still being prepared and read. A source joins a candidate only once its reading is complete.",
    nextAction:
      mode === "new"
        ? { label: "Choose sources", intent: "upload" }
        : { label: "Open sources", surface: "sources" },
  };
}

export type OnboardingStep = {
  id: "source" | "compile" | "review" | "activate" | "ask" | "connect";
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
      detail: "Ready sources are compiled into one version of your knowledge, called a World. Every statement in it is tied to the page it came from.",
      done: input.hasCandidate,
    },
    {
      id: "review",
      title: "Review",
      detail: "Anything that needs a person stays visible until you decide.",
      done: input.hasCandidate && nothingOutstanding,
    },
    {
      id: "activate",
      title: "Activate World",
      detail: "Activation is your decision. A compile never becomes what your AI reads on its own.",
      done: input.activeRevision !== null,
    },
    {
      id: "ask",
      title: "Ask a grounded question",
      detail: "Ask a question, then follow each citation back to the page it came from.",
      done: input.hasGroundedAnswer,
    },
    {
      /*
        §13.3's sixth step. The first five end with a reader who trusts the World; this is the one
        that puts it to work, and leaving it off the checklist made "Use with AI" a disclosure
        somebody had to find rather than a step the product asks for.
      */
      id: "connect",
      title: "Connect to AI",
      detail: "Let your AI assistant read it through MCP or the API, or take the signed package to a local agent.",
      done: input.hasAiConnection,
    },
  ];
}

/** What to say about an incomplete inventory. Never a raw code; the count is the server's. */
export function incompleteInventorySentence(partial: DocumentListPartial): string {
  const count = partial.documentIds.length;
  const unread = count > 0
    ? `${count} source${count === 1 ? "" : "s"} in this workspace could not be fully read, so the list below is incomplete.`
    : "";
  // The listing stops early without knowing what lies past it -- refused, still being
  // prepared or already prepared -- so this says only that something may be missing.
  const truncated = partial.truncated
    ? "The source listing stopped before its end, so some sources may not be shown."
    : "";
  return [unread, truncated, "Retry; nothing was changed."].filter(Boolean).join(" ");
}

export type AttentionItem = {
  id: "inventory-incomplete" | "candidate-review" | "operator-review" | "refused" | "compile-failed";
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

  if (input.inventoryPartial) {
    items.push({
      id: "inventory-incomplete",
      label: "Incomplete",
      detail: incompleteInventorySentence(input.inventoryPartial),
      action: { label: "Retry loading sources", intent: "refresh" },
    });
  }

  if (input.collectionReviewRequired) {
    items.push({
      id: "candidate-review",
      label: "Review required",
      detail:
        input.reviewCount > 0
          ? `${input.reviewCount} review reason${input.reviewCount === 1 ? "" : "s"} need${input.reviewCount === 1 ? "s" : ""} a decision.`
          : "The compiled candidate requires review before it can become active.",
      action: { label: "Open review", surface: "review" },
    });
  }

  if (input.operatorReviewCount > 0) {
    items.push({
      id: "operator-review",
      label: "Needs a decision",
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
      detail: `The last compile stopped. ${failureSentence(input.compileErrorCode, 500)} Nothing was activated.`,
      action: { label: "Open activity", surface: "activity" },
    });
  }

  return items;
}
