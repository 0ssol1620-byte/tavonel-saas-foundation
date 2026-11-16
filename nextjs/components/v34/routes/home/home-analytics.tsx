"use client";

import { useEffect } from "react";
import { trackFunnel, trackFunnelOnce, type FunnelEvent } from "@/lib/funnel-events";

/*
  The home page's funnel events, fired from one delegated listener inside `main` so the sections
  stay server components. No new event names: every one is already a `FunnelEvent` and a
  `MARKETING_EVENTS` member (architecture 3.11).

  - `data-analytics="hero-primary" | "hero-secondary"`  the two hero actions
  - a click on a link to Connect, Developers, Security, Evidence or Pricing  `integration_open`, `trust_open`, `pricing_open`
  - the first touch of the walkthrough  `hero_demo_interact`, once per page session

  It sends no detail at all: no href, no label, no record id.
*/

const HOOKS: Record<string, FunnelEvent> = {
  "hero-primary": "hero_primary_click",
  "hero-secondary": "hero_secondary_click",
};

const DESTINATIONS: ReadonlyArray<[FunnelEvent, RegExp]> = [
  ["integration_open", /^\/(?:connect|developers)(?:\/|$)/],
  ["trust_open", /^\/(?:security|evidence)(?:\/|$)/],
  ["pricing_open", /^\/pricing(?:\/|$)/],
];

export default function HomeAnalytics() {
  useEffect(() => {
    const main = document.getElementById("main");
    if (!main) return;

    const onClick = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      if (target.closest("[data-v34-walkthrough] button")) trackFunnelOnce("hero_demo_interact");

      const hooked = target.closest<HTMLElement>("[data-analytics]");
      const hook = hooked?.dataset.analytics ?? "";
      if (Object.hasOwn(HOOKS, hook)) {
        trackFunnel(HOOKS[hook]!);
        return;
      }

      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      for (const [name, pattern] of DESTINATIONS) {
        if (pattern.test(url.pathname)) {
          trackFunnel(name);
          return;
        }
      }
    };

    main.addEventListener("click", onClick);
    return () => main.removeEventListener("click", onClick);
  }, []);

  return null;
}
