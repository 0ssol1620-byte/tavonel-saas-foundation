"use client";

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useRef, useState } from "react";
import Logomark from "@/components/logomark";
import MobilePrimaryNav from "@/components/mobile-primary-nav";
import { useCheckout } from "@/lib/use-checkout";
import { loginUrlForOffer } from "@/lib/checkout-intent";
import {
  BILLING_OFFERS,
  REFUND_MAX_CONSUMED_FRACTION,
  REFUND_WINDOW_DAYS,
  refundablePageAllowance,
  type BillingOfferCode,
} from "@/lib/billing-catalog";
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

/*
  Audit P08. The card claims nothing it cannot deliver -- SSO, SCIM and seats came off it in an
  earlier pass -- but a buyer evaluating Enterprise had no way from here to the page that lists
  what enterprise readiness still lacks. /trust already publishes that split by name. The card now
  links to it at the moment the decision is made, rather than after a pilot has started.
*/
const ENTERPRISE = {
  name: "Enterprise",
  price: "Custom",
  description: "An assisted pilot for larger corpora and knowledge operations run by a team, scoped in a conversation.",
  features: ["Custom volume", "Custom retention review", "Audit export", "Dedicated onboarding and support"],
  offerCode: null,
  note: { href: "/trust" as Route, label: "What an enterprise security review will and will not find" },
} as const;

const PLANS: ReadonlyArray<{
  name: string;
  price: string;
  description: string;
  features: readonly string[];
  offerCode: BillingOfferCode | null;
  note?: { href: Route; label: string };
}> = [EVALUATION, ...PAID_PLANS, ENTERPRISE];

/*
  The usage details, after the plan choices, derived rather than retyped.

  The page already carried every one of these facts, spread between a lede, four cards, an
  estimator and a fold, so answering "what do I pay and what happens when I use more" took a
  scroll and some arithmetic. Nothing here is a new number: the rate is
  `STANDARD_UNITS_PER_PAGE * PROCESSING_UNIT_USD` and the ceiling is `MAX_UNITS_PER_PAGE *
  PROCESSING_UNIT_USD`, the same two constants the estimator quotes and the reservation code
  charges against, and the included pages are the catalog's `includedPages`.

  The "Unused pages" tile is the one to read carefully, and it is the one thing this merge had to
  decide. The entitlements lane held FD-03's term back -- "unused pages expire at the end of each
  billing month and do not roll over" -- because on its branch nothing reduced a `credit_balance`:
  no migration, job, trigger or route. That is no longer the state of this tree. LEDGER-EXPIRY's
  `20260911130000_included_page_expiry_at_renewal.sql` is merged, and the next month's grant
  expires whatever is left of the previous month as its own ledger row, taking nothing that is not
  that plan's included pages. So the term is stated -- in the ledger lane's wording, which is the
  wording the code keeps. The stronger "at the end of each billing month" promises a boundary the
  schema does not record (Paddle sends a period end; nothing stores it) and a job that does not
  exist, so it would say a balance was gone while the balance was still spendable;
  `product-claims-sync.test.ts` P06 fails if it comes back.

  The refund bright line (P07, FD-04) is a term rather than a behaviour and it stays: no route
  could enforce it -- refunds are issued by a person through Paddle -- and `liveChargesEnabled`
  is false, so no payment exists to refund yet.

  FD-03 and FD-04 are both a delegated decision, 2026-09-11 (orchestrator, under the founder's
  delegation), and not the founder's own statements; `docs/policy/DECISION_LOG_2026-09-11.md`
  requires that attribution, and the founder's direct ratification is a merge condition the lane
  reports carry.

  The numbers stay derived -- the rate from the two constants the reservation code charges
  against, the refund figures from the catalog -- so a moved rate moves this copy instead of
  leaving it stale.
*/
const STANDARD_PAGE_USD = STANDARD_UNITS_PER_PAGE * PROCESSING_UNIT_USD;
const MAXIMUM_PAGE_USD = MAX_UNITS_PER_PAGE * PROCESSING_UNIT_USD;
const REFUND_MAX_CONSUMED_PERCENT = Math.round(REFUND_MAX_CONSUMED_FRACTION * 100);

