"use client";

import { useEffect } from "react";
import { trackFunnel, trackFunnelOnce, type FunnelDetail, type FunnelEvent } from "@/lib/funnel-events";
import type { LandingVariant } from "@/lib/landing-experiments";

/*
  D7 / §30: every Landing V2 funnel event, fired from one place.

  WHY ONE COMPONENT AND NOT FIFTEEN HANDLERS. Eight of the nine scenes are server components that
  ship no JavaScript at all; that is the reason the page's first paint is the server's and the
  route's JS budget is what it is. Putting an `onClick` on the links that matter would turn four
  of those scenes into client components to fire an event each. So the scenes stay server-side
  and expose two kinds of hook -- a `data-analytics` attribute where the control is not a link,
  and a real `href` where it is -- and this file, mounted once inside `main`, listens for both.

  SCOPED TO `main`, DELIBERATELY. The listeners attach to the landing's own `<main>` and not to
  the document, so the site header and footer are outside them. `/pricing` and `/security` are in
  the chrome of every page on this site; counting a header click as a landing conversion here and
  nowhere else would make `pricing_open` mean two different things depending on which page the
  reader happened to be on. What this measures is the landing's own scenes.

  WHAT MAY NOT TRAVEL. Everything below sends an enumerated UI state or nothing: a tab position,
  which scene a source was opened from, the experiment arm. No href, no filename, no excerpt, no
  region id, no heading text. `FUNNEL_DETAIL_KEYS` is the enforcement; this comment is the intent.
*/

/** The delegated click hooks the scene lanes exposed, and the event each one means. */
const CLICK_HOOKS: Record<string, FunnelEvent> = {
  "hero-primary": "hero_primary_click",
  "hero-secondary": "hero_secondary_click",
  "proof-tab": "proof_claim_switch",
  "source-open": "source_open",
};

/*
  Destination-routed events (D7): three names that mean "the reader went to look at X", where X
  is a set of real routes rather than one control. Matching the pathname instead of tagging each
  link keeps this true when a scene adds a second link to the same place, and it is why
  `integration_open` covers `/docs/*` -- §17's OUT column is four docs pages, and a reader
  opening the MCP page from the landing has the same intent as one opening `/integrations`.
*/
const DESTINATIONS: ReadonlyArray<[FunnelEvent, RegExp]> = [
  ["integration_open", /^\/(?:integrations|sources|docs)(?:\/|$)/],
  ["trust_open", /^\/(?:trust|security|subprocessors)(?:\/|$)/],
  ["pricing_open", /^\/pricing(?:\/|$)/],
];

const QUARTILES: ReadonlyArray<[number, FunnelEvent]> = [
  [0.25, "scroll_scene_25"],
  [0.5, "scroll_scene_50"],
  [0.75, "scroll_scene_75"],
  [1, "scroll_scene_100"],
];

/**
 * Which scene an element is in, as `source_open`'s `from` spells it.
 *
 * Three values and no more: the hero's compiled claim, Scene 02's per-tab "Open source", and
 * Scene 04's "Open original". The section id is the carrier because it is the same id §9 and
 * `LANDING_V2_SCENE_ORDER` already fix; anything else resolves to the proof scene rather than
 * inventing a fourth enumerated value at run time.
 */
function sourceFrom(element: Element): string {
  const scene = element.closest("section[data-scene]")?.id;
  if (scene === "hero") return "hero";
  return scene === "evidence" ? "inspector" : "proof";
}

/** A tab's position in its own group, as "1" | "2" | "3" -- never its label and never its id. */
function tabPosition(tab: Element): string {
  const group = tab.closest('[role="tablist"]');
  const tabs = group ? [...group.querySelectorAll('[role="tab"]')] : [];
  return String(tabs.indexOf(tab) + 1);
}

export default function LandingAnalytics({ variant }: { variant?: LandingVariant }) {
  useEffect(() => {
    const main = document.getElementById("main");
    if (!main) return;

    /* The D8 arm rides along on every landing event, and is absent while no test is running. */
    const arm: FunnelDetail | undefined = variant ? { variant } : undefined;
    const send = (event: FunnelEvent, detail?: FunnelDetail) =>
      trackFunnel(event, detail || arm ? { ...detail, ...arm } : undefined);

    const onClick = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      /*
        §11's signature interaction is a link, so a click on the hero's compiled claim is a
        reader opening the evidence behind it -- the same act Scene 02 and Scene 04 offer with a
        labelled link. It carries no `data-analytics` hook because `CompiledClaim` is a shared
        presentational primitive (D10), and a landing analytics hook does not belong inside one.
      */
      if (target.closest("#hero a.lv2-claim")) {
        send("source_open", { from: "hero" });
        return;
      }

      const hooked = target.closest<HTMLElement>("[data-analytics]");
      const hook = hooked?.dataset.analytics ?? "";
      if (hooked && hook in CLICK_HOOKS) {
        const name = CLICK_HOOKS[hook];
        if (name === "proof_claim_switch") send(name, { cta: tabPosition(hooked) });
        else if (name === "source_open") send(name, { from: sourceFrom(hooked) });
        else send(name);
        return;
      }

      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      /*
        Same-origin only. An absolute href to another site is not a route of this one, and
        resolving a `mailto:` or a bare fragment must not be read as a pathname of ours.
      */
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      for (const [name, pattern] of DESTINATIONS) {
        if (pattern.test(url.pathname)) {
          send(name);
          return;
        }
      }
    };

    /*
      `hero_demo_interact` -- once per page session, whichever way the reader touched the demo.

      The triggers are the play/pause control and the two §4.1 signature objects, on pointer and
      on keyboard focus alike, because the interaction the hero is built around is reachable both
      ways and an event that counted only the mouse would report the keyboard path as unused.
      `trackFunnelOnce` is what keeps a reader who sweeps a pointer across the stage from
      producing a hundred rows of it.
    */
    const onDemo = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(".lv2-demo-control, .lv2-demo .lv2-claim, .lv2-demo .lv2-node")) {
        trackFunnelOnce("hero_demo_interact", arm);
      }
    };

    main.addEventListener("click", onClick);
    main.addEventListener("pointerover", onDemo);
    main.addEventListener("focusin", onDemo);

    /*
      Scroll depth as scene depth, not as pixels.

      §9 fixes nine scenes, so a reader's progress through this page is which scene they reached:
      scene 1 is 0% and scene 9 is 100%, which puts the three interior quartiles exactly on
      scenes 3, 5 and 7 -- `(index) / (count - 1)`. That is a truer measurement than a fraction
      of `scrollHeight`, because the page is about 9,000px on a desktop and about 24,000px on a
      phone, and "half way down" is a different chapter in each.

      Every quartile at or below the deepest scene reached fires, so a reader who arrives on
      `#trust` from a deep link is not recorded as having skipped the first three. Each name
      fires once per page session, which is `trackFunnelOnce`'s own scope.
    */
    const sections = [...main.querySelectorAll<HTMLElement>("section[data-scene]")];
    const observer =
      sections.length > 1
        ? new IntersectionObserver(
            (entries) => {
              for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                const depth = sections.indexOf(entry.target as HTMLElement) / (sections.length - 1);
                for (const [threshold, name] of QUARTILES) {
                  if (depth >= threshold) trackFunnelOnce(name, arm);
                }
              }
            },
            { threshold: 0 },
          )
        : undefined;
    for (const section of sections) observer?.observe(section);

    return () => {
      main.removeEventListener("click", onClick);
      main.removeEventListener("pointerover", onDemo);
      main.removeEventListener("focusin", onDemo);
      observer?.disconnect();
    };
  }, [variant]);

  return null;
}
