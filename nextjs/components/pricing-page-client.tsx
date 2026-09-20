"use client";

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useRef, useState } from "react";
import { PublicSiteFooter, PublicSiteHeader } from "@/components/public-site-chrome";
import tableStyles from "@/components/docs/docs-table.module.css";
import { useCheckout } from "@/lib/use-checkout";
import { loginUrlForOffer } from "@/lib/checkout-intent";
import {
  BILLING_OFFERS,
  REFUND_MAX_CONSUMED_FRACTION,
  REFUND_WINDOW_DAYS,
  refundablePageAllowance,
  type BillingOfferCode,
} from "@/lib/billing-catalog";
import { COMPILE_MAX_DOCUMENTS, CORPUS_MAX_DOCUMENTS } from "@/lib/compile-limits";
import { trackFunnel } from "@/lib/funnel-events";
import { activationPolicy } from "@/lib/activation-policy";
import { ACCESS_CTA, type SiteLink } from "@/lib/site-navigation";
import { jsonLdHtml } from "@/lib/structured-data";
import { parsePublicStatusV2 } from "@/lib/public-status-contract";
import {
  MAX_UNITS_PER_PAGE,
  PROCESSING_UNIT_USD,
  STANDARD_UNITS_PER_PAGE,
  formatUsd,
} from "@/lib/usage-pricing";
/*
  G2-008. The hard limits a buyer needs, read from the modules that enforce them rather than
  retyped beside the price.

  `shared/intakeCeiling.ts` is the size ceiling every processor in the chain agrees on, and it is
  what `/sources` and a 413 refusal already print. `lib/compile-limits.ts`
  is the corpus contract: CORPUS_MAX_DOCUMENTS is the largest selection one run may carry and
  COMPILE_MAX_DOCUMENTS is the size of the parts it is compiled in. Both were published on
  `/sources` and in the changelog and nowhere near the page where the money decision is made.
*/
import { PROCESSING_CEILING, PROCESSING_CEILING_MIB } from "../../shared/intakeCeiling";

/*
  Plans come from the billing catalog, not from a second list kept next to it.

  The array that used to live here promised Developer "500 standard compile pages" while the
  compile route demanded a Team subscription, and promised Team "Up to 5 seats" against a
  product with no invitations, roles or seat accounting. It also advertised Enterprise
  "SSO / SCIM when qualified" — a feature card for something that does not exist, with the
  qualification caveat doing the work a missing feature should do, which is to be missing.
*/
/*
  G2-009 (SD-08). Every price on this page carries its currency.

  "Tax is not included" was one line of small print under a table, and the only "USD" anywhere on
  the site was inside the enterprise PDF that has now been deleted -- so a buyer in Seoul, London
  or São Paulo read "$99" and had to guess which dollar. Paddle settles in USD and no second
  currency has a settlement path, so the currency is written into the price itself and the tax
  sentence is stated once, under the grid, where the four prices are.

  G2-039. The qualifier is a block under the price rather than a trailing `<small>`: at the
  Enterprise card's width "Custom / scoped with" wrapped and left "you" alone on the next line.
*/
const PAID_PLANS = (Object.entries(BILLING_OFFERS) as Array<[BillingOfferCode, (typeof BILLING_OFFERS)[BillingOfferCode]]>)
  .map(([offerCode, offer]) => ({
    name: offer.label,
    price: `$${offer.priceUsd} USD`,
    unit: "per month",
    description: offer.description,
    features: offer.features as readonly string[],
    notYetSold: offer.notYetSold as readonly string[],
    // A plan whose product is unfinished is sold through a conversation, whatever the
    // commercial mode says. See `saleChannel` in the billing catalog.
    offerCode: offer.saleChannel === "self_serve" ? offerCode : null,
  }));

/** Shown on the Evaluation card while `activationPolicy.customerData` is closed (SD-01). */
const EVALUATION_GATED_DESCRIPTION =
  "Read the public Compiled World in full today, with Evidence, Ask and a signed export. Compiling your own files is arranged with us, not switched on by this card.";

const EVALUATION = {
  name: "Evaluation",
  price: "$0 USD",
  unit: "for 7 days",
  description: "Try TAVONEL with your own files. No card required.",
  features: [
    "Up to 3 files and 50 standard pages",
    "1 Compiled World with Evidence and Ask",
    "Signed export",
    "7 days, no card required",
  ],
  notYetSold: [],
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
  unit: "scoped with you",
  description: "An assisted pilot for larger corpora and knowledge operations run by a team, scoped in a conversation.",
  features: ["Custom volume", "Custom retention review", "Audit export", "Dedicated onboarding and support"],
  notYetSold: [],
  offerCode: null,
  /*
    BA-127. The label promised the reader a list of what we do not have, inside the one card that
    is meant to sell the largest engagement. /trust leads with what is published, so the label
    now names that, and the fine-print treatment is what makes it read as a card action rather
    than a pasted URL.
  */
  note: { href: "/trust" as Route, label: "Review public trust resources" },
  /*
    G2-001 (SD-03). The "Enterprise pricing sheet" link is gone and so is the file it pointed at.

    `public/legal/TAVONEL_ENTERPRISE_PRICING_2026-08-30.pdf` contradicted the page it was linked
    from on five material points: it sold prepaid credit packs under a headline promising no
    credit arithmetic, used a plan taxonomy nothing else on the site uses, said live paid sales
    were not open while three plans were on sale, said the business registration was pending
    while four live pages published the number, and was sixteen days older than the copy beside
    it. It is deleted rather than corrected -- a one-page unstyled export that nothing keeps in
    sync will drift again -- and what replaces it is the "Enterprise" section further down this
    page, written in the same vocabulary as the rest of it and rendered from the same constants.
  */
  anchor: "enterprise-pricing",
} as const;

const PLANS: ReadonlyArray<{
  name: string;
  price: string;
  /** The qualifier under the price. Every card has one, so the four cards share a shape. */
  unit: string;
  description: string;
  features: readonly string[];
  /** Named on the card, never implied by its absence. See `notYetSold` in the billing catalog. */
  notYetSold: readonly string[];
  offerCode: BillingOfferCode | null;
  note?: { href: Route; label: string };
  /** An in-page destination, for a card whose detail is a section rather than another page. */
  anchor?: string;
}> = [EVALUATION, ...PAID_PLANS, ENTERPRISE];

