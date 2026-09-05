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
 */
export const BILLING_OFFERS = {
  observer_access: {
    kind: "subscription",
    label: "Developer",
    priceUsd: 29,
    credits: 2_000,
    includedPages: 500,
    priceEnv: "PADDLE_PRICE_OBSERVER_ACCESS",
    saleChannel: "self_serve",
    description: "For builders shipping source-grounded AI.",
    features: [
      "500 verified standard pages",
      "Compile your own worlds",
      "Evidence, Ask and signed export",
      "API and MCP access",
    ],
  },
  studio_access: {
    kind: "subscription",
    label: "Team",
    priceUsd: 99,
    credits: 10_000,
    includedPages: 2_500,
    priceEnv: "PADDLE_PRICE_STUDIO_ACCESS",
    /*
      Contact sales, and not only because billing is in pilot.

      Routing Team to /contact today is a side effect of checkout being closed for everyone.
      The moment live checkout opens, that side effect disappears and this plan would start
      selling itself -- while invitations, roles, seat accounting and access revocation still
      do not exist in any migration or route. `saleChannel` makes the gate independent of
      commercial mode, so opening billing cannot arm a plan whose product is unfinished.
      It flips to "self_serve" when the membership flow ships end to end, not before.
    */
    saleChannel: "contact",
    /*
      Collaboration is what this plan sells, and collaboration is the part not finished.
      Invitations, roles and seat accounting do not exist yet, so "Up to 5 seats" came off the
      card rather than onto a roadmap footnote. Team stays reachable through a conversation
      until the membership flow ships end to end.
    */
    description: "For larger corpora that need guided review and onboarding.",
    features: [
      "2,500 verified standard pages",
      "Everything in Developer",
      "Review queue and version history",
      "Guided corpus onboarding",
    ],
  },
} as const;

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
