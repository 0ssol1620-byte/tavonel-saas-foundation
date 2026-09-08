"use client";

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useRef, useState } from "react";
import Logomark from "@/components/logomark";
import MobilePrimaryNav from "@/components/mobile-primary-nav";
import { useCheckout } from "@/lib/use-checkout";
import { loginUrlForOffer } from "@/lib/checkout-intent";
import { BILLING_OFFERS, type BillingOfferCode } from "@/lib/billing-catalog";
import { trackFunnel } from "@/lib/funnel-events";
import { FOOTER_GROUPS, PRIMARY_NAV } from "@/lib/site-navigation";
import {
  MAX_UNITS_PER_PAGE,
  PROCESSING_UNIT_USD,
  STANDARD_UNITS_PER_PAGE,
  formatUsd,
  quoteCompilePages,
} from "@/lib/usage-pricing";

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

/*
  The §12.1 answers, above the plan grid, derived rather than retyped.

  The page already carried every one of these facts, spread between a lede, four cards, an
  estimator and a fold, so answering "what do I pay and what happens when I use more" took a
  scroll and some arithmetic. Nothing here is a new number: the rate is
  `STANDARD_UNITS_PER_PAGE * PROCESSING_UNIT_USD` and the ceiling is `MAX_UNITS_PER_PAGE *
  PROCESSING_UNIT_USD`, the same two constants the estimator quotes and the reservation code
  charges against, and the included pages are the catalog's `includedPages`.

  The rollover line is the one to read carefully. Nothing in the billing code expires a
  balance: `apply_foundation_billing_event_v4` grants each renewal's allowance into
  `credit_balance` and no job, trigger or route ever resets it. So the sentence states that as
  the current behaviour and stops there. Whether unused capacity is *contractually* carried is
  §40 item 1 and belongs to the founder; this page will say more when there is a term to say.
*/
const STANDARD_PAGE_USD = STANDARD_UNITS_PER_PAGE * PROCESSING_UNIT_USD;
const MAXIMUM_PAGE_USD = MAX_UNITS_PER_PAGE * PROCESSING_UNIT_USD;

const AT_A_GLANCE = [
  [
    "Base subscription",
    `${BILLING_OFFERS.observer_access.label} is $${BILLING_OFFERS.observer_access.priceUsd} a month and ${BILLING_OFFERS.studio_access.label} is $${BILLING_OFFERS.studio_access.priceUsd} a month. Evaluation is free for seven days and takes no card.`,
  ],
  [
    "Included pages",
    `${BILLING_OFFERS.observer_access.includedPages.toLocaleString("en-US")} standard pages a month on ${BILLING_OFFERS.observer_access.label}, ${BILLING_OFFERS.studio_access.includedPages.toLocaleString("en-US")} on ${BILLING_OFFERS.studio_access.label}. A PDF page is a page, one image is one page, a slide is a page-equivalent.`,
  ],
  [
    "Past the included pages",
    `${formatUsd(STANDARD_PAGE_USD)} per standard page. A page is escalated only when it needs it, and the charge for any page is capped at ${formatUsd(MAXIMUM_PAGE_USD)} — you are shown that maximum before the run starts and never billed above it.`,
  ],
  [
    "Unused pages",
    "Each renewal adds its included pages to your balance, and nothing in the billing code expires an unused balance today. That is the current behaviour of this deployment, not yet a published rollover term.",
  ],
  [
    "What differs by plan",
    `API and MCP access is included from ${BILLING_OFFERS.observer_access.label} up. Connectors are not a plan feature: the OAuth three are beta for everyone and the agent import route is set up with you. Promoting a candidate world into a live world is enforced at ${BILLING_OFFERS.studio_access.label}.`,
  ],
  [
    "How to start",
    "Start a free evaluation with your own files. Nothing is charged until you choose a plan, and the estimate below is shown before any compile begins.",
  ],
] as const;