/*
  G2-003. The three steps between this card and a first compile, written on the card.

  The review's finding was that no purchasable path exists: four inert buttons, and a Developer
  label promising checkout that led to a Google sign-in. The anchors fix where a click goes; this
  fixes what the buyer is told about it, which is the half that loses the sale. Each path is the
  route this page will actually take in the state it is rendered in -- the two flags are the same
  ones the anchor's href is computed from -- so a closed checkout cannot leave a card describing
  an open one.

  "First compile" is deliberately the last step on both paid plans. Whether that first compile is
  your own files or the public Compiled World is the intake gate's sentence, printed under the
  grid from `activationPolicy` rather than paraphrased here.
*/
function planPath(
  plan: (typeof PLANS)[number],
  state: { liveCheckout: boolean; selfService: boolean },
) {
  if (plan.name === "Evaluation") {
    return state.selfService
      ? "Sign in → 3 files and 50 pages → your first World"
      : "Request access → we arrange intake with you → your first World";
  }
  if (plan.name === "Enterprise") return "Talk to us → we scope it against your material → a written quote";
  if (!plan.offerCode) return `Talk to us → we agree the volume and the onboarding session → first compile`;
  return state.liveCheckout
    ? "Sign in → checkout → first compile"
    : "Request access → we open checkout for you → first compile";
}

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
    // FD-03 (`docs/policy/DECISION_LOG_2026-09-11.md`): grant-time expiry, no roll-over, no refund
    // of unused pages. Delegated decision, 2026-09-11; the wording here is the customer's, per the
    // log's "Public wording of delegated values" section.
    [
      "Unused pages",
      `Included pages belong to the billing month they are granted in: when the next month's pages are granted, whatever is left of the previous month expires. Unused pages do not roll over and are not refunded if you cancel. Pages past the included allowance are billed at the published rate of ${formatUsd(STANDARD_PAGE_USD)} per standard page.`,
    ],
    // FD-02 (`docs/policy/DECISION_LOG_2026-09-11.md`): Developer reaches activation when the
    // caller owns the workspace. Delegated decision, 2026-09-11; the row is read off the
    // entitlement function, so it cannot say more than the code admits.
    // SD-02 (G2-002). This row used to end "Team keeps shared membership and roles", which
    // What differs between the two plans is volume and guided review, which is what this row says.
    // Identity and team-access requirements stay in Enterprise scoping rather than plan copy.
    [
      "What differs by plan",
      `${BILLING_OFFERS.studio_access.label} carries ${BILLING_OFFERS.studio_access.includedPages.toLocaleString("en-US")} included pages against ${BILLING_OFFERS.observer_access.label}'s ${BILLING_OFFERS.observer_access.includedPages.toLocaleString("en-US")}, adds the review queue, version history and a guided onboarding session, and is sold through a conversation rather than a checkout. ${activationPlans.join(" and ")} reach World activation — activating a candidate and rolling one back — as the workspace owner. Source connections are verified separately in Workspace.`,
    ],
    [
      "What does not consume pages",
      "Pages are reserved when a source is admitted for reading, once per document. Ask, search and recompiling sources already read reserve none — they check your plan, not your balance.",
    ],
    [
      "Spreadsheets",
      "A spreadsheet is billed on the pages of the sanitized PDF it is converted to, counted after conversion. Preflight lists those files and marks their pages as not counted yet, and the count you are billed on is the one the conversion produces.",
    ],
    // FD-04 (`docs/policy/DECISION_LOG_2026-09-11.md`): the refund bright line. Delegated
    // decision, 2026-09-11; every figure below is derived from the billing catalog.
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

/*
  BA-121. What the estimator shows, computed by the function the volume table above is built
  from, so the two cannot disagree again.

  They did disagree, by a factor of two, on the same screen: the table read
  `monthlyTotalUsd` -- subscription plus the pages past the plan's included pages -- and the
  estimator read `quoteCompilePages`, which is pages x the unit rate and knows nothing about a
  plan. At the old default of 348 pages the estimator quoted a third of what the table said the
  same volume costs, because it had left out the subscription entirely. The number a buyer reads
  last was the one understating the bill.

  So the estimator states the two plan totals and, beside them, the ceiling if every page
  escalated. `extraPages` is the row the old "Standard estimate" was trying to be: the pages
  past the plan, at the published rate, labelled as what it is.

  `pricing-estimator.test.ts` holds these rows against `monthlyTotalUsd` and against the
  volume table's own figures at 50, 250, 300 and 348 pages.
*/
export function estimatorRows(pages: number) {
  const developer = BILLING_OFFERS.observer_access;
  const team = BILLING_OFFERS.studio_access;
  const extraPages = Math.max(0, pages - developer.includedPages);
  return {
    pages,
    developerTotalUsd: monthlyTotalUsd(developer, pages),
    teamTotalUsd: monthlyTotalUsd(team, pages),
    extraPages,
    extraPagesUsd: extraPages * STANDARD_PAGE_USD,
    /** Every page past the plan escalating to the complex ceiling: the most this run can cost. */
    developerMaximumUsd: developer.priceUsd + extraPages * MAXIMUM_PAGE_USD,
  };
}

const SCENARIOS = SCENARIO_PAGES.map((pages) => ({
  pages,
  developer: monthlyTotalUsd(BILLING_OFFERS.observer_access, pages),
  team: monthlyTotalUsd(BILLING_OFFERS.studio_access, pages),
}));

/*
  G2-007. The rows on which the two paid plans actually differ, and only those.

  "What each plan can do" further down is rendered from `billingProductDecision`, and all six of
  its rows answer the same for both plans -- correctly, because both plans reach every one of
  those routes. A buyer reading six ✓ / ✓ rows learned nothing about why one plan costs more
  than the other, and the things that do differ were spread between a card, a tile and a fold.

  Every value is read from `lib/billing-catalog.ts` -- the included pages, the sale channel, the
  onboarding bullet and the not-yet-sold list -- so a catalog change moves the table. A row that
  is the same on both plans belongs in "Limits" below, not in a column here.
*/
/** Takes the channel as a string so a catalog with one channel per plan still type-checks. */
function howYouBuy(saleChannel: string) {
  return saleChannel === "self_serve" ? "Checkout" : "A conversation";
}

