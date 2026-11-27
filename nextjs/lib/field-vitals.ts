import { readConsent } from "./marketing-analytics";

/*
  WO-AN-RUM-1: field LCP / INP / CLS with the browser's PerformanceObserver and no library (the
  WO-CI-16 candidate, receipts/WO-CI-16/field-vitals-candidate.js, made real). It is loaded lazily by
  `components/marketing-consent.tsx` only after a stored yes on a listed public page, so a visitor
  who has not allowed analytics never downloads it.

  One report per page load, when the page is hidden, to our own `/api/field-vitals` -- no vendor.
  It carries the path of the document that loaded (from the navigation entry, so a client-side
  navigation afterwards does not relabel it) and three rounded numbers. The stored choice is read
  again at send time: a visitor who withdrew in this page sends nothing.

  INP here is the largest event-timing duration with an interaction id (a stated simplification of
  the p98 rule; below 50 interactions on a page the two are the same). CLS is the largest session
  window (gap < 1 s, window < 5 s), as the metric is defined. LCP stops at the first input.
*/
let started = false;

/** Idempotent: the consent component may call it again on a client-side navigation; one load reports once. */
export function observeFieldVitals() {
  if (started || typeof PerformanceObserver === "undefined" || typeof navigator.sendBeacon !== "function") return;
  started = true;
  const supported = PerformanceObserver.supportedEntryTypes ?? [];
  let lcp = 0, cls = 0, session = 0, sessionStart = 0, last = 0, inp = 0, sent = false;
  const watch = (type: string, onEntry: (entry: PerformanceEntry & Record<string, unknown>) => void, extra?: object) => {
    if (!supported.includes(type)) return;
    new PerformanceObserver((list) => list.getEntries().forEach((entry) => onEntry(entry as PerformanceEntry & Record<string, unknown>)))
      .observe({ type, buffered: true, ...extra } as PerformanceObserverInit);
  };
  watch("largest-contentful-paint", (entry) => { lcp = entry.startTime; });
  watch("layout-shift", (entry) => {
    if (entry.hadRecentInput) return;
    if (entry.startTime - last > 1000 || entry.startTime - sessionStart > 5000) { session = 0; sessionStart = entry.startTime; }
    session += Number(entry.value) || 0; last = entry.startTime;
    if (session > cls) cls = session;
  });
  watch("event", (entry) => { if (entry.interactionId && entry.duration > inp) inp = entry.duration; }, { durationThreshold: 40 });
  addEventListener("visibilitychange", () => {
    if (sent || document.visibilityState !== "hidden") return;
    sent = true;
    let allowed: boolean | null = null;
    try { allowed = readConsent(localStorage); } catch { /* unreadable storage is not a yes */ }
    if (allowed !== true) return;
    const loaded = performance.getEntriesByType("navigation")[0]?.name;
    let path = location.pathname;
    try { if (loaded) path = new URL(loaded).pathname; } catch { /* keep the current path */ }
    // A metric this browser cannot observe is left out, never sent as 0 (Safari has no layout-shift).
    const report: Record<string, number | string> = { path };
    if (supported.includes("layout-shift")) report.cls = Math.round(cls * 1000) / 1000;
    if (lcp > 0) report.lcp = Math.round(lcp);
    if (inp > 0) report.inp = Math.round(inp);
    // A string body goes as text/plain, the one type every browser's sendBeacon accepts.
    if (Object.keys(report).length > 1) navigator.sendBeacon("/api/field-vitals", JSON.stringify(report));
  }, true);
}
