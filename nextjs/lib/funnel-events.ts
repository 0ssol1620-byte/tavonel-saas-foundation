/**
 * The three moments worth counting, named in one place.
 *
 * Nothing about the funnel is measured today, so every judgement about it -- including the
 * redesign these events were added alongside -- rests on inspection rather than evidence. This
 * module does not fix that on its own and does not pretend to: it transmits nothing, to nowhere.
 *
 * What it does is make attaching a destination a one-line change instead of a hunt through three
 * pages. Each event is dispatched on `window` as `tavonel:funnel`, and a capped in-tab log is
 * kept so a session can be inspected in a console without a network call. Wire a real collector
 * to the event and the vocabulary below is already correct and already called in the right
 * places.
 */

export type FunnelEvent =
  /** A pricing or credit control was chosen, signed in or not. */
  | "offer_selected"
  /** The sign-in page was reached carrying an intent to check out. */
  | "login_reached_with_intent"
  /** A Paddle checkout was actually opened. */
  | "checkout_opened";

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
  window.dispatchEvent(new CustomEvent("tavonel:funnel", { detail: record }));
}
