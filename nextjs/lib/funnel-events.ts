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
    control for; the Explore and Workspace names are not declared here. A name in this union
    with no call site is a funnel column that is always zero, which reads as a broken step
    rather than as an unbuilt one.
  */
  | "hero_explore_clicked"
  | "hero_start_clicked"
  | "pricing_plan_viewed"
  | "pricing_start_clicked"
  | "source_category_viewed"
  | "developer_mcp_started"
  | "developer_api_started";

const LOG_KEY = "tavonel.funnel-log";
const LOG_LIMIT = 50;

export function trackFunnel(event: FunnelEvent, detail?: Record<string, string>) {
  if (typeof window === "undefined") return;
  const record = { event, ...detail };
  try {
    const existing = JSON.parse(window.sessionStorage.getItem(LOG_KEY) ?? "[]") as unknown[];
    existing.push(record);
    window.sessionStorage.setItem(LOG_KEY, JSON.stringify(existing.slice(-LOG_LIMIT)));
  } catch { /* analytics must never break the user's action */ }
  try { track(event, detail); } catch { /* collector absence is not a product failure */ }
  window.dispatchEvent(new CustomEvent("tavonel:funnel", { detail: record }));
}

let deepestScene = 0;
export function trackSceneDepth(scene: number) {
  if (!Number.isFinite(scene) || scene <= deepestScene) return;
  deepestScene = scene;
  trackFunnel("scene_reached", { scene: String(scene) });
}