/*
  The tiles, with the one row that is an entitlement answered by the entitlement function.

  "What differs by plan" used to be a typed sentence beside a table computed from
  `billingProductDecision`, which is how a page comes to promise the gate it had last quarter.
  It is now read off the same rows the table renders: the plans listed as reaching World
  activation are the plans the function admits, and nothing here can say otherwise.
*/
function glanceRows(planCapabilities: readonly PlanCapabilityRow[]) {
  const activation = planCapabilities.find((row) => row.level === "activation");
  const activationPlans = activation?.plans.filter((plan) => plan.allowed).map((plan) => plan.label) ?? [];
  return [
    [
      "Base subscription",
      `${BILLING_OFFERS.observer_access.label}: $${BILLING_OFFERS.observer_access.priceUsd}/month. ${BILLING_OFFERS.studio_access.label}: $${BILLING_OFFERS.studio_access.priceUsd}/month. The seven-day evaluation is free and needs no card.`,
    ],
    [
      "Included pages",
      `${BILLING_OFFERS.observer_access.includedPages.toLocaleString("en-US")} standard pages on ${BILLING_OFFERS.observer_access.label}; ${BILLING_OFFERS.studio_access.includedPages.toLocaleString("en-US")} on ${BILLING_OFFERS.studio_access.label}.`,
    ],
    [
      "Past the included pages",
      `${formatUsd(STANDARD_PAGE_USD)} per standard page. Complex-page processing is capped at ${formatUsd(MAXIMUM_PAGE_USD)}, shown before the run starts.`,
    ],
    [
      "Unused pages",
      `Included pages belong to the billing month they are granted in: when the next month's pages are granted, whatever is left of the previous month expires. Unused pages do not roll over and are not refunded if you cancel. Pages past the included allowance are billed at the published rate of ${formatUsd(STANDARD_PAGE_USD)} per standard page.`,
    ],
    [
      "What differs by plan",
      `${activationPlans.join(" and ")} reach World activation — promoting a candidate to the active World, and rolling one back. On ${BILLING_OFFERS.observer_access.label} that is the workspace owner; ${BILLING_OFFERS.studio_access.label} keeps shared membership and roles, and is sold through a conversation rather than a checkout. Source connections are verified separately in Workspace.`,
    ],
    [
      "What does not consume pages",
      "Pages are reserved when a source is admitted for reading, once per document. Ask, search and recompiling sources already read reserve none — they check your plan, not your balance.",
    ],
    [
      "Spreadsheets",
      "A spreadsheet is billed on the pages of the sanitized PDF it is converted to, counted after conversion. Before that conversion there is no page count to show, so preflight names those files and shows no number beside them rather than quoting one from file size.",
    ],
    [
      "Refunds",
      `Ask within ${REFUND_WINDOW_DAYS} days of payment and you get a full refund, provided you have used fewer than ${REFUND_MAX_CONSUMED_PERCENT}% of the plan's included pages — ${refundablePageAllowance(BILLING_OFFERS.observer_access)} pages on ${BILLING_OFFERS.observer_access.label}, ${refundablePageAllowance(BILLING_OFFERS.studio_access)} on ${BILLING_OFFERS.studio_access.label}. Past that, the payment is not refunded. Unused pages are not refunded when you cancel. Subject to the terms as updated.`,
    ],
    [
      "How to start",
      "Start with your own files. Nothing is charged until you choose a plan.",
    ],
  ] as const;
}

/*
  Audit P03. Four volumes, every figure computed from the same two constants the reservation code
  charges against and the catalog's own `includedPages`. The volumes themselves are derived from
  those included-page numbers rather than picked, so no number on this table is typed by hand and
  a rate change moves the table instead of leaving it stale. `product-claims-sync.test.ts`
  recomputes it.
*/
const SCENARIO_PAGES = [
  Math.round(BILLING_OFFERS.observer_access.includedPages * 0.6),
  BILLING_OFFERS.observer_access.includedPages,
  BILLING_OFFERS.observer_access.includedPages * 2,
  BILLING_OFFERS.studio_access.includedPages,
] as const;

