"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Logomark from "@/components/logomark";
import { useCheckout } from "@/lib/use-checkout";
import { loginUrlForOffer } from "@/lib/checkout-intent";
import type { BillingOfferCode } from "@/lib/billing-catalog";
import { formatUsd, quoteCompilePages } from "@/lib/usage-pricing";

const PLANS = [
  {
    name: "Evaluation",
    price: "$0",
    description: "Compile your own sources in an invitation-based evaluation workspace.",
    features: ["Manual upload", "Compiled World + Ask", "No card to request access"],
    offerCode: null,
  },
  {
    name: "Developer",
    price: "$29",
    description: "For builders shipping source-grounded AI.",
    features: ["500 standard compile pages", "1 workspace", "API + MCP", "1 connected source"],
    offerCode: "observer_access",
  },
  {
    name: "Team",
    price: "$99",
    description: "For teams reviewing and governing a shared World.",
    features: ["2,500 standard compile pages", "Up to 5 seats", "Multiple connectors", "Review, versions, budgets"],
    offerCode: "studio_access",
  },
  {
    name: "Enterprise",
    price: "Custom",
    description: "For policy-led knowledge operations and qualified deployment controls.",
    features: ["SSO / SCIM when qualified", "Custom retention and region", "Audit export", "Dedicated support"],
    offerCode: null,
  },
] as const;

export default function PricingPage() {
  const [notice, setNotice] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [commercialMode, setCommercialMode] = useState<"pilot" | "live">("pilot");
  const [pages, setPages] = useState(348);
  const { start: startCheckout, busy: billingBusy } = useCheckout(setNotice);
  const quote = quoteCompilePages(pages);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { getSupabaseBrowserClient } = await import("@/lib/supabase-browser");
      const client = getSupabaseBrowserClient();
      if (client && !cancelled) {
        const { data } = await client.auth.getSession();
        if (!cancelled) setSignedIn(Boolean(data.session));
      }
      try {
        const response = await fetch("/api/status", { cache: "no-store" });
        const status = await response.json() as { commercialMode?: "pilot" | "live" };
        if (!cancelled) setCommercialMode(status.commercialMode === "live" ? "live" : "pilot");
      } catch {
        if (!cancelled) setCommercialMode("pilot");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const requestAccess = () => window.location.assign("/contact");

  const chooseOffer = (offerCode: BillingOfferCode) => {
    if (commercialMode !== "live") {
      window.location.assign("/contact");
      return;
    }
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
            <h1 className="document-title">Pages and dollars.<br />No credit arithmetic.</h1>
            <p className="lede">
              Standard Knowledge Compile is modeled at $0.04 per processed page. Vision escalation
              is charged only when a page needs it, with a $0.06 per-page hard maximum.
            </p>
            <section className="usage-estimator rv" aria-labelledby="usage-estimator-title">
              <div>
                <p className="slate"><b>RUN ESTIMATE</b><span />BEFORE COMPILE</p>
                <h3 id="usage-estimator-title">What will this corpus cost?</h3>
                <label htmlFor="pricing-pages">Processed pages</label>
                <input
                  id="pricing-pages"
                  type="number"
                  min="1"
                  max="10000"
                  step="1"
                  value={pages}
                  onChange={(event) => setPages(Number(event.target.value))}
                />
              </div>
              <dl>
                <div><dt>Standard estimate</dt><dd>{quote ? formatUsd(quote.estimatedUsd) : "—"}</dd></div>
                <div><dt>Maximum charge</dt><dd>{quote ? formatUsd(quote.maximumUsd) : "—"}</dd></div>
                <div><dt>Complex-page escalation</dt><dd>Only when required</dd></div>
              </dl>
            </section>
            <div className="plans rv">
              {PLANS.map((plan) => (
                <article className="plan" key={plan.name} data-featured={plan.name === "Team" ? 1 : 0}>
                  <span className="tag">{plan.name === "Team" ? "TEAM WORKFLOW" : " "}</span>
                  <h3>{plan.name}</h3>
                  <span className="price">{plan.price}{plan.price !== "$0" && plan.price.startsWith("$") ? <small> / month</small> : null}</span>
                  <p>{plan.description}</p>
                  <ul>{plan.features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
                  <button
                    className="btn ghost"
                    type="button"
                    disabled={Boolean(billingBusy)}
                    onClick={() => commercialMode === "pilot" || !plan.offerCode ? requestAccess() : chooseOffer(plan.offerCode)}
                  >
                    {commercialMode === "pilot" ? "Request access" : plan.name === "Enterprise" ? "Start a conversation" : plan.name === "Evaluation" ? "Request evaluation" : billingBusy === plan.offerCode ? "Opening checkout…" : signedIn ? "Choose this plan" : "Choose this plan → sign in"}
                  </button>
                </article>
              ))}
            </div>
            <p className="fine">
              Institution and custom engagement guidelines are in the{" "}
              <a href="/legal/TAVONEL_ENTERPRISE_PRICING_2026-08-30.pdf">Enterprise pricing sheet</a>.
            </p>
            <details className="status-fold rv">
              <summary>How usage is measured</summary>
              <p>
                Usage is measured from processed pages. Every preflight shows the standard estimate
                and the maximum charge before processing begins.
              </p>
              <p className="fine">See the estimated and maximum charge before processing.</p>
            </details>
            {notice ? <p className="notice" role="status">{notice}</p> : null}
          </div>
        </section>
      </main>
    </div>
  );
}
