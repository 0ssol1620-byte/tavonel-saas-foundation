/**
 * The plan catalog, and the only place a plan's public claims are written.
 *
 * The pricing page carried its own hand-written `PLANS` array beside this one. They agreed on
 * price and disagreed on everything else: the page promised Developer "500 standard compile
 * pages" while the compile route required a Team subscription, and promised Team "Up to 5
 * seats" against a product with no invitation, no roles and no seat accounting. A plan claim
 * that nothing enforces is a refund conversation with extra steps.
 *
 * `features` is therefore the enforced list, and `plan-entitlement.test.ts` checks it against
 * the code that enforces it -- that Developer reaches compile and the developer-key routes,
 * and that no bullet promises seats, SSO, SCIM or anything gated on "when qualified".
 * Adding a bullet here means adding the thing.
 *
 * `notYetSold` is the other half of that rule, added 2026-09-16. A plan whose differentiator is
 * unfinished used to have two options here: claim it, or say nothing and let the buyer infer it
 * from the price step. Team did the first. It now does neither: the unfinished capability is
 * named on the card as something that is not sold yet, so the buyer reads the same sentence
 * `/security` and `/trust` already publish instead of discovering the contradiction between two
 * pages. An empty list renders nothing.
 */
export const BILLING_OFFERS = {
  observer_access: {
    kind: "subscription",
    label: "Starter",
    priceUsd: 29,
    credits: 2_000,
    includedPages: 500,
    priceEnv: "PADDLE_PRICE_OBSERVER_ACCESS",
    saleChannel: "self_serve",
    description: "For builders shipping source-grounded AI.",
    features: [
      "500 standard pages",
      "Compile your own worlds",
      "Evidence, Ask and signed export",
      "API and MCP access",
      // 2026-11-10: the `connections` level. Only providers with a production OAuth app are named.
      "Google Drive and file-server connections",
    ],
    notYetSold: [],
  },
  studio_access: {
    kind: "subscription",
    label: "Pro",
    priceUsd: 99,
    credits: 10_000,
    includedPages: 2_500,
    priceEnv: "PADDLE_PRICE_STUDIO_ACCESS",
    /*
      Self-serve since 2026-11-10 (orchestrator, delegated pricing and plan decision).

      This was "contact" while Team was sold on collaboration that did not exist. Since SD-02
      (below) the plan is described as what it is -- the higher-volume single-member plan, with
      shared members and roles named in `notYetSold` on the same card -- so it is bought online
      exactly as Developer is. `saleChannel` stays the per-offer gate: the checkout route still
      refuses any offer whose channel is "contact" (`decideOfferCheckoutPolicy`).
    */
    saleChannel: "self_serve" as "self_serve" | "contact",
    /*
      SD-02, 2026-09-16. Collaboration was what this plan sold, and collaboration is the part
      that is not finished. "Up to 5 seats" came off the card in an earlier pass, but the copy
      that replaced it still leaned on membership -- `/pricing` said "Team keeps shared
      membership and roles" while `/security` and `/trust` said, in plain words, that a
      workspace here has exactly one member and there are no roles.

      So the plan is described as what it is today: the higher-volume single-member plan. The
      volume, the review queue, the version history and the onboarding session are all real and
      all enforced. Membership is named below as something that is not sold yet, in the same
      card, rather than left for a buyer to discover on the security page after they have paid.
    */
    /*
      2026-11-10, founder: the customer-facing names are Starter ($29) and Pro ($99). "Team" read as
      seats this plan does not have, and "Developer" read as for developers only. The offer codes,
      price env names, webhooks and stored rows are unchanged, and receipts keep the names they had.
      Pro is told apart by what it delivers: the volume, the review queue and the version history.
      Guided onboarding is an Enterprise item and is not part of a self-serve plan.
    */
    description: "The higher-volume plan, with the review queue and version history.",
    features: [
      "2,500 standard pages",
      "Everything in Starter",
      "Review queue and version history",
      "Google Drive and file-server connections",
    ],
    notYetSold: [],
  },
} as const;

/*
  The refund bright line, as two numbers rather than an adjective.

  `docs/policy/REFUND_THRESHOLD_DRAFT.md` is the decision record: the live template said refunds
  "may be limited after substantial processing has been consumed", which is a judgement call
  presented as a rule and cannot be checked by a buyer before they pay. FD-04 settled it at 14
  days and 10% of the plan's included pages -- a delegated decision, 2026-09-11 (orchestrator,
  under the founder's delegation), per `D:\CodexProjects\growth-lanes\DECISION_LOG_2026-09-11.md`,
  and not the founder's own statement -- so both figures live here, beside the `includedPages`
  they are a fraction of, and /pricing and the billing documentation compute the per-plan page
  figure rather than restating it. Pricing and refund terms are founder territory under
  CLAUDE.md, so the lane report makes the founder's direct ratification a merge condition.

  Nothing in the billing code enforces either number today: refunds are issued through Paddle by
  a person, and the consumed-page share is read from the same usage ledger the invoice is. These
  constants are what the published terms say, not a gate a route calls. Nothing can be charged
  yet either -- `liveChargesEnabled` is false -- so no payment exists for the window to run on.
*/
export const REFUND_WINDOW_DAYS = 14;
export const REFUND_MAX_CONSUMED_FRACTION = 0.1;

/** The included pages a plan may consume and still be inside the refund window. */
export function refundablePageAllowance(offer: { includedPages: number }) {
  return Math.round(offer.includedPages * REFUND_MAX_CONSUMED_FRACTION);
}

export type BillingOfferCode = keyof typeof BILLING_OFFERS;
export type BillingOffer = (typeof BILLING_OFFERS)[BillingOfferCode] & {
  code: BillingOfferCode;
  priceId: string;
};

export function isBillingOfferCode(value: unknown): value is BillingOfferCode {
  return typeof value === "string" && Object.hasOwn(BILLING_OFFERS, value);
}

type Environment = Readonly<Record<string, string | undefined>>;

export function readConfiguredBillingOffers(env: Environment = process.env) {
  const configured = new Map<BillingOfferCode, BillingOffer>();
  for (const [code, definition] of Object.entries(BILLING_OFFERS) as Array<
    [BillingOfferCode, (typeof BILLING_OFFERS)[BillingOfferCode]]
  >) {
    const priceId = env[definition.priceEnv]?.trim() ?? "";
    if (/^pri_[a-z0-9]{26}$/.test(priceId)) configured.set(code, { ...definition, code, priceId });
  }
  return configured;
}

export function findOfferByPriceId(priceId: string, env: Environment = process.env) {
  return [...readConfiguredBillingOffers(env).values()].find((offer) => offer.priceId === priceId) ?? null;
}

export function readPaddleBrowserConfig(env: Environment = process.env) {
  const sandbox = env.PADDLE_SANDBOX === "true";
  const token = env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN?.trim() ?? "";
  if (token.length < 20) return null;
  if (sandbox && !token.startsWith("test_")) return null;
  if (!sandbox && !token.startsWith("live_")) return null;
  return { environment: sandbox ? "sandbox" as const : "production" as const, clientToken: token };
}