export function monthlyTotalUsd(offer: { priceUsd: number; includedPages: number }, pages: number) {
  const extra = Math.max(0, pages - offer.includedPages);
  return offer.priceUsd + extra * STANDARD_PAGE_USD;
}

const SCENARIOS = SCENARIO_PAGES.map((pages) => ({
  pages,
  developer: monthlyTotalUsd(BILLING_OFFERS.observer_access, pages),
  team: monthlyTotalUsd(BILLING_OFFERS.studio_access, pages),
}));

export type PurchaseGate = {
  id: "customerData" | "candidatePromotion";
  /** The sentence this gate leads with; each gate is a different kind of closed. */
  lead: string;
  enabled: boolean;
  reason: string;
};

export type PlanCapabilityRow = {
  capability: string;
  /** The route file whose access check this row's level is taken from. */
  route: string;
  level: "observer" | "studio" | "activation";
  plans: ReadonlyArray<{ label: string; saleChannel: string; allowed: boolean }>;
};

/*
  §54's purchase friction map, answered on the page where the purchase is decided.

  The blueprint lists seventeen objections and asks that every one have a public answer. The
  answers were scattered over six pages, so a buyer had to know which page to look on.

  Nothing below is a new answer. Each one is the existing sentence from the page that owns it,
  shortened to the length someone reads on a pricing page, with the link to the page that says it
  in full -- so the wording stays maintained in one place and this list can only go stale by
  pointing somewhere that no longer says it. `lib/brand-copy.test.ts` counts the seventeen.

  Two of the blueprint's questions are reworded rather than quoted. "Why not <vendor> + a vector
  DB" names competitors, which §71 forbids on a public page, so it asks about the architecture
  instead. The fourth is phrased as a superiority claim over RAG -- the exact comparative SPEC
  13.3 bars, and one nothing in this repository has measured -- so it asks how the two relate.

  Writing that second reason out cost two test failures on the first run: the sentence explaining
  why the phrase is barred contained the phrase. Both guards read source text, comments included,
  which is correct -- a barred claim in a comment is one copy-paste from being a barred claim on
  the page.

  Readiness is answered as a positive inventory of the usable path, with current runtime state on
  /status. Detailed qualification stays with the source or service it describes.
*/
const PURCHASE_FAQ: Array<[string, string, Route, string]> = [
  ["Is this just OCR?", "Reading the page is one step of the compile. What you keep is a Compiled World: objects, relations and claims that each carry the source region behind them, under a version you can go back to.", "/knowledge-compiler" as Route, "What a Knowledge Compiler is"],
  ["Why not a parser plus a vector database?", "That is a way to build the retrieval layer, and the package ships one. What a parser and an index do not give you is the reviewed structure underneath, the evidence binding, or a version history when the sources change.", "/knowledge-compiler" as Route, "Where each category acts"],
  ["What exactly is a World?", "The output of one compile: objects, relations, evidence, retrieval material and a validation report, addressed by a digest. Two Worlds with the same digest are the same World.", "/knowledge-compiler" as Route, "Glossary"],
  ["How does this relate to RAG?", "RAG retrieves chunks at question time. Here the chunks are one file in the package, produced from a reviewed World, so they carry the page and region they came from and change only when the World does.", "/knowledge-compiler" as Route, "Compared with RAG"],
  ["Can I verify an answer?", "Every object carries the regions that support it, and an export carries a manifest with a digest for each file, signed on the way out. The public key is published, so a recipient can check a package without asking us.", "/evidence" as Route, "How evidence is bound"],
  ["What happens when a source document changes?", "The new bytes are a new version, and compiling produces a new candidate rather than editing the World in place. The active revision moves only when a person promotes it, and the previous one stays readable.", "/knowledge-compiler" as Route, "Questions people ask"],
  ["Can it read Office files, images and tables?", "It accepts them. Every accepted source is sanitized to PDF and read by OCR, and what survives is the page, the paragraph text and the bounding box — a spreadsheet's cells and formulas do not.", "/sources" as Route, "What this deployment reads"],
  ["Can my agent use it?", "A read-only MCP server and an HTTP API are published, with eight tools over sources, World, search, Ask, objects, relations, evidence and package. There is no write tool.", "/developers" as Route, "API and MCP"],
  ["What does it do when it is uncertain?", "It abstains and says which sources it looked at. A composed answer with no region behind it would be indistinguishable from a correct one, which is the failure the whole contract exists to prevent.", "/knowledge-compiler" as Route, "Questions people ask"],
  ["Is my data safe?", "Your sources go to a tenant-scoped quarantine, are sanitized before anything reads them, and are not used to train shared models. No third-party model API receives your documents in this deployment.", "/security" as Route, "Where your documents go"],
  ["What is ready to use?", "Upload, security inspection, document reading, reviewed World activation, grounded Ask, API/MCP access and signed export are available. Current source and service status stays visible on the linked pages.", "/status" as Route, "Current service status"],
  ["How much does it cost?", "A monthly subscription with included pages, then a per-page rate past them. Both numbers are above, and the maximum for any page is shown before a run starts.", "/refunds" as Route, "Cancellation and refunds"],
  ["How much setup is required?", "Upload your own files and compile. Evaluation takes no card, and nothing is charged until you choose a plan.", "/docs" as Route, "Documentation"],
  ["Will I be locked in?", "The package is open formats — canonical JSON, Turtle, JSON-LD, CSV and JSONL — and the two verifiers are readable scripts rather than a service, so a package can be checked and loaded without us.", "/docs/exports" as Route, "The package format"],
  ["Can I export?", "Yes. Signed export is included from the free evaluation up, and the export is the whole World rather than a report about it.", "/docs/exports" as Route, "What is in the package"],
  ["Can I delete my data?", "Source material, derived artifacts and compiled packages are deleted on a verified request to privacy@tavonel.com. The categories and purposes are set out in the privacy notice.", "/privacy" as Route, "Storage and lifecycle"],
  ["Can an enterprise security review approve it?", "Ten of the thirteen things such a review asks are published in one index, and the three that are not are listed there by name rather than left to be discovered after a pilot.", "/trust" as Route, "Trust Center"],
];

