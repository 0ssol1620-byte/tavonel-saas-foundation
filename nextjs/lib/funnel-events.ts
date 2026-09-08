/** Privacy-minimal product interaction telemetry. Details are enumerated UI states only: no ids,
 * filenames, prompts, source text, IPs or user-provided strings ever leave through this module. */
import { track } from "@vercel/analytics";

export type FunnelEvent =
  | "offer_selected"
  | "login_reached_with_intent"
  | "checkout_opened"
  | "scene_reached"
  | "cta_clicked"
  | "film_stage_selected"
  | "source_filter_changed"
  | "world_lens_selected"
  | "workspace_command_used"
  /*
    The §32 names, added only where a real control in this lane fires them.

    The blueprint lists twenty. The seven below are the ones the conversion surfaces own a
    control for; the Explore and Workspace names follow, and were added when those two surfaces
    got their control instrumented. A name in this union with no call site is a funnel column
    that is always zero, which reads as a broken step rather than as an unbuilt one.
  */
  | "hero_explore_clicked"
  | "hero_start_clicked"
  | "pricing_plan_viewed"
  | "pricing_start_clicked"
  | "source_category_viewed"
  | "developer_mcp_started"
  | "developer_api_started"
  /*
    §26 Explore and Workspace. Every one of these fires from a control that already existed --
    the act rail, the object selection funnel, the evidence openers, the Ask bar, the end CTA,
    the upload and connector paths, the compile request, the candidate transition, the promote
    button, the grounded Ask and the Use-with-AI disclosure.

    `workspace_ai_connect_opened` is the one worth naming: there is no connect dialog in this
    deployment. It fires when the reader opens the Use with AI guide, which is the only MCP/API
    intent signal the workspace actually has. An event named for a screen that does not exist
    would be a funnel step measuring nothing.
  */
  | "explore_entered"
  | "explore_object_selected"
  | "explore_evidence_opened"
  | "explore_change_opened"
  | "explore_ask_used"
  | "explore_to_signup"
  | "workspace_first_source_added"
  | "workspace_compile_started"
  | "workspace_candidate_ready"
  | "workspace_review_required"
  | "workspace_world_activated"
  | "workspace_first_ask"
  | "workspace_ai_connect_opened";

/*
  The property allowlist -- the enforced half of the sentence at the top of this file.

  Instrumenting a signed-in workspace is where a comment stops being enough. The values that
  would be most convenient to send there are precisely the forbidden ones: the collection id, the
  filename, the question text, the reason a reviewer typed. So the keys are enumerated, the type
  rejects anything else at the call site, and `trackFunnel` drops an unlisted key at runtime
  rather than trusting that every future caller compiled against this file.

  Every key below carries an enumerated UI state or a `String(...)` of a count. None of them can
  hold a name, an identifier or anything a person typed -- which is a property of what the call
  sites pass, so `lib/funnel-events.test.ts` pins the list and this comment together.
*/
export const FUNNEL_DETAIL_KEYS = ["act", "cta", "family", "filter", "from", "kind", "lifecycle", "mode", "offer", "plan", "plans", "scene", "sources", "status"] as const;
export type FunnelDetailKey = (typeof FUNNEL_DETAIL_KEYS)[number];
export type FunnelDetail = Partial<Record<FunnelDetailKey, string>>;

const ALLOWED = new Set<string>(FUNNEL_DETAIL_KEYS);

/** Exported for the test: the runtime half of the allowlist, applied to every event. */
export function allowedDetail(detail?: FunnelDetail): Record<string, string> | undefined {
  if (!detail) return undefined;
  const kept = Object.entries(detail).filter(([key, value]) => ALLOWED.has(key) && typeof value === "string");
  return kept.length > 0 ? Object.fromEntries(kept) : undefined;
}

const LOG_KEY = "tavonel.funnel-log";
const LOG_LIMIT = 50;

export function trackFunnel(event: FunnelEvent, detail?: FunnelDetail) {
  if (typeof window === "undefined") return;
  const safe = allowedDetail(detail);
  const record = { event, ...safe };
  try {
    const existing = JSON.parse(window.sessionStorage.getItem(LOG_KEY) ?? "[]") as unknown[];
    existing.push(record);
    window.sessionStorage.setItem(LOG_KEY, JSON.stringify(existing.slice(-LOG_LIMIT)));
  } catch { /* analytics must never break the user's action */ }
  try { track(event, safe); } catch { /* collector absence is not a product failure */ }
  window.dispatchEvent(new CustomEvent("tavonel:funnel", { detail: record }));
}

/*
  "First" in `workspace_first_source_added` and `workspace_first_ask` is a real word, and the
  handlers those events hang off run on every source and every question. A page-session flag is
  the honest scope: it is the same span the funnel log already covers, and it needs no id to
  decide whether it has seen one before -- which is the whole reason not to key it on the
  workspace.
*/
const fired = new Set<FunnelEvent>();
export function trackFunnelOnce(event: FunnelEvent, detail?: FunnelDetail) {
  if (fired.has(event)) return;
  fired.add(event);
  trackFunnel(event, detail);
}

let deepestScene = 0;
export function trackSceneDepth(scene: number) {
  if (!Number.isFinite(scene) || scene <= deepestScene) return;
  deepestScene = scene;
  trackFunnel("scene_reached", { scene: String(scene) });
}
