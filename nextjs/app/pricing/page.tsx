"use client";

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useState } from "react";
import Logomark from "@/components/logomark";
import { useCheckout } from "@/lib/use-checkout";
import { loginUrlForOffer } from "@/lib/checkout-intent";
import { BILLING_OFFERS, type BillingOfferCode } from "@/lib/billing-catalog";
import { FOOTER_GROUPS, PRIMARY_NAV } from "@/lib/site-navigation";
import { formatUsd, quoteCompilePages } from "@/lib/usage-pricing";

/*
  Plans come from the billing catalog, not from a second list kept next to it.

  The array that used to live here promised Developer "500 standard compile pages" while the
  compile route demanded a Team subscription, and promised Team "Up to 5 seats" against a
  product with no invitations, roles or seat accounting. It also advertised Enterprise
  "SSO / SCIM when qualified" — a feature card for something that does not exist, with the
  qualification caveat doing the work a missing feature should do, which is to be missing.
*/
const PAID_PLANS = (Object.entries(BILLING_OFFERS) as Array<[BillingOfferCode, (typeof BILLING_OFFERS)[BillingOfferCode]]>)
  .map(([offerCode, offer]) => ({
    name: offer.label,
    price: `$${offer.priceUsd}`,
    description: offer.description,
    features: offer.features as readonly string[],
    // A plan whose product is unfinished is sold through a conversation, whatever the
    // commercial mode says. See `saleChannel` in the billing catalog.
    offerCode: offer.saleChannel === "self_serve" ? offerCode : null,
  }));

const EVALUATION = {
  name: "Evaluation",
  price: "$0",
  description: "Try TAVONEL with your own files. No card required.",
  features: [
    "Up to 3 files and 50 standard pages",
    "1 Compiled World with Evidence and Ask",
    "Signed export",
    "7 days, no card required",
  ],
  offerCode: null,
} as const;

const ENTERPRISE = {
  name: "Enterprise",
  price: "Custom",
  description: "For larger corpora and knowledge operations run by a team.",
  features: ["Custom volume", "Custom retention review", "Audit export", "Dedicated onboarding and support"],
  offerCode: null,
} as const;

const PLANS = [EVALUATION, ...PAID_PLANS, ENTERPRISE];

export default function PricingPage() {
  const [notice, setNotice] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  /*
    Whether a real charge is possible, not merely which mode a label says.

    The page used to read `commercialMode` alone, which is one of the three inputs to that
    question; a deployment could report mode "live" with launch approval withheld and this page
    would offer a checkout the API then refused.
  */
  const [liveCheckout, setLiveCheckout] = useState(false);
  const [selfService, setSelfService] = useState(false);
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
        const status = await response.json() as { liveCheckout?: boolean; selfService?: boolean };
        if (!cancelled) {
          setLiveCheckout(status.liveCheckout === true);
          setSelfService(status.selfService === true);
        }
      } catch {
        // Fail closed: an unreachable status endpoint must never open checkout or public signup.
        if (!cancelled) {
          setLiveCheckout(false);
          setSelfService(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const requestAccess = () => window.location.assign("/contact");
  const startEvaluation = () => window.location.assign(selfService ? "/login" : "/contact");

  const chooseOffer = (offerCode: BillingOfferCode) => {
    if (!liveCheckout) {
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
          {PRIMARY_NAV.map((link) => <Link key={link.href} href={link.href as Route}>{link.label}</Link>)}
        </nav>
        <span className="nav-actions">
          <Link className="btn small" href={(liveCheckout || selfService ? "/login" : "/contact") as Route}>
            {liveCheckout || selfService ? "Start with your files" : "Request access"}
          </Link>
          <Link className="nav-signin" href="/login">Sign in</Link>
        </span>
      </header>
      <main id="main">
        <section className="scene doc">
          <div className="shell">
            <p className="slate"><b>PRICING</b><span />PAGES AND DOLLARS</p>
            <h1 className="document-title">Pages and dollars.<br />No credit arithmetic.</h1>
            <p className="lede">
              {liveCheckout ? "Standard" : "Pilot"} processing rate: <b>$0.04 per standard page</b>.
              Complex pages are escalated only when a page needs it, and never exceed
              <b> $0.06 per page</b> without a new confirmation.
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
                <article className="plan" key={plan.name} data-featured={plan.name === "Developer" ? 1 : 0}>
                  <span className="tag">{plan.name === "Developer" ? "START HERE" : plan.name === "Evaluation" ? "TRY IT FREE" : " "}</span>
                  <h3>{plan.name}</h3>
                  <span className="price">{plan.price}{plan.price !== "$0" && plan.price.startsWith("$") ? <small> / month</small> : null}</span>
                  <p>{plan.description}</p>
                  <ul>{plan.features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
                  <button
                    className="btn ghost"
                    type="button"
                    disabled={Boolean(billingBusy)}
                    onClick={() => plan.name === "Evaluation"
                      ? startEvaluation()
                      : (!liveCheckout || !plan.offerCode ? requestAccess() : chooseOffer(plan.offerCode))}
                  >
                    {plan.name === "Evaluation"
                      ? selfService ? "Start free evaluation" : "Request evaluation"
                      : !liveCheckout
                        ? "Request access"
                        : plan.name === "Enterprise"
                          ? "Start a conversation"
                          : billingBusy === plan.offerCode
                            ? "Opening checkout…"
                            : signedIn ? "Choose this plan" : "Choose this plan → sign in"}
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
                Usage is measured in pages. A PDF page is a page; one image is one page; a slide
                is a page-equivalent.
              </p>
              <p>
                Preflight shows an estimate before you commit. Where a file does not declare its
                own page count, that estimate is an upper bound derived from file size and is
                labelled as an estimate. The billed count is confirmed once the documents have
                been read, and never exceeds the maximum you were shown.
              </p>
            </details>
            {notice ? <p className="notice" role="status">{notice}</p> : null}
          </div>
        </section>
      </main>
      <footer className="site">
        <div className="shell">
          <span className="wordmark"><Logomark /><b>TAVONEL</b></span>
          <div className="site-footer-groups">
            {FOOTER_GROUPS.map((group) => (
              <nav key={group.title} aria-label={group.title}>
                <p className="site-footer-title">{group.title}</p>
                {group.links.map((link) => <Link key={link.href} href={link.href as Route}>{link.label}</Link>)}
              </nav>
            ))}
          </div>
          <p className="fine">Knowledge compiled with a traceable path back to every source.</p>
        </div>
      </footer>
    </div>
  );
}
