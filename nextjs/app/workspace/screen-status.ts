import type { ScreenStatus } from "@/components/v34/ui/screen";
import type { AttentionItem } from "@/lib/workspace-onboarding";
import { countNoun } from "@/lib/plural";
import type { ActiveWorldDiscovery, AskWorldState } from "@/components/workspace/in-page-choices";
import type { WorkspaceMode } from "@/lib/workspace-onboarding";
import type { WorldEvidenceRead } from "@/lib/review-queue";

/*
  WO-WS-4: the state each workspace screen's tag carries, read from values the page already holds.
  Nothing here is counted or fetched anew, and nothing defaults: a value that is not a state (a
  revision that is not a positive integer, a negative count, an attention item this file does not
  know) is refused, so a tag can never show a state the page does not have.
*/

function count(value: number, what: string): number {
  if (!Number.isInteger(value) || value < 0) throw new Error(`screen_status_count_invalid:${what}`);
  return value;
}

/** Which World is active. The words are the ones the Home facts line already uses. */
export function worldScreenStatus(activeRevision: number | null): ScreenStatus {
  if (activeRevision === null) return { tone: "waiting", label: "No active World" };
  if (!Number.isInteger(activeRevision) || activeRevision < 1) throw new Error("screen_status_revision_invalid");
  return { tone: "ok", label: `World v${activeRevision} active` };
}

/*
  WO-WS-3/4 round 2: a tag is derived from what the page has observed, the same value its body switches on.
  A read that has not answered, or failed, is not "no World": the tag says it is unknown and asserts nothing.
*/

/** Ask: `panel` is `askWorldPanel(activeWorld, state)`, the value the Ask body renders from. */
export function askScreenStatus(activeRevision: number | null, panel: "checking" | "opening" | "none" | Exclude<AskWorldState, "idle" | "checking" | "opening"> | null): ScreenStatus {
  if (panel === null) {
    // The panel is null only while a World is loaded; a null revision beside it is a page bug, not a state.
    if (activeRevision === null) throw new Error("screen_status_ask_inconsistent");
    return worldScreenStatus(activeRevision);
  }
  if (panel === "checking") return { tone: "waiting", label: "Checking Worlds…" };
  if (panel === "opening") return { tone: "waiting", label: "Opening World…" };
  if (panel === "none") return { tone: "waiting", label: "No active World" };
  if (panel.kind === "several") return { tone: "waiting", label: countNoun(panel.worlds.length, "active World") };
  if (panel.kind === "failed") return { tone: "waiting", label: "Worlds not checked" };
  return { tone: "waiting", label: "World not opened" };
}

/**
  The workspace's own answer to "which Worlds are active": the listing Ask uses (GET /api/v1/collections),
  or "checking" before it has answered. `activeRevision` elsewhere in this file is the one collection the
  page has open; the database keeps one active World per collection and a workspace may have several, so
  an open collection with no active World says nothing about the workspace (WO-WS-6, F1).
*/
export type WorkspaceWorlds = ActiveWorldDiscovery | "checking";

const shortCollection = (collectionId: string) => `${collectionId.slice(0, 19)}…`;

/**
  Home: while the inventory is loading or unavailable the page does not know which World is active.
  `worlds` is optional so a caller that never read the workspace listing keeps the single-collection
  words; with it, "No active World" is said only after a listing answered "none" (WO-WS-6).
*/
export function homeWorldScreenStatus(activeRevision: number | null, mode: WorkspaceMode, worlds?: WorkspaceWorlds): ScreenStatus {
  if (mode === "loading") return { tone: "waiting", label: "Checking World…" };
  if (mode === "unavailable") return { tone: "waiting", label: "World not checked" };
  if (activeRevision !== null || worlds === undefined) return worldScreenStatus(activeRevision);
  if (worlds === "checking") return { tone: "waiting", label: "Checking Worlds…" };
  if (worlds.kind === "failed") return { tone: "waiting", label: "Worlds not checked" };
  if (worlds.kind === "none") return { tone: "waiting", label: "No active World" };
  if (worlds.kind === "one") return worldScreenStatus(worlds.world.revision);
  return { tone: "ok", label: countNoun(worlds.worlds.length, "active World") };
}