const PLAN_DIFFERENCES: ReadonlyArray<readonly [string, string, string]> = [
  [
    "Included standard pages each month",
    BILLING_OFFERS.observer_access.includedPages.toLocaleString("en-US"),
    BILLING_OFFERS.studio_access.includedPages.toLocaleString("en-US"),
  ],
  [
    "How you buy it",
    howYouBuy(BILLING_OFFERS.observer_access.saleChannel),
    howYouBuy(BILLING_OFFERS.studio_access.saleChannel),
  ],
  [
    "Guided corpus onboarding",
    BILLING_OFFERS.observer_access.features.some((feature) => feature.includes("onboarding")) ? "Included" : "—",
    BILLING_OFFERS.studio_access.features.some((feature) => feature.includes("onboarding")) ? "Included" : "—",
  ],
];

/*
  G2-008. The hard limits, stated where the money decision is made rather than only on /sources.

  Four of these are constants the pipeline enforces; the rest are absences, written as absences.
  A buyer asking "what is the ceiling" was previously answered on `/sources` (size and pages), in
  the changelog (documents per run) and nowhere at all (retention, residency, resolution target),
  which meant the three that do not exist read as three we had not got round to publishing.

  Where a row says a limit is not set, that is the state of the deployment and not a promise of
  an unlimited one: `/privacy` says no retention period in days is established, `/security` says
  no data residency is guaranteed, and `docs/policy/SUPPORT_TARGETS.md` says the published target
  is an acknowledgement and not a resolution time.
*/
const LIMITS: ReadonlyArray<readonly [string, string]> = [
  [
    "Largest single source",
    `${PROCESSING_CEILING_MIB} MB. Nothing in the reading chain accepts more, so a larger file cannot be compiled at all.`,
  ],
  [
    "Most pages in one source",
    `${PROCESSING_CEILING.maxSourcePages}. The page ceiling is checked after the document is decoded, so a longer file is refused during processing rather than at upload.`,
  ],
  [
    "Sources in one run",
    `${CORPUS_MAX_DOCUMENTS}, compiled in parts of ${COMPILE_MAX_DOCUMENTS}. Each part compiles to its own World and is reviewed on its own; the parts are not merged.`,
  ],
  [
    "Members in a workspace",
    "Published plans cover the workspace owner. Team access and identity requirements are confirmed during Enterprise scoping.",
  ],
  [
    "API requests",
    "Limited per key, per scope, per minute. The limits are the same on both paid plans and are not something a plan buys more of.",
  ],
  [
    "Retention period",
    "Not set. Material stays until you delete it, until the workspace is deleted, or until a legal retention duty applies — there is no day count, and the privacy notice says why.",
  ],
  [
    "Data residency",
    "Published plans make no contractual residency commitment. The privacy notice and subprocessor record maintain the applicable locations and international-processing disclosures.",
  ],
  [
    "Uptime and resolution targets",
    "Published plans do not include a contractual uptime or resolution SLA. Enterprise support terms are agreed during scoping.",
  ],
];

/*
  G2-001 (SD-03). Enterprise pricing as HTML, in this page's vocabulary.

  The deleted PDF answered this question with a price ladder nobody had scoped and a credit
  catalogue this product does not sell. What a buyer actually needs before a call is what the
  quote is built from, what we need from them to build it, and what an Enterprise scope does not
  contain today -- so those are the three lists, and no range is quoted, because none has been
  agreed. The rate and the ceiling below are the same two constants every other figure on this
  page is computed from: an Enterprise quote starts from the published rate, it does not replace
  it with a secret one.
*/
const ENTERPRISE_VARIABLES = [
  "Annual page volume, and how much of it arrives at once",
  "How many source systems are connected, and whether any of them needs work to read",
  "How much of the review is run by us rather than by you",
  "A retention and deletion review written against your own policy",
  "Onboarding depth, and any support target beyond the published acknowledgement target",
] as const;

const ENTERPRISE_QUOTE_NEEDS = [
  "A page volume, even a rough one, and the formats it arrives in",
  "Where the material sits today, and who is allowed to read it",
  "What the compiled knowledge has to feed — people, an agent, or your own application",
  "Who signs, and what their security review asks for",
] as const;

