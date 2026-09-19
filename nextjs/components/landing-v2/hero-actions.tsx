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

  const secondaryLabel = signedIn ? workspaceLabel : accessLabel;
  const secondaryHref = (signedIn ? "/workspace" : accessHref) as Route;
  return (
    <div className="lv2-actions" data-scene-actions={scene}>
      <Link
        className="btn lv2-cta"
        href={exploreHref as Route}
        prefetch={false}
        onClick={() => {
          if (scene === "1") trackFunnel("hero_explore_clicked");
          trackFunnel("cta_clicked", { cta: "explore", scene });
        }}
      >
        {exploreLabel}
      </Link>
      <Link
        className="lv2-text-link"
        href={secondaryHref}
        prefetch={false}
        onClick={() => {
          if (scene === "1") trackFunnel("hero_start_clicked");
          trackFunnel("cta_clicked", { cta: "access", scene });
        }}
      >
        {secondaryLabel}
        <ArrowUpRight size={17} aria-hidden="true" />
      </Link>
    </div>
  );
}