/**
  The Home facts line's World piece. One open collection with an active World names its revision, and says
  how many Worlds the workspace has when that is more than one. With none open, it names the workspace's
  own answer: the one active World, or the count and which Ask reads (none until a person chooses).
*/
export function homeWorldFact(activeRevision: number | null, worlds?: WorkspaceWorlds): string {
  if (activeRevision !== null) {
    if (!Number.isInteger(activeRevision) || activeRevision < 1) throw new Error("screen_status_revision_invalid");
    const many = worlds !== undefined && worlds !== "checking" && worlds.kind === "several" ? worlds.worlds.length : 0;
    return many > 1 ? `World v${activeRevision} active here · ${many} Worlds active in this workspace` : `World v${activeRevision} active`;
  }
  if (worlds === undefined) return "No active World";
  if (worlds === "checking") return "Checking Worlds…";
  if (worlds.kind === "failed") return "Worlds not checked";
  if (worlds.kind === "none") return "No active World";
  if (worlds.kind === "one") return `World v${worlds.world.revision} active (${shortCollection(worlds.world.collectionId)})`;
  const latest = worlds.worlds[0];
  return `${countNoun(worlds.worlds.length, "active World")} · most recent ${shortCollection(latest.collectionId)} v${latest.revision} · Ask asks you to choose`;
}

/** The activation block's own status line, unchanged, now in the frame's tag. */
export function activationScreenStatus(activeRevision: number | null): ScreenStatus {
  if (activeRevision === null) return { tone: "waiting", label: "NO ACTIVE WORLD" };
  if (!Number.isInteger(activeRevision) || activeRevision < 1) throw new Error("screen_status_revision_invalid");
  return { tone: "ok", label: `ACTIVE · REVISION ${activeRevision}` };
}

/**
  What the review queue shows as waiting: the same count the top bar prints. Without a compiled candidate there
  is nothing to clear, so a zero is not drawn as "all clear": the dot stays a ring.
*/
export function reviewScreenStatus(reasons: number, hasCandidate: boolean, evidenceRead: WorldEvidenceRead = "ready"): ScreenStatus {
  const n = count(reasons, "reasons");
  if (typeof hasCandidate !== "boolean") throw new Error("screen_status_candidate_invalid");
  const label = `${n} ${n === 1 ? "reason" : "reasons"} to review`;
  /* Recorded reasons are all this counts. With the evidence not loaded a zero is not "all clear" (WO-WS-6, F2). */
  if (hasCandidate && evidenceRead !== "ready") {
    return { tone: "waiting", label: `${label} · evidence ${evidenceRead === "loading" ? "loading" : "not loaded"}` };
  }
  return { tone: n > 0 || !hasCandidate ? "waiting" : "ok", label };
}

/** How many evidence records the comparison can open. */
export function evidenceScreenStatus(records: number, evidenceRead: WorldEvidenceRead = "ready"): ScreenStatus {
  /* Not loaded is not zero: a count over a read that never answered would say there is no evidence. */
  if (evidenceRead === "loading") return { tone: "waiting", label: "Loading evidence…" };
  if (evidenceRead === "unavailable") return { tone: "waiting", label: "Evidence not loaded" };
  const n = count(records, "evidence");
  return { tone: n > 0 ? "ok" : "waiting", label: countNoun(n, "evidence record") };
}

/** How many sources are read and can go into the next World. */
export function readyScreenStatus(ready: number): ScreenStatus {
  const n = count(ready, "ready");
  return { tone: n > 0 ? "ok" : "waiting", label: `${n} ready` };
}

const STOPPED: ReadonlySet<AttentionItem["id"]> = new Set(["refused", "compile-failed"]);
const WAITING: ReadonlySet<AttentionItem["id"]> = new Set(["inventory-incomplete", "candidate-review", "operator-review"]);

/** Needs attention: stopped when any item is a refusal or a failed compile, waiting otherwise. Never drawn empty. */
export function attentionScreenStatus(items: readonly Pick<AttentionItem, "id">[]): ScreenStatus {
  if (items.length === 0) throw new Error("screen_status_attention_empty");
  for (const item of items) {
    if (!STOPPED.has(item.id) && !WAITING.has(item.id)) throw new Error(`screen_status_attention_unknown:${String(item.id)}`);
  }
  return { tone: items.some((item) => STOPPED.has(item.id)) ? "stopped" : "waiting", label: countNoun(items.length, "item") };
}

/** The AI setup panel verifies no connection, and says so in its own foot line; the tag says the same. */
export const AI_SETUP_SCREEN_STATUS: ScreenStatus = { tone: "waiting", label: "Connection not verified" };