export default function PricingPageClient({ initialLiveCheckout, initialSelfService }: { initialLiveCheckout: boolean; initialSelfService: boolean }) {
  const [notice, setNotice] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  /*
    Whether a real charge is possible, not merely which mode a label says.

    The page used to read `commercialMode` alone, which is one of the three inputs to that
    question; a deployment could report mode "live" with launch approval withheld and this page
    would offer a checkout the API then refused.
  */
  const [liveCheckout, setLiveCheckout] = useState(initialLiveCheckout);
  const [selfService, setSelfService] = useState(initialSelfService);
  const [pages, setPages] = useState(348);
  const { start: startCheckout, busy: billingBusy } = useCheckout(setNotice);
  const quote = quoteCompilePages(pages);

  /*
    §32 `pricing_plan_viewed`, fired when the grid is actually on screen.

    Firing it on mount would report a plan view for every visitor who lands and leaves, and on
    a phone the cards start well below the fold. One observer, one event, disconnected after it
    fires -- the funnel wants "did they get to the plans", not a scroll trace.
  */
  const plansRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = plansRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      trackFunnel("pricing_plan_viewed", { plans: String(PLANS.length) });
    }, { threshold: 0.25 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

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
        <MobilePrimaryNav />
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
              {liveCheckout ? "Standard" : "Pilot"} processing rate:{" "}
              <b>{formatUsd(STANDARD_PAGE_USD)} per standard page</b>. Complex pages are escalated
              only when a page needs it, and never exceed
              <b> {formatUsd(MAXIMUM_PAGE_USD)} per page</b> without a new confirmation.
            </p>
            {/*
              §12.3's sentence, with this deployment's own values in it.

              Written as one line above the cards because the question it answers -- what does
              the subscription buy, and what happens on the page after that -- was previously
              answerable only by reading a card, a fold and an estimator in that order.
            */}
            <p className="lede">
              Your plan includes {BILLING_OFFERS.observer_access.includedPages.toLocaleString("en-US")} standard
              pages each month on {BILLING_OFFERS.observer_access.label} and{" "}
              {BILLING_OFFERS.studio_access.includedPages.toLocaleString("en-US")} on{" "}
              {BILLING_OFFERS.studio_access.label}. Additional compiled pages are billed at{" "}
              {formatUsd(STANDARD_PAGE_USD)} per standard page.
            </p>
            <div className="tiles pricing-glance">
              {AT_A_GLANCE.map(([title, body]) => (
                <article className="tile" key={title}>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </article>
              ))}
            </div>
            <div className="plans" ref={plansRef}>
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
                    onClick={() => {
                      // The plan name is an enumerated UI state, not customer data.
                      trackFunnel("pricing_start_clicked", { plan: plan.name });
                      if (plan.name === "Evaluation") return startEvaluation();
                      if (!liveCheckout || !plan.offerCode) return requestAccess();
                      return chooseOffer(plan.offerCode);
                    }}
                  >
                    {plan.name === "Evaluation"
                      ? selfService ? "Start free evaluation" : "Request evaluation"
                      : !liveCheckout
                        ? "Request access"
                        : !plan.offerCode
                          ? plan.name === "Enterprise" ? "Start a conversation" : "Contact sales"
                          : billingBusy === plan.offerCode
                            ? "Opening checkout…"
                            : signedIn ? "Choose this plan" : "Choose this plan → sign in"}
                  </button>
                </article>
              ))}
            </div>
            <section className="usage-estimator" aria-labelledby="usage-estimator-title">
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
            <p className="fine">
              Institution and custom engagement guidelines are in the{" "}
              <a href="/legal/TAVONEL_ENTERPRISE_PRICING_2026-08-30.pdf">Enterprise pricing sheet</a>.
            </p>
            <details className="status-fold">
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
            {/*
              §12.4. The four questions that stop a purchase, each pointed at the page that
              answers it rather than at a sales conversation. "Refunds" is the cancellation and
              refund terms page; the FAQ the blueprint also lists does not exist as a route, and
              the fold above is what stands in for it today.
            */}
            <p className="slate"><span />BEFORE YOU START</p>
            <div className="actions">
              <Link className="btn ghost" href="/security">Where your documents go</Link>
              <Link className="btn ghost" href={"/privacy" as Route}>Data handling</Link>
              <Link className="btn ghost" href={"/sources" as Route}>What we can read</Link>
              <Link className="btn ghost" href="/evidence">How evidence is bound</Link>
              <Link className="btn ghost" href={"/refunds" as Route}>Cancellation and refunds</Link>
            </div>
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
