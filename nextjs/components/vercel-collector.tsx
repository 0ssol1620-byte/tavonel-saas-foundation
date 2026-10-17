"use client";

import { useEffect, type ReactNode } from "react";
import { track } from "@vercel/analytics";
import { Analytics } from "@vercel/analytics/next";
import { allowedDetail, type FunnelDetail } from "@/lib/funnel-events";
import { marketingEventPayload, vercelBeforeSend } from "@/lib/marketing-analytics";

/*
  P2-07 (ANALYTICS-ACTIVATION-2026-10-17 §4.4 G1-G2, §5 steps 1-2): the Vercel collector, on the
  Google tag's terms.

  It used to be mounted by the root layout behind the build flag alone, so with the flag on it
  would have loaded before any choice, after a refusal and on the workspace -- while /privacy says
  nothing in the analytics rows is set before you choose and no analytics request is sent after a
  refusal. It now needs the flag, storage read, a stored `true` and a listed public page -- the
  facts `MarketingConsent` holds for the Google tag, which is also what loads this file -- and every
  page view or event it sends passes `vercelBeforeSend`. The hostname check the Google tag has is deliberately absent: Vercel keeps
  preview and production apart, and the preview check is how this collector is verified before
  production (§5 steps 8-9).

  Two reasons stay as they were in the root layout: it loads from `/_vercel/insights` on this
  origin, so the CSP is not widened; and the flag stays fail-closed, because Vercel exposes
  observability build variables even when Web Analytics is off and mounting in that state points
  the browser at a deployment-specific 404.

  Its own file so that it can be loaded lazily (see `MarketingConsent`), and so that the condition
  is the rendered thing a test can count. The condition is repeated here on purpose: this file is
  what renders the SDK's collector component, and it does not rely on its caller for the gate.
*/
export default function VercelCollector({ ready, consent, location }: { ready: boolean; consent: boolean | null; location: string | null }): ReactNode {
  useEffect(() => relayToVercel({ ready, consent, location }, window, () => window.location.pathname), [consent, location, ready]);
  return <>{process.env.NEXT_PUBLIC_TAVONEL_ANALYTICS_ENABLED === "1" && ready && consent === true && location
    ? <Analytics beforeSend={vercelBeforeSend} /> : null}</>;
}

/*
  The Vercel half of the `tavonel:funnel` relay, and the only caller of `track()`. `trackFunnel`
  used to call it for every name on every path, workspace included.

  Nothing listens until the flag is on, storage has been read, the stored answer is yes and the
  page is listed; then each event's name must pass the Google relay's own `marketingEventPayload`
  for the page the reader is on when it fires. The properties are re-filtered through
  `allowedDetail`, because a window event can be dispatched by any script on the page and
  `trackFunnel`'s filtering is not something a listener may assume. A detail that throws is
  dropped. Returns the unsubscribe.
*/
export function relayToVercel(
  state: { ready: boolean; consent: boolean | null; location: string | null },
  target: Pick<EventTarget, "addEventListener" | "removeEventListener">,
  pathname: () => string,
): (() => void) | undefined {
  if (process.env.NEXT_PUBLIC_TAVONEL_ANALYTICS_ENABLED !== "1" || !state.ready || state.consent !== true || !state.location) return undefined;
  const send = (event: Event) => {
    try {
      const detail = (event as CustomEvent).detail;
      const payload = marketingEventPayload(state.consent, pathname(), detail);
      if (payload) track(payload.name, allowedDetail(detail as FunnelDetail));
    } catch { /* dropped: a hostile detail, or a collector failure, is never a product failure */ }
  };
  target.addEventListener("tavonel:funnel", send);
  return () => target.removeEventListener("tavonel:funnel", send);
}