const ENTERPRISE_NOT_INCLUDED = [
  "A separate deployment. There is no self-hosted, private-cloud or air-gapped installation, on any scope.",
  "A contractual data residency guarantee. Applicable processing locations remain disclosed in the privacy notice and subprocessor record.",
  "Unreviewed identity, support, or assurance commitments. These are confirmed in writing for the qualified scope.",
] as const;

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
/*
  BA-123. The fifth field is the group this question belongs in.

  Seventeen identically collapsed 61px rows, each with an 11px uppercase mono question, read as a
  terminal directory listing rather than as the questions a company answers -- and they buried the
  value, which is the answers, behind the listing. The rows are now four labelled groups with the
  first question of each open, so the section opens showing four answers instead of seventeen
  closed bars. `brand-copy.test.ts` still counts seventeen rows and still requires each to carry
  the page that maintains its answer.
*/
const PURCHASE_FAQ: Array<[string, string, Route, string, string]> = [
  ["Is this just OCR?", "Reading the page is one step of the compile. What you keep is a Compiled World: objects, relations and claims that each carry the source region behind them, under a version you can go back to.", "/knowledge-compiler" as Route, "What a Knowledge Compiler is", "What it is"],
  ["Why not a parser plus a vector database?", "That is a way to build the retrieval layer, and the package ships one. What a parser and an index do not give you is the reviewed structure underneath, the evidence binding, or a version history when the sources change.", "/knowledge-compiler" as Route, "Where each category acts", "What it is"],
  ["What exactly is a World?", "The output of one compile: objects, relations, evidence, retrieval material and a validation report, addressed by a digest. Two Worlds with the same digest are the same World.", "/knowledge-compiler" as Route, "Glossary", "What it is"],
  ["How does this relate to RAG?", "RAG retrieves chunks at question time. Here the chunks are one file in the package, produced from a reviewed World, so they carry the page and region they came from and change only when the World does.", "/knowledge-compiler" as Route, "Compared with RAG", "What it is"],
  ["Can I verify an answer?", "Every object carries the regions that support it, and an export carries a manifest with a digest for each file, signed on the way out. The public key is published, so a recipient can check a package without asking us.", "/evidence" as Route, "How evidence is bound", "What a review will find"],
  ["What happens when a source document changes?", "The new bytes are a new version, and compiling produces a new candidate rather than editing the World in place. The active revision moves only when a person activates it, and the previous one stays readable.", "/knowledge-compiler" as Route, "Questions people ask", "What it is"],
  ["Can it read Office files, images and tables?", "It accepts them. Every accepted source is sanitized to PDF and read by OCR, and what survives is the page, the paragraph text and the bounding box — a spreadsheet's cells and formulas do not.", "/sources" as Route, "What this deployment reads", "What a review will find"],
  ["Can my agent use it?", "A read-only MCP server and an HTTP API are published, with eight tools over sources, World, search, Ask, objects, relations, evidence and package. There is no write tool.", "/developers" as Route, "API and MCP", "What a review will find"],
  ["What does it do when it is uncertain?", "It abstains and says which sources it looked at. A composed answer with no region behind it would be indistinguishable from a correct one, which is the failure the whole contract exists to prevent.", "/knowledge-compiler" as Route, "Questions people ask", "What it is"],
  ["Is my data safe?", "Your sources go to a tenant-scoped quarantine, are sanitized before anything reads them, and are not used to train shared models. No third-party model API receives your documents in this deployment.", "/security" as Route, "Where your documents go", "What happens to my data"],
  ["What is ready to use?", "Upload, security inspection, document reading, reviewed World activation, grounded Ask, API/MCP access and signed export are available. Current source and service status stays visible on the linked pages.", "/status" as Route, "Current service status", "What it costs"],
  ["How much does it cost?", "A monthly subscription with included pages, then a per-page rate past them. Both numbers are above, and the maximum for any page is shown before a run starts.", "/refunds" as Route, "Cancellation and refunds", "What it costs"],
  ["How much setup is required?", "Upload your own files and compile. Evaluation takes no card, and nothing is charged until you choose a plan.", "/docs" as Route, "Documentation", "What it costs"],
  ["Will I be locked in?", "The package is open formats — canonical JSON, Turtle, JSON-LD, CSV and JSONL — and the two verifiers are readable scripts rather than a service, so a package can be checked and loaded without us.", "/docs/exports" as Route, "The package format", "What happens to my data"],
  ["Can I export?", "Yes. Signed export is included from the free evaluation up, and the export is the whole World rather than a report about it.", "/docs/exports" as Route, "What is in the package", "What happens to my data"],
  ["Can I delete my data?", "Source material, derived artifacts and compiled packages are deleted on a verified request to privacy@tavonel.com. The categories and purposes are set out in the privacy notice.", "/privacy" as Route, "Storage and lifecycle", "What happens to my data"],
  /*
    BA-126 and BA-164. This row counted our own gaps on the page where a purchase is decided, and
    the count it used was ours: "the thirteen things such a review asks" is §45's internal list,
    not a standard anyone publishes, so quoting it asserted an unverifiable fact and leaked the
    shape of an internal spec. It had also been wrong twice, in both directions, as the trust
    index gained answers.

    It now leads with what is published and names the two open answers instead of arithmetic.
    `lib/trust-page-answers.test.ts` holds this sentence and /trust's lede to the same two
    absences -- the rows a reader can count on that page -- rather than to a shared number, and
    fails if either page reaches for the thirteen again.
  */
  ["Can an enterprise security review approve it?", "The Trust Center provides the public policies, processor record, legal terms, and reporting contacts. Deployment-specific architecture, control evidence, assurance scope, and questionnaire responses are provided through a qualified review; the reviewer makes the approval decision.", "/trust" as Route, "Trust Center", "What a review will find"],
];

/** The order the groups are shown in. Declared rather than derived, because it is an argument. */
const FAQ_GROUPS = ["What it is", "What it costs", "What happens to my data", "What a review will find"] as const;

/*
  G2-032. The prices and the questions on this page, in the markup a search or answer engine reads.

  The site's global JSON-LD is Organization + SoftwareApplication and stops there, on the stated
  ground that a private pilot has no public catalogue. That ground no longer holds for this page
  and only for this page: `BILLING_OFFERS` is a catalogue, both plans are rendered with real
  prices, and a buyer can reach a checkout for one of them. So the block is built by mapping over
  the two modules the page already renders -- a price change moves the markup instead of leaving a
  crawler with a stale `Offer`.

  Only the two catalogued subscriptions are described. The free evaluation has no `priceUsd` to
  cite and Enterprise has no agreed price at all, and an `Offer` for either would be the invented
  fact the evidence rule bars. `availability` follows `saleChannel`, so the plan sold through a
  conversation is not advertised to a crawler as a checkout.

  It is emitted from this client component rather than from `app/pricing/page.tsx` because a
  "use client" module's non-component exports are client references in the server bundle, so the
  server component cannot read `PURCHASE_FAQ`. Next server-renders this into the HTML either way.
*/
const PRICING_JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    ...Object.values(BILLING_OFFERS).map((offer) => ({
      "@type": "Offer",
      name: offer.label,
      description: offer.description,
      url: "https://tavonel.com/pricing",
      category: "subscription",
      availability:
        offer.saleChannel === "self_serve"
          ? "https://schema.org/InStock"
          : "https://schema.org/LimitedAvailability",
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: offer.priceUsd,
        priceCurrency: "USD",
        valueAddedTaxIncluded: false,
        unitText: "month",
        billingDuration: 1,
        billingIncrement: 1,
      },
    })),
    {
      "@type": "FAQPage",
      mainEntity: PURCHASE_FAQ.map(([question, answer]) => ({
        "@type": "Question",
        name: question,
        acceptedAnswer: { "@type": "Answer", text: answer },
      })),
    },
  ],
};

