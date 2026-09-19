"use client";

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { trackFunnel } from "@/lib/funnel-events";

/*
  The hero's two actions, and the only part of the hero that needs a browser.

  §29 and D8 Test 02 A set the hierarchy, and it is the one place on this site where the filled
  button is not the commercial action: Explore a Compiled World is filled because the fastest way
  to believe this product is to open a finished World, and the commercial action sits beside it
  as a text link with an arrow. Both are real conversions and the analytics names say which is
  which.

  The session lookup is the pattern `components/home-page-client.tsx` used, kept because it is
  the reason this is a client component at all: a reader who is already signed in is offered
  their workspace rather than an access request they have already made. It subscribes before
  reading the initial session and disposes even when the dynamic import resolves after unmount,
  and a failure leaves the signed-out labels rather than an empty row -- a public page stays
  usable when session lookup is not.

  Which of the two access actions applies is the server's answer (`isLiveCommerce()`), passed in
  already resolved: the unprefixed commercial flags inline as `undefined` in a client bundle
  (BA-232), so a component that read them here would quietly render the closed posture.
*/
export default function HeroActions({
  exploreLabel,
  exploreHref,
  accessLabel,
  accessHref,
  workspaceLabel,
  scene,
  ctaOrderVariant = "a",
}: {
  exploreLabel: string;
  exploreHref: string;
  /** The label and destination of whichever access action the commercial posture chose. */
  accessLabel: string;
  accessHref: string;
  /** Where a signed-in reader is sent instead, in the language of the page. */
  workspaceLabel: string;
  /*
    Which scene this row is in, as `data-scene` spells it. The two `hero_*` names are the
    funnel's oldest landing columns and keep meaning only while they count the hero's own
    clicks (D7: keep the existing names and their callers), so the close fires `cta_clicked`
    with its own scene and nothing else.
  */
  scene: string;
  /*
    D8 Test 02: which of the two actions is the filled control. "a" -- the default, and what
    every deployment renders while no experiment is active -- is Explore, for §29's reason: the
    fastest way to believe this product is to open a finished World. "b" swaps them and makes
    the access action primary. Nothing else changes: both controls are present on both arms,
    both keep their own destination, and both keep the funnel name that says which one it is.
  */
  ctaOrderVariant?: "a" | "b" | "c";
}) {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    void (async () => {
      const { getSupabaseBrowserClient } = await import("@/lib/supabase-browser");
      const client = getSupabaseBrowserClient();
      if (!client || cancelled) return;
      const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
        if (!cancelled) setSignedIn(Boolean(session));
      });
      unsubscribe = () => listener.subscription.unsubscribe();
      const { data } = await client.auth.getSession();
      if (!cancelled) setSignedIn(Boolean(data.session));
    })().catch(() => {
      /* A public page remains usable when session lookup is unavailable. */
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const accessRowLabel = signedIn ? workspaceLabel : accessLabel;
  const accessRowHref = (signedIn ? "/workspace" : accessHref) as Route;

  /*
    THE TWO ACTIONS AS DATA, SO D8 TEST 02 IS AN ORDER AND NOT A SECOND COMPOSITION.

    Each descriptor carries its own destination and its own funnel name, and the arm decides only
    which of them is rendered first and filled. That separation is the point of the test: the
    names below travel with the DESTINATION (Explore, access) and keep meaning on both arms,
    while `hero_primary_click` / `hero_secondary_click`, which D7 adds and
    `components/landing-v2/landing-analytics.tsx` fires off the `data-analytics` hooks, travel
    with the POSITION. Reading the two pairs together is what says whether making the access
    action primary moved anything, and either pair alone cannot.

    `hero_explore_clicked` and `hero_start_clicked` are kept firing exactly as before (D7): they
    are the funnel's oldest landing columns, somebody is reading them today, and a dashboard that
    went to zero the day this page shipped would report a launch as a collapse.
  */
  const explore = {
    label: exploreLabel,
    href: exploreHref as Route,
    cta: "explore",
    legacy: "hero_explore_clicked",
  } as const;
  const access = {
    label: accessRowLabel,
    href: accessRowHref,
    cta: "access",
    legacy: "hero_start_clicked",
  } as const;
  const [primary, secondary] = ctaOrderVariant === "b" ? [access, explore] : [explore, access];

  const onSelect = (action: typeof explore | typeof access) => () => {
    if (scene === "1") trackFunnel(action.legacy);
    trackFunnel("cta_clicked", { cta: action.cta, scene });
  };

  return (
    <div className="lv2-actions" data-scene-actions={scene}>
      <Link
        className="btn lv2-cta"
        href={primary.href}
        prefetch={false}
        onClick={onSelect(primary)}
        /* D7's position names are fired by the landing's one delegated listener, off these. */
        data-analytics="hero-primary"
      >
        {primary.label}
      </Link>
      <Link
        className="lv2-text-link"
        href={secondary.href}
        prefetch={false}
        onClick={onSelect(secondary)}
        data-analytics="hero-secondary"
      >
        {secondary.label}
        <ArrowUpRight size={17} aria-hidden="true" />
      </Link>
    </div>
  );
}
