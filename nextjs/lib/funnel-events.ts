/**
 * The moments worth counting, named in one place.
 *
 * Each event goes three places at once, and the three are not redundant. It is dispatched on
 * `window` as `tavonel:funnel` so anything on the page can react to it; a capped in-tab log is
 * kept in `sessionStorage` so a single session can be inspected in a console with no network
 * call at all; and it is forwarded to Vercel Analytics, which is the only destination that
 * survives the tab closing.
 *
 * Vercel Analytics is the collector because of what it does *not* do: it is served from this
 * origin (`/_vercel/insights/*`), so the strict CSP in `next.config.mjs` admits it without a
 * single directive being widened, it sets no cookie, and it stores no identifier that would
 * oblige this page to grow a consent banner. A page whose entire argument is "we show you what
 * we actually did" should not be measured by something it would have to apologise for.
 *
 * Two honesty notes that belong next to the code rather than in a commit message:
 *  - Custom events (`track`) are a paid Vercel feature. On a free plan the page still works and
 *    still reports pageviews; the custom events below are simply dropped. Nothing here should be
 *    read as proof that funnel data exists -- only that it is being sent.
 *  - Nothing sent from here identifies a visitor. Details are small enumerated strings (which
 *    offer, which scene, signed in or not), never free text, never an address, never an id.
 */

import { track } from "@vercel/analytics";

export type FunnelEvent =
  /** A pricing or credit control was chosen, signed in or not. */
  | "offer_selected"
  /** The sign-in page was reached carrying an intent to check out. */
  | "login_reached_with_intent"
  /** A Paddle checkout was actually opened. */
  | "checkout_opened"
  /** The deepest scene the visitor has reached this session moved forward. */
  | "scene_reached"
  /** A call to action was clicked, named by where it sits rather than by its label. */
  | "cta_clicked";

const LOG_KEY = "tavonel.funnel-log";
const LOG_LIMIT = 50;

export function trackFunnel(event: FunnelEvent, detail?: Record<string, string>) {
  if (typeof window === "undefined") return;
  const record = { event, ...detail };
  try {
    const existing = JSON.parse(window.sessionStorage.getItem(LOG_KEY) ?? "[]") as unknown[];
    existing.push(record);
    window.sessionStorage.setItem(LOG_KEY, JSON.stringify(existing.slice(-LOG_LIMIT)));
  } catch {
    // Storage being unavailable must never break the control the visitor just clicked.
  }
  try {
    track(event, detail);
  } catch {
    // Same rule as storage: a blocked or absent collector is not the visitor's problem.
  }
  window.dispatchEvent(new CustomEvent("tavonel:funnel", { detail: record }));
}

/**
 * Scene depth, reported as a high-water mark rather than a trail.
 *
 * The question this answers is "where do people stop reading", and that question is answered by
 * the furthest scene reached, not by every crossing. Scrolling back up to re-read scene 02 is
 * not a second data point, and firing on every crossing would make a page that is *pleasant to
 * scroll through twice* look identical to one nobody finished.
 */
let deepestScene = 0;

export function trackSceneDepth(scene: number) {
  if (!Number.isFinite(scene) || scene <= deepestScene) return;
  deepestScene = scene;
  trackFunnel("scene_reached", { scene: String(scene) });
}
