import type { ScreenStatus } from "@/components/v34/ui/screen";
import type { AttentionItem } from "@/lib/workspace-onboarding";
import { countNoun } from "@/lib/plural";

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
export function reviewScreenStatus(reasons: number, hasCandidate: boolean): ScreenStatus {
  const n = count(reasons, "reasons");
  if (typeof hasCandidate !== "boolean") throw new Error("screen_status_candidate_invalid");
  return { tone: n > 0 || !hasCandidate ? "waiting" : "ok", label: `${n} ${n === 1 ? "reason" : "reasons"} to review` };
}

/** How many evidence records the comparison can open. */
export function evidenceScreenStatus(records: number): ScreenStatus {
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