export default function PricingPageClient({
  initialLiveCheckout,
  initialSelfService,
  gates,
  planCapabilities,
}: {
  initialLiveCheckout: boolean;
  initialSelfService: boolean;
  /** Read on the server from `lib/activation-policy`, the object /api/status serves verbatim. */
  gates: readonly PurchaseGate[];
  planCapabilities: readonly PlanCapabilityRow[];
}) {
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
    <div className="page pricing-page">
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
            {/*
              Audit M04: the two gates, before the card, in the policy's own words.

              Every string below is `activationPolicy`'s, read on the server from the object
              /api/status serves. A gate that opens stops printing here by itself.
            */}
            {gates.filter((gate) => !gate.enabled).map((gate) => (
              <p className="notice static" role="status" key={gate.id} data-purchase-gate={gate.id}>
                <strong>{gate.lead}</strong>
                {gate.reason}{" "}
                <Link href={"/status" as Route}>Current deployment state</Link>
              </p>
            ))}
            <div className="plans" ref={plansRef} data-visual>
              {PLANS.map((plan) => (
                <article className="plan" key={plan.name} data-featured={plan.name === "Developer" ? 1 : 0}>
                  <span className="tag">{plan.name === "Developer" ? "START HERE" : plan.name === "Evaluation" ? "TRY IT FREE" : " "}</span>
                  <h2>{plan.name}</h2>
                  <span className="price">{plan.price}{plan.price !== "$0" && plan.price.startsWith("$") ? <small> / month</small> : null}</span>
                  <p>{plan.description}</p>
                  <ul>{plan.features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
                  {plan.note ? (
                    <p className="fine"><Link href={plan.note.href}>{plan.note.label}</Link></p>
                  ) : null}
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
            <section className="pricing-details" aria-labelledby="pricing-details-title">
              <h2 id="pricing-details-title">How your plan works</h2>
            <div className="tiles pricing-glance">
              {glanceRows(planCapabilities).map(([title, body]) => (
                <article className="tile" key={title}>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </article>
              ))}
            </div>
            {/*
              Audit P05 / M04. Which plan reaches which capability, answered by the function the
              API calls rather than by a sentence about it. Every cell is
              `billingProductDecision(plan, level)` from the server component, and the level on
              each row is read from the route that enforces it.
            */}
            <h3 id="plan-capability-title">What each plan can do</h3>
            <table className="docs-table" aria-labelledby="plan-capability-title">
              <thead>
                <tr>
                  <th scope="col">Capability</th>
                  {planCapabilities[0]?.plans.map((plan) => (
                    <th scope="col" key={plan.label}>
                      {plan.label}{plan.saleChannel === "contact" ? " (contact)" : ""}
                    </th>
                  ))}
                  <th scope="col">Enterprise</th>
                </tr>
              </thead>
              <tbody>
                {planCapabilities.map((row) => (
                  <tr key={row.capability}>
                    <th scope="row">{row.capability}</th>
                    {row.plans.map((plan) => (
                      <td key={plan.label}>{plan.allowed ? "Yes" : "No"}</td>
                    ))}
                    <td>Scoped in the pilot</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="fine">
              Every row is answered for the workspace owner, the role a buyer of either plan holds
              in their own workspace. The free evaluation reaches the{" "}
              {BILLING_OFFERS.observer_access.label} columns that do not activate a World, inside
              its file and page limits; activating one needs a paid plan. Nothing an Ask answer
              returns is invented for it: every answer names the retrieval path it took, and{" "}
              <Link href={"/docs/ask" as Route}>the Ask reference</Link> states which paths exist
              and what each one reads.
            </p>
            {/*
              Audit P03. Four volumes, derived from the catalog's included pages, priced with the
              two constants the reservation code charges against. No figure below is typed.
            */}
            <h3 id="pricing-scenarios-title">What four volumes cost</h3>
            <table className="docs-table" aria-labelledby="pricing-scenarios-title">
              <thead>
                <tr>
                  <th scope="col">Pages read in a month</th>
                  <th scope="col">{BILLING_OFFERS.observer_access.label}</th>
                  <th scope="col">{BILLING_OFFERS.studio_access.label}</th>
                </tr>
              </thead>
              <tbody>
                {SCENARIOS.map((scenario) => (
                  <tr key={scenario.pages}>
                    <th scope="row">{scenario.pages.toLocaleString("en-US")}</th>
                    <td>{formatUsd(scenario.developer)}</td>
                    <td>{formatUsd(scenario.team)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="fine">
              Subscription plus {formatUsd(STANDARD_PAGE_USD)} for every standard page past the
              plan&apos;s included pages. A page is counted when a source is admitted for reading,
              so re-asking, searching and recompiling sources already read do not appear in this
              table. Complex-page processing is capped at {formatUsd(MAXIMUM_PAGE_USD)} per page
              and is shown before the run starts. Tax is not included.
            </p>
            </section>
            <section className="usage-estimator" aria-labelledby="usage-estimator-title" data-visual>
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
            <p className="slate"><span />COMMON QUESTIONS</p>
            <div className="pricing-faq">
              {PURCHASE_FAQ.map(([question, answer, href, label]) => (
                <details className="status-fold" key={question}>
                  <summary>{question}</summary>
                  <p>{answer}</p>
                  <p className="fine"><Link href={href}>{label}</Link></p>
                </details>
              ))}
            </div>

            {/*
              §12.4. The four questions that stop a purchase, each pointed at the page that
              answers it rather than at a sales conversation. "Refunds" is the cancellation and
              refund terms page.
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
