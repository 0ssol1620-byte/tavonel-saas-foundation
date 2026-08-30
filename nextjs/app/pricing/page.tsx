"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Logomark from "@/components/logomark";
import { useCheckout } from "@/lib/use-checkout";
import { loginUrlForOffer } from "@/lib/checkout-intent";
import type { BillingOfferCode } from "@/lib/billing-catalog";

const PLANS = [
  ["Developer", "$29", "A considered first step.", "observer_access"],
  ["Team", "$99", "For teams building a governed corpus.", "studio_access"],
  ["Enterprise", "Talk to us", "For policy-led knowledge operations.", null],
] as const;

const PACKS = [
  ["Starter", "$12", "100 credits", "credit_starter"],
  ["Builder", "$30", "300 credits", "credit_builder"],
  ["Scale", "$75", "800 credits", "credit_scale"],
] as const;

export default function PricingPage() {
  const [notice, setNotice] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const { start: startCheckout, busy: billingBusy } = useCheckout(setNotice);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { getSupabaseBrowserClient } = await import("@/lib/supabase-browser");
      const client = getSupabaseBrowserClient();
      if (!client || cancelled) return;
      const { data } = await client.auth.getSession();
      if (!cancelled) setSignedIn(Boolean(data.session));
    })();
    return () => { cancelled = true; };
  }, []);

  const showNotice = () =>
    setNotice("This deployment is a private pilot. Provider configuration and sandbox qualification are required before this action is available.");

  const chooseOffer = (offerCode: BillingOfferCode) => {
    if (signedIn) {
      void startCheckout(offerCode);
      return;
    }
    window.location.assign(loginUrlForOffer(offerCode));
  };

  return (
    <div className="page">
      <header className="nav" data-stuck={1}>
        <Link href="/" className="wordmark" aria-label="TAVONEL home">
          <Logomark />
          <b>TAVONEL</b>
        </Link>
        <nav aria-label="Sections">
          <Link href="/">Back to the compiler</Link>
          <Link href="/contact">Talk to us</Link>
        </nav>
        <Link className="btn small" href="/login">Sign in</Link>
      </header>
      <main id="main">
        <section className="scene doc">
          <div className="shell">
            <p className="slate"><b>PRICING</b><span />MEASURED COMPUTE</p>
            <h2>Developer, Team, Enterprise.</h2>
            <p className="lede">
              Access is steady. GPU work is measured. Hard spend limits stay on even after a purchase.
            </p>
            <div className="plans rv">
              {PLANS.map(([name, price, text, offerCode]) => (
                <article className="plan" key={name} data-featured={name === "Team" ? 1 : 0}>
                  <span className="tag">{name === "Team" ? "PRIVATE PILOT CHOICE" : " "}</span>
                  <h3>{name}</h3>
                  <span className="price">{price}{price.startsWith("$") ? <small> / month</small> : null}</span>
                  <p>{text}</p>
                  <button
                    className="btn ghost"
                    type="button"
                    disabled={Boolean(billingBusy)}
                    onClick={() => (offerCode ? chooseOffer(offerCode) : showNotice())}
                  >
                    {name === "Enterprise" ? "Start a conversation" : billingBusy === offerCode ? "Opening checkout…" : signedIn ? "Choose this plan" : "Choose this plan → sign in"}
                  </button>
                </article>
              ))}
            </div>
            <p className="fine">
              Institution and custom engagement guidelines are in the{" "}
              <a href="/legal/TAVONEL_ENTERPRISE_PRICING_2026-08-30.pdf">Enterprise pricing sheet</a>.
            </p>
            <div className="packs rv">
              {PACKS.map(([name, price, credits, offerCode]) => (
                <article className="pack" key={name}>
                  <span className="tag">PREPAID CAPACITY</span>
                  <h3>{name}</h3>
                  <span className="price">{price} <small>{credits}</small></span>
                  <button className="btn ghost" type="button" disabled={Boolean(billingBusy)} onClick={() => chooseOffer(offerCode)}>
                    {billingBusy === offerCode ? "Opening checkout…" : signedIn ? "Buy credits" : "Buy credits → sign in"}
                  </button>
                </article>
              ))}
            </div>
            {notice ? <p className="notice" role="status">{notice}</p> : null}
          </div>
        </section>
      </main>
    </div>
  );
}