export default function PricingPageClient({
  initialLiveCheckout,
  initialSelfService,
  cta,
  gates,
  planCapabilities,
}: {
  initialLiveCheckout: boolean;
  initialSelfService: boolean;
  /**
   * G1-010 / G2-026: the header action, resolved on the server by `primaryCallToAction()` so this
   * page shows the same primary CTA as every other public page while `customerData` is closed.
   */
  cta: SiteLink;
  /** Read on the server from `lib/activation-policy`, the object /api/status serves verbatim. */
  gates: readonly PurchaseGate[];
  planCapabilities: readonly PlanCapabilityRow[];
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  // SD-01: the same `activationPolicy` row the fine print under the grid prints.
  const ownFilesOpen = gates.some((gate) => gate.id === "customerData" && gate.enabled);
  /*
    Whether a real charge is possible, not merely which mode a label says.

    The page used to read `commercialMode` alone, which is one of the three inputs to that
    question; a deployment could report mode "live" with launch approval withheld and this page
    would offer a checkout the API then refused.
  */
  const [liveCheckout, setLiveCheckout] = useState(initialLiveCheckout);
  const [selfServiceFlag, setSelfServiceFlag] = useState(initialSelfService);
  /*
    TRUST-03. `ACCESS_MODE` is a necessary condition for a self-serve evaluation, not a
    sufficient one. While `activationPolicy.customerData` is closed this deployment compiles
    no visitor files at all, so "Start free evaluation" sent a buyer to a sign-in that leads
    nowhere. The page offers the site's one access action instead -- the same action the
    header and the landing page offer, from the same constant.
  */
  const selfService = selfServiceFlag && activationPolicy.customerData.enabled;
  /*
    BA-128. 348 read as leftover test data. The default is now the Developer plan's included
    pages, so the control opens on "your plan already covers this" rather than on a figure
    nobody chose.
  */
  const [pages, setPages] = useState<number>(BILLING_OFFERS.observer_access.includedPages);
  const { start: startCheckout, busy: billingBusy } = useCheckout(setNotice);
  const estimate = estimatorRows(pages);

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
        const response = await fetch("/api/status/v2", { cache: "no-store" });
        if (!response.ok) throw new Error("status unavailable");
        const status = parsePublicStatusV2(await response.json());
        if (!status) throw new Error("invalid status contract");
        if (!cancelled) {
          setLiveCheckout(status.availableActions.purchasePlan.enabled);
          setSelfServiceFlag(status.availableActions.createAccount.enabled);
        }
      } catch {
        // Fail closed: an unreachable status endpoint must never open checkout or public signup.
        if (!cancelled) {
          setLiveCheckout(false);
          setSelfServiceFlag(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /*
    G2-003. Where each plan's action goes, as a URL rather than as a click handler.

    All four controls were `<button type="button">`: not linkable, not openable in a new tab,
    inert with JavaScript disabled and invisible to a crawler, on the one page where the buyer
    decides. They are anchors now, and this function is what fills the `href`.

    The Paddle overlay still exists and still needs a click, so the Developer anchor keeps an
    `onClick` that calls `preventDefault()` and opens it -- but only in the one state where the
    overlay is reachable, which is live checkout with a session. In every other state the href is
    where the click was going to send the visitor anyway: the sign-in that carries the offer, or
    /contact. Nothing about the destination depends on JavaScript having run.
  */
  const planHref = (plan: (typeof PLANS)[number]) => {
    if (plan.anchor) return `#${plan.anchor}`;
    if (plan.name === "Evaluation") return selfService ? "/login" : ACCESS_CTA.href;
    if (!plan.offerCode || !liveCheckout) return "/contact";
    return loginUrlForOffer(plan.offerCode);
  };

  /** True only where the Paddle overlay can actually open, which is where the anchor is hijacked. */
  const opensOverlay = (plan: (typeof PLANS)[number]) =>
    Boolean(plan.offerCode) && liveCheckout && signedIn;

  return (
    <div className="page pricing-page">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdHtml(PRICING_JSON_LD) }}
      />
      <PublicSiteHeader cta={cta} />
      <main id="main">
        <section className="scene doc">
          <div className="shell">
            {/*
              BA-129. The kicker restated the headline word for word, so it is gone.

              BQ-028 / BQ-097: the H1 is the noun phrase, and the second half of it is the first
              sentence of the lede. A `<br/>` with no space either side of it merges the words on
              both sides in the accessible name -- "arithmetic.Processing" -- and a two-sentence
              H1 is two claims at display size when one of them is the page's subject and the
              other is the argument for it.
            */}
            <h1 className="document-title">Pages and dollars.</h1>
            {/*
              BA-122. The rate line used to open on {liveCheckout ? "Standard" : "Pilot"}, which in
              this deployment renders "Pilot" -- telling a buyer the unit price is provisional. It
              is not: the standard rate is what the reservation code charges, whatever the posture
              is. Posture belongs to the plan CTAs and to /refunds, never to the unit price.

              BQ-134: the two figures are no longer bolded mid-sentence. A price set in bold inside
              a paragraph of prose is a heading pretending to be emphasis, and this paragraph is
              two sentences long -- there is nothing in it a reader has to be steered past.
            */}
            <p className="lede">
              No credit arithmetic. The processing rate is {formatUsd(STANDARD_PAGE_USD)} per
              standard page; complex pages are escalated only when a page needs it, and never
              exceed {formatUsd(MAXIMUM_PAGE_USD)} per page without a new confirmation.
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
              BA-119. Audit M04's disclosure stays -- both gates are still read from
              `activationPolicy` on the server and printed in the policy's own words -- but not as
              two identical grey notices between the price and the plans.

              The intake gate is fine print under the grid (below). The promotion gate is a feature
              tile in "How your plan works": it is closed on purpose, it is one of the things this
              product is sold on, and rendering it in `.notice.static` beside a closed gate made a
              designed property read as a defect.
            */}
            <div className="plans" ref={plansRef} data-visual>
              {PLANS.map((plan) => (
                <article className="plan" key={plan.name} data-featured={plan.name === "Developer" ? 1 : 0}>
                  {/*
                    BQ-027. Four cards, four shared baselines.

                    The cards were a flex column each, so every one of them stacked from its own
                    top and the four titles, prices, bodies and buttons landed wherever their
                    neighbours' content left them -- 32px apart at 1440. They are a subgrid now:
                    `.plans` owns four rows and each card spans them, so the row heights are the
                    tallest card's and each of the four slots below starts on the same line in
                    all four cards. It is four wrappers rather than a `min-height` per part,
                    because a fixed height is a measurement of today's copy.

                    BA-125's tag is gone rather than re-reserved (BQ-028). It said "START HERE"
                    and "TRY IT FREE" on two of four cards, shouted in caps above a heading that
                    already names the plan, and it was the element whose presence on two cards
                    and absence on two was half of the misalignment. The featured plan is still
                    marked -- `data-featured` fills its ground and its button.

                    BA-131 stands: every card carries a unit under its price, so "$0" and
                    "Custom" line up with the two that have one.
                  */}
                  <div className="plan-head">
                    <h2>{plan.name}</h2>
                    {/*
                      G2-009 and G2-039. The currency is part of the price and the qualifier is a
                      block under it. As a trailing `<small>` the Enterprise card's "/ scoped with
                      you" wrapped mid-phrase and left "you" alone on its own line.
                    */}
                    <span className="price">{plan.price}</span>
                    <p className="fine">{plan.unit}</p>
                  </div>
                  {/*
                    SD-01 (G1-001 on this page). The Evaluation card promised "your own files"
                    while `customerData` is closed. The card now reads the same gate the fine
                    print under the grid reads, and describes what the trial reaches today.
                  */}
                  <p className="plan-body">
                    {plan.name === EVALUATION.name && !ownFilesOpen ? EVALUATION_GATED_DESCRIPTION : plan.description}
                  </p>
                  <div className="plan-features">
                    <ul>{plan.features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
                    {/*
                      SD-02 (G2-002). What this plan does not include, on the card, in the same
                      type as the rest of it. Team's differentiator used to be shared membership,
                      which `/security` and `/trust` deny; a buyer now reads that here instead of
                      after they have paid.
                    */}
                    {plan.notYetSold.length > 0 ? (
                      <>
                        <p className="fine"><b>Coming, not yet sold</b></p>
                        <ul>{plan.notYetSold.map((item) => <li key={item}>{item}</li>)}</ul>
                      </>
                    ) : null}
                    {plan.note ? (
                      <p className="fine"><Link href={plan.note.href}>{plan.note.label}</Link></p>
                    ) : null}
                  </div>
                  <div className="plan-action">
                  {/*
                    BA-120. The page where the purchase is decided had no primary action: every
                    plan button was `btn ghost`, so the buy control carried exactly the weight of
                    "Cancellation and refunds" at the foot of the page. The featured plan is filled
                    and the other three stay ghost, and each label says what happens next instead
                    of four plans all saying "Request access".

                    G2-003. It is an anchor now, with the destination in the markup, and the three
                    steps between here and a first compile are written under it rather than
                    discovered one redirect at a time.
                  */}
                  <a
                    className={plan.name === "Developer" ? "btn" : "btn ghost"}
                    href={planHref(plan)}
                    aria-disabled={billingBusy === plan.offerCode ? true : undefined}
                    onClick={(event) => {
                      // The plan name is an enumerated UI state, not customer data.
                      trackFunnel("pricing_start_clicked", { plan: plan.name });
                      if (!opensOverlay(plan) || !plan.offerCode) return;
                      event.preventDefault();
                      void startCheckout(plan.offerCode);
                    }}
                  >
                    {plan.name === "Evaluation"
                      ? selfService ? "Start free evaluation" : ACCESS_CTA.label
                      : !plan.offerCode
                        ? plan.name === "Enterprise" ? "How an Enterprise quote is built" : `Talk to us about ${plan.name}`
                        : !liveCheckout
                          ? `Request ${plan.name} access`
                          : billingBusy === plan.offerCode
                            ? "Opening checkout…"
                            : signedIn ? `Get ${plan.name} access` : `Get ${plan.name} access, via sign-in`}
                  </a>
                  <p className="fine">{planPath(plan, { liveCheckout, selfService })}</p>
                  </div>
                </article>
              ))}
            </div>
            {/*
              G2-009 (SD-08). The currency and tax sentence, once, where the four prices are.

              Paddle is the merchant of record and settles in US dollars. No second currency has a
              settlement path here, so none is offered rather than quoted and then not honoured.
            */}
            <p className="fine">
              Every price on this page is in US dollars and excludes tax. Paddle is the merchant of
              record and presents the applicable tax, the renewal terms and the final amount before
              you pay.
            </p>
            {/* BA-119(a). The intake gate, in the policy's own words, as fine print under the grid. */}
            {gates.filter((gate) => gate.id === "customerData" && !gate.enabled).map((gate) => (
              <p className="fine" key={gate.id} data-purchase-gate={gate.id}>
                {gate.reason}{" "}
                <Link href={"/status" as Route}>Current deployment state</Link>
              </p>
            ))}
            {/*
              BQ-135. The way down a 13,000px page.

              Measured on a phone the document below this point is about twenty-five screens, and
              the only way through it was the thumb. This is the strip `/security` already uses:
              plain anchors to headings that already carry ids, in fine print, no component and
              no second list to keep in step -- a section that loses its id loses its link in the
              same edit. It sits under the grid rather than above it, because the first thing on
              a pricing page should be the prices.
            */}
            <nav className="fine pricing-jump" aria-label="On this page">
              <a href="#pricing-details-title">How your plan works</a>
              <a href="#plan-differences-title">What the step between plans buys</a>
              <a href="#pricing-limits-title">Limits</a>
              <a href="#page-classes-title">What makes a page complex</a>
              <a href="#plan-capability-title">What each plan can do</a>
              <a href="#pricing-scenarios-title">What four volumes cost</a>
              <a href="#usage-estimator-title">Estimate your corpus</a>
              <a href="#enterprise-pricing-title">Enterprise</a>
              <a href="#pricing-faq-title">Questions before you buy</a>
            </nav>
            <section className="pricing-details" aria-labelledby="pricing-details-title">
              <h2 id="pricing-details-title">How your plan works</h2>
            <div className="tiles pricing-glance">
              {glanceRows(planCapabilities).map(([title, body]) => (
                <article className="tile" key={title}>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </article>
              ))}
              {/*
                BA-119(b). The promotion gate, sold as the feature it is, in the same grid as the
                rest of what a plan does. The string is still `activationPolicy`'s, so a gate that
                ever opens stops printing here by itself.
              */}
              {gates.filter((gate) => gate.id === "candidatePromotion" && !gate.enabled).map((gate) => (
                <article className="tile" key={gate.id} data-purchase-gate={gate.id}>
                  <h3>{gate.lead}</h3>
                  <p>{gate.reason} Nothing reaches an active World without a person, on any plan.</p>
                </article>
              ))}
            </div>
            {/*
              G2-007. The three rows on which the two paid plans differ, before the table on which
              they do not. A comparison whose every cell reads ✓ / ✓ answers the wrong question.
            */}
            <h3 id="plan-differences-title">What the step between the two plans buys</h3>
            <div className="table-scroll">
            <table className={`docs-table ${tableStyles.rowHeader}`} aria-labelledby="plan-differences-title">
              <thead>
                <tr>
                  <th scope="col">&nbsp;</th>
                  <th scope="col">{BILLING_OFFERS.observer_access.label}</th>
                  <th scope="col">{BILLING_OFFERS.studio_access.label}</th>
                </tr>
              </thead>
              <tbody>
                {PLAN_DIFFERENCES.map(([label, developer, team]) => (
                  <tr key={label}>
                    <th scope="row">{label}</th>
                    <td data-label={BILLING_OFFERS.observer_access.label}>{developer}</td>
                    <td data-label={BILLING_OFFERS.studio_access.label}>{team}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            <p className="fine">
              Those are the differences. Everything else — compiling, evidence, Ask, signed export,
              API and MCP access, reviewing a candidate, activating a World and rolling one back —
              is reached by both plans, at the same per-page rate past the included pages, under
              the same limits below. The capability table under this one is the proof: it is
              answered by the function the API calls, and it reads the same for both.
            </p>
            {/*
              G2-008. The ceilings a buyer has to know before they buy, and the three they will
              ask about that do not exist. Written as a list rather than a fourth column because
              none of them varies by plan.
            */}
            <h3 id="pricing-limits-title">Limits, and what is not capped</h3>
            <div className="tiles">
              {LIMITS.map(([label, value]) => (
                <article className="tile" key={label}>
                  <h4>{label}</h4>
                  <p>{value}</p>
                </article>
              ))}
            </div>
            <p className="fine">
              The first three are enforced by the reading chain itself and are the same figures{" "}
              <Link href={"/sources" as Route}>Sources</Link> publishes and a refusal quotes back
              at you. The last three are absences: where this page says a limit is not set, nothing
              has established one, and that is not a promise of an unlimited allowance.
            </p>
            {/*
              G2-010. Standard and complex, defined rather than assumed.

              "Complex pages are escalated only when a page needs it" was circular on a page whose
              entire price depends on which of the two a page is. What follows is the mechanism
              rather than a taxonomy, because the mechanism is what exists: `lib/usage-pricing.ts`
              holds a standard unit count and a maximum unit count per page, and settlement in
              `docs/CREDIT_ECONOMICS.md` charges the GPU time a page actually took, against a
              reservation taken at the ceiling before the run starts. No rule anywhere in this
              repository classifies a page in advance, and no measurement here says what share of
              a corpus escalates -- so neither is claimed.
            */}
            <h3 id="page-classes-title">What makes a page complex</h3>
            <div className="tiles">
              <article className="tile">
                <h4>Standard page</h4>
                <p>
                  A page the reader gets through in the standard time: a digital PDF page, a
                  converted document or slide, a clean single-column scan of ordinary type. It is
                  billed at {formatUsd(STANDARD_PAGE_USD)}, and most pages are this.
                </p>
              </article>
              <article className="tile">
                <h4>Complex page</h4>
                <p>
                  A page that takes the same reader longer: a skewed, noisy or low-contrast scan, a
                  tightly packed multi-column layout, a page that is mostly drawing or photograph.
                  It costs more than a standard page and never more than{" "}
                  {formatUsd(MAXIMUM_PAGE_USD)}.
                </p>
              </article>
              <article className="tile">
                <h4>Who decides, and when</h4>
                <p>
                  Nobody decides in advance. Every run holds the ceiling — every page at{" "}
                  {formatUsd(MAXIMUM_PAGE_USD)} — before it starts, so the figure you authorise is
                  the most it can cost, and the bill is settled on the work the pages actually
                  took. The invoice can come in under the number you approved; it cannot come in
                  over it.
                </p>
              </article>
              <article className="tile">
                <h4>How many escalate</h4>
                <p>
                  We publish no figure. Nothing here has measured the share of a typical corpus
                  that escalates, and a number invented for this page would be exactly the estimate
                  the reservation exists to replace. Preflight shows the maximum for your own files
                  before you commit, which is the answer for your corpus rather than an average
                  over somebody else&apos;s.
                </p>
              </article>
            </div>
            {/*
              Audit P05 / M04. Which plan reaches which capability, answered by the function the
              API calls rather than by a sentence about it. Every cell is
              `billingProductDecision(plan, level)` from the server component, and the level on
              each row is read from the route that enforces it.
            */}
            <h3 id="plan-capability-title">What each plan can do</h3>
            <div className="table-scroll">
            <table className={`docs-table ${tableStyles.rowHeader}`} aria-labelledby="plan-capability-title">
              <thead>
                <tr>
                  <th scope="col">Capability</th>
                  {planCapabilities[0]?.plans.map((plan) => (
                    <th scope="col" key={plan.label}>{plan.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/*
                  BA-124. One table was speaking three vocabularies: "Yes", "No", and the sentence
                  "Scoped in the pilot" repeated down all six Enterprise cells. The Yes/No column
                  is now a glyph pair with an accessible name, and the Enterprise column says the
                  one thing it has to say once, under the table.

                  "No" was also the same blue as the capability text, so a cell that denies a
                  capability read as a link to it.
                */}
                {planCapabilities.map((row) => (
                  <tr key={row.capability}>
                    <th scope="row">{row.capability}</th>
                    {row.plans.map((plan) => (
                      <td key={plan.label} data-label={plan.label} data-allowed={plan.allowed ? 1 : 0} aria-label={plan.allowed ? "Yes" : "No"}>
                        {plan.allowed ? "✓" : "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            {/*
              G2-035. Two consecutive paragraphs carried the same sentence twice, differing in one
              word -- the evaluation reached "the Developer rows", then "the Developer columns".
              One paragraph, said once.
            */}
            <p className="fine">
              Every row is answered for the workspace owner, the role a buyer of either plan holds
              in their own workspace. The free evaluation reaches the{" "}
              {BILLING_OFFERS.observer_access.label} rows that do not activate a World, inside its
              file and page limits; activating one needs a paid plan, which is why it has no column
              here. An Enterprise scope is agreed in the conversation rather than compared against
              these two. Nothing an Ask answer returns is invented for it: every answer names the
              retrieval path it took, and{" "}
              <Link href={"/docs/ask" as Route}>the Ask reference</Link> states which paths exist
              and what each one reads.
            </p>
            {/*
              Audit P03. Four volumes, derived from the catalog's included pages, priced with the
              two constants the reservation code charges against. No figure below is typed.
            */}
            <h3 id="pricing-scenarios-title">What four volumes cost</h3>
            <div className="table-scroll">
            <table className={`docs-table ${tableStyles.rowHeader}`} aria-labelledby="pricing-scenarios-title">
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
                    <td data-label={BILLING_OFFERS.observer_access.label}>{formatUsd(scenario.developer)}</td>
                    <td data-label={BILLING_OFFERS.studio_access.label}>{formatUsd(scenario.team)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            <p className="fine">
              Subscription plus {formatUsd(STANDARD_PAGE_USD)} for every standard page past the
              plan&apos;s included pages. A page is counted when a source is admitted for reading,
              so re-asking, searching and recompiling sources already read do not appear in this
              table. Complex-page processing is capped at {formatUsd(MAXIMUM_PAGE_USD)} per page
              and is shown before the run starts. Every figure is in US dollars, excluding tax.
            </p>
            </section>
            <section className="usage-estimator" aria-labelledby="usage-estimator-title" data-visual>
              <div>
                {/* G2-042. The widget states its own currency and tax basis: a reader who scrolls
                    straight to the calculator never passes the sentence under the plan grid. */}
                <h3 id="usage-estimator-title">What will this corpus cost?</h3>
                <p className="fine">All figures in US dollars, excluding tax.</p>
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
                <div><dt>{BILLING_OFFERS.observer_access.label} total, USD</dt><dd>{formatUsd(estimate.developerTotalUsd)}</dd></div>
                <div><dt>{BILLING_OFFERS.studio_access.label} total, USD</dt><dd>{formatUsd(estimate.teamTotalUsd)}</dd></div>
                <div>
                  <dt>Pages beyond {BILLING_OFFERS.observer_access.label}</dt>
                  <dd>{estimate.extraPages.toLocaleString("en-US")} at {formatUsd(STANDARD_PAGE_USD)} = {formatUsd(estimate.extraPagesUsd)}</dd>
                </div>
                <div><dt>Maximum if every extra page escalates</dt><dd>{formatUsd(estimate.developerMaximumUsd)}</dd></div>
              </dl>
            </section>
            <details className="status-fold">
              <summary>How usage is measured</summary>
              <p>
                Usage is measured in pages. A PDF page is a page; one image is one page; a slide
                is a page-equivalent.
              </p>
              <p>
                Preflight shows an estimate before you commit. A file that declares no page
                count of its own is listed with its pages marked as not counted yet rather than
                with a number derived from its size. The billed count is confirmed once the
                documents have been read, and never exceeds the maximum you were shown.
              </p>
            </details>
            {/*
              G2-001 (SD-03). What used to be a one-page PDF, as a section of the page it was
              linked from. `/enterprise` is another lane's file; the content lives here, where the
              prices are, and that page is offered the same block as a cross-lane request.
            */}
            <section id="enterprise-pricing" aria-labelledby="enterprise-pricing-title">
              <h2 id="enterprise-pricing-title">Enterprise</h2>
              <p className="lede">
                There is no Enterprise price list, because no Enterprise scope has been agreed that
                a list would describe. An Enterprise quote starts from the same two numbers as
                every plan above — {formatUsd(STANDARD_PAGE_USD)} per standard page, never more
                than {formatUsd(MAXIMUM_PAGE_USD)} — and the conversation is about what sits around
                them. Quotes are written in US dollars, excluding tax.
              </p>
              <h3 id="enterprise-variables-title">What moves the quote</h3>
              <ul aria-labelledby="enterprise-variables-title">
                {ENTERPRISE_VARIABLES.map((item) => <li key={item}>{item}</li>)}
              </ul>
              <h3 id="enterprise-needs-title">What we need to write one</h3>
              <ul aria-labelledby="enterprise-needs-title">
                {ENTERPRISE_QUOTE_NEEDS.map((item) => <li key={item}>{item}</li>)}
              </ul>
              <h3 id="enterprise-absent-title">What an Enterprise scope does not include today</h3>
              <ul aria-labelledby="enterprise-absent-title">
                {ENTERPRISE_NOT_INCLUDED.map((item) => <li key={item}>{item}</li>)}
              </ul>
              <div className="actions">
                <Link className="btn" href="/contact">Scope an Enterprise pilot</Link>
                <Link className="btn ghost" href={"/trust" as Route}>Review public trust resources</Link>
              </div>
            </section>
            <section aria-labelledby="pricing-faq-title">
              <h2 id="pricing-faq-title">Questions before you buy</h2>
              {FAQ_GROUPS.map((group) => (
                <div key={group}>
                  <h3>{group}</h3>
                  <div className="pricing-faq">
                    {PURCHASE_FAQ.filter(([,,,, rowGroup]) => rowGroup === group).map(([question, answer, href, label], index) => (
                      <details className="status-fold" key={question} open={index === 0}>
                        <summary>{question}</summary>
                        <p>{answer}</p>
                        <p className="fine"><Link href={href}>{label}</Link></p>
                      </details>
                    ))}
                  </div>
                </div>
              ))}
            </section>

            {/*
              §12.4. The four questions that stop a purchase, each pointed at the page that
              answers it rather than at a sales conversation. "Refunds" is the cancellation and
              refund terms page.
            */}
            {/*
              BQ-110. Five ghost buttons in a row is five equal-weight controls and no decision.

              They are not actions -- none of them buys, starts or cancels anything; each is a
              page that answers one of the four questions that stop a purchase. So they read as
              what they are: a sentence of links in fine print. The page's actual primary control
              is the plan button, four rows above, and it stops competing with five neighbours
              that look exactly like it.
            */}
            <p className="fine">
              Before you buy: <Link href="/security">where your documents go</Link> ·{" "}
              <Link href={"/privacy" as Route}>how data is handled</Link> ·{" "}
              <Link href={"/sources" as Route}>what we can read</Link> ·{" "}
              <Link href="/evidence">how evidence is bound</Link> ·{" "}
              <Link href={"/refunds" as Route}>cancellation and refunds</Link>.
            </p>
            {notice ? <p className="notice" role="status">{notice}</p> : null}
          </div>
        </section>
      </main>
      <PublicSiteFooter />
    </div>
  );
}
