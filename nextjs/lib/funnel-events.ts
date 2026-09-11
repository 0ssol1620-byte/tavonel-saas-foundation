/** Privacy-minimal product interaction telemetry. Details are enumerated UI states only: no ids,
 * filenames, prompts, source text, IPs or user-provided strings ever leave through this module. */
import { track } from "@vercel/analytics";

/*
  §40's funnel is landing → Explore → evidence → pricing → start → sign in → first file → compile
  → review → activate → Ask → export/API/MCP → paid, and every name below belongs to one of those
  hops. `lib/funnel-events.test.ts` reads `app` and `components` and fails on a name with no call
  site, because the rule this file already stated -- a name with no caller is a funnel column that
  is always zero, which reads as a broken step rather than as an unbuilt one -- was true of four
  of them and nothing was checking.

  Removed for that reason, not deprecated: `offer_selected` (the pricing cards fire
  `pricing_plan_viewed` and `pricing_start_clicked`; nothing ever fired this),
  `film_stage_selected`, `world_lens_selected` and `workspace_command_used`. None of the three
  controls they name -- a film stage rail, a World lens selector, a command palette -- exists in
  this deployment, and none of the three is a §40 hop. If one is built, the name comes back in
  the same commit as its call site, which is now the only way the suite will accept it.

  `offer_selected` also survived the `be17e00` merge on the other side and was dropped again here
  rather than by accident: that commit added `generate_lead` with a caller and left
  `offer_selected` exactly as it was, with none.
*/
export type FunnelEvent =
  /*
    The lead hop, from the consent-gated marketing measurement merged in `be17e00`. It fires from
    `components/contact-form.tsx` on a sales or partnership enquiry that passed the honeypot and
    timing checks, which is a real control, so it stays.
  */
  | "generate_lead"
  | "login_reached_with_intent"
  /*
    `login_reached_with_intent` counts arriving at the sign-in page. Without this, the funnel has
    no closing half for that hop, and a Google OAuth round trip that silently fails is reported as
    a reader who changed their mind. It fires on the one point in `app/auth/callback/page.tsx`
    where the session and the access bootstrap have both succeeded -- not on the callback mounting,
    which happens for every failure phase too.
  */
  | "signed_in"
  | "checkout_opened"
  | "checkout_completed"
  | "scene_reached"
  | "cta_clicked"
  | "source_filter_changed"
  /*
    The §32 names, added only where a real control in this lane fires them.

    The blueprint lists twenty. The seven below are the ones the conversion surfaces own a
    control for; the Explore and Workspace names follow, and were added when those two surfaces
    got their control instrumented.
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
  /*
    The compile hop is the one place §40 asks for abandonment, and a funnel that only counts the
    compiles that reached a candidate reports abandonment as silence. It carries no detail: the
    server's `errorCode` is typed `string`, not an enumerated set, and a code that widens later
    would put an unenumerated value on the wire through the one module that promises there are
    none. The fact of the failure is the funnel step; the reason belongs in error telemetry.
  */
  | "workspace_compile_failed"
  | "workspace_candidate_ready"
  | "workspace_review_required"
  | "workspace_world_activated"
  | "workspace_first_ask"
  | "workspace_ai_connect_opened";

/*
  §15.2's product events, which the client half above cannot honestly carry.

  Everything in `FunnelEvent` fires from a control in a browser, and §15.2's rule is that a
  product event is a server state or a real consumer receipt -- "an export click is not a
  package verified". A click and the server's own record of what happened are two different
  measurements, so they are two different unions with two different sinks rather than one name
  fired from whichever side happened to notice. None of the twenty-nine names above changes
  meaning, and none of the nine below duplicates one: `workspace_compile_started` counts a
  reader pressing Compile, `compile_started` counts the server accepting the work.

  The sink is one structured line per event on the server log -- the same shape
  `app/api/csp-report/route.ts` and `app/api/paddle/webhook/route.ts` already emit, read by the
  platform's log drain. Deliberately not the web analytics collector `trackFunnel` posts to:
  consent is a browser fact (`lib/marketing-analytics.ts` reads it out of localStorage), a route
  handler has no way to ask, and a server that posted a signed-in customer's activity to an
  external collector on nobody's consent would be the exact thing §15.1 forbids. Deliberately
  not a table either: a new one needs a migration, and these events carry no identifier worth
  storing -- the cohort work in `lib/activation-cohorts.ts` reads the records the product
  already keeps instead.

  Five of §15.2's seventeen are missing on purpose, and the sixth is renamed. `content_view`,
  `sample_opened`, `recipe_start_clicked`, `auth_completed`, `recipe_resumed` and
  `preflight_confirmed` are browser facts on public pages -- the first two are already
  `explore_entered` and `explore_evidence_opened`, `auth_completed` is already `signed_in`, and
  the last three have no control in this deployment yet. `package_verified` is not observable
  here at all: `verifyExportSignature` has no route that calls it, so the server can say it
  signed a package and cannot say anyone verified one -- `export_package_signed` is what is
  actually measured, under the name of what is actually measured. `repeat_task_completed` and
  `subscription_retained` both need per-workspace history that no single request has; they are
  cohort readings, and `lib/activation-cohorts.ts` computes them as R1.
*/
export type ServerFunnelEvent =
  | "compile_started"
  | "candidate_ready"
  | "review_completed"
  | "world_activated"
  | "source_revision_applied"
  | "grounded_task_completed"
  | "external_consumer_succeeded"
  | "export_package_signed"
  | "subscription_started";

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

/*
  One structured line per server event, on the process log.

  It takes the same `FunnelDetail` the browser half takes and runs it through the same
  `allowedDetail`, so the key allowlist is one list rather than two that drift: a route that
  wants to attach a collection id, a filename or the question a customer typed finds the key
  rejected by the type and dropped at runtime, exactly as a component does.

  There is no `once` variant. Each caller fires on a server state transition that happens once
  per job, per World or per decision -- not on a poll, which is why `candidate_ready` fires from
  the worker turn that compiled the package and not from the status endpoint a browser calls
  every few seconds while it waits.
*/
export function recordServerFunnel(event: ServerFunnelEvent, detail?: FunnelDetail) {
  console.info(JSON.stringify({ event, ...allowedDetail(detail) }));
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
