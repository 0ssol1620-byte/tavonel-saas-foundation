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
/** The price book every plan below belongs to. A price id, a quote and a receipt name it. */
export const PRICE_BOOK_VERSION = "PB-2026-11-V22";

/** What a plan line can depend on. A capability enters DELIVERED only in the release commit that proves it (WO-CAT-7). */
export type Capability =
  | "pcu_accepted_meter" | "kqu_meter" | "storage_meter" | "seat_cap"
  | "per_member_source_scopes" | "org_policy_audit";

/*
  WO-REL-1 (= WO-CAT-7): the four capabilities on the Personal and Developer line, each beside the tests that prove
  the delivered behaviour. `billing-catalog.test.ts` pins this set to those proofs: a capability added here without
  a proof file fails it. Team and Business also need `per_member_source_scopes` (and Business `org_policy_audit`),
  which nothing delivers, so they stay Request access.
*/
export const DELIVERED: ReadonlySet<Capability> = new Set<Capability>([
  // Pages settle as metered, a refunded or failed read gives its pages back: supabase/tests/foundation_page_meter.sql, lib/page-meter.test.ts (WO-D27-4).
  "pcu_accepted_meter",
  // Hold then settle per answer, 402 before retrieval at the allowance: supabase/tests/knowledge_query_units.sql, lib/kqu-meter.test.ts (WO-CAT-4, WO-CAT-8).
  "kqu_meter",
  // Stored bytes capped at intake admission: supabase/tests/workspace_storage_allowance.sql, lib/intake-admission.test.ts (WO-CAT-5, WO-CAT-8).
  "storage_meter",
  // Members plus pending invites capped on invite and accept: supabase/tests/workspace_seat_allowance.sql, lib/workspace-membership.test.ts (WO-CAT-6).
  "seat_cap",
]);

/** V22 overage rates. Shown with "Request access": nothing bills past an allowance yet. Automation is absent on purpose (Autopilot is held). */
export const METER_RATES_USD = { pcu: 0.04, kqu: 0.006, storageGbMonth: 0.2, seatMonth: 15 } as const;

export const BILLING_OFFERS = {
  personal: {
    kind: "subscription",
    label: "Personal",
    priceUsd: 29,
    included: { pcu: 500, kqu: 1_000, storageGb: 10, seats: 1 },
    credits: 2_000, // = pcu x STANDARD_UNITS_PER_PAGE (billing-catalog.test.ts)
    includedPages: 500,
    priceEnv: "PADDLE_PRICE_PERSONAL",
    saleChannel: "self_serve",
    status: "v2",
    accessLevel: "observer_access",
    requires: ["pcu_accepted_meter", "kqu_meter", "storage_meter", "seat_cap"],
    description: "For one person compiling their own sources.",
    features: [
      "500 standard pages",
      "Compile your own worlds",
      "Evidence, Ask and signed export",
      "API and MCP access",
      "Local-folder connections",
    ],
    notYetSold: [],
  },
  developer: {
    kind: "subscription",
    label: "Developer",
    priceUsd: 49,
    included: { pcu: 500, kqu: 5_000, storageGb: 10, seats: 1 },
    credits: 2_000,
    includedPages: 500,
    priceEnv: "PADDLE_PRICE_DEVELOPER",
    saleChannel: "self_serve",
    status: "v2",
    accessLevel: "observer_access",
    requires: ["pcu_accepted_meter", "kqu_meter", "storage_meter", "seat_cap"],
    description: "For builders shipping source-grounded AI through the API.",
    features: [
      "500 standard pages",
      "Compile your own worlds",
      "Evidence, Ask and signed export",
      "API and MCP access",
      "Local-folder connections",
    ],
    notYetSold: [],
  },
  team: {
    kind: "subscription",
    label: "Team",
    priceUsd: 199,
    included: { pcu: 3_000, kqu: 10_000, storageGb: 100, seats: 5 },
    credits: 12_000,
    includedPages: 3_000,
    priceEnv: "PADDLE_PRICE_TEAM",
    saleChannel: "self_serve",
    status: "v2",
    accessLevel: "studio_access",
    requires: ["pcu_accepted_meter", "kqu_meter", "storage_meter", "seat_cap", "per_member_source_scopes"],
    description: "The higher-volume plan.",
    features: [
      "3,000 standard pages",
      "Everything in Developer",
      "Local-folder connections",
    ],
    notYetSold: ["Per-member source permissions"],
  },
  business: {
    kind: "subscription",
    label: "Business",
    priceUsd: 799,
    included: { pcu: 12_000, kqu: 50_000, storageGb: 500, seats: 20 },
    credits: 48_000,
    includedPages: 12_000,
    priceEnv: "PADDLE_PRICE_BUSINESS",
    saleChannel: "self_serve",
    status: "v2",
    accessLevel: "studio_access",
    requires: [
      "pcu_accepted_meter", "kqu_meter", "storage_meter", "seat_cap",
      "per_member_source_scopes", "org_policy_audit",
    ],
    description: "The highest-volume plan, for an organization's sources.",
    features: [
      "12,000 standard pages",
      "Everything in Team",
      "Local-folder connections",
    ],
    notYetSold: ["Per-member source permissions", "Organization policy and audit"],
  },
  /*
    Retired by the V22 price book (Amendment 2, 2026-11-16). Never sold again, and never removed:
    a renewal settles through `findOfferByPriceId` and `kind`, so these two stay resolvable and
    their price envs stay set until no active subscription holds either price. Existing
    subscribers keep their price and terms until they change plan.
  */
  observer_access: {
    kind: "subscription",
    label: "Developer (2026-09 plan)",
    priceUsd: 29,
    credits: 2_000,
    includedPages: 500,
    priceEnv: "PADDLE_PRICE_OBSERVER_ACCESS",
    // Unchanged from the 2026-09 plan. `status: "retired"` is the gate: `planAvailability` is "retired" and checkout refuses it.
    saleChannel: "self_serve",
    status: "retired",
    accessLevel: "observer_access",
    included: null,
    requires: [],
    description: "For builders shipping source-grounded AI.",
    features: [
      "500 standard pages",
      "Compile your own worlds",
      "Evidence, Ask and signed export",
      "API and MCP access",
      // 2026-11-10: the `connections` level. Only providers with a production OAuth app are named.
      "Local-folder connections",
    ],
    notYetSold: [],
  },
  studio_access: {
    kind: "subscription",
    label: "Team (2026-09 plan)",
    priceUsd: 99,
    credits: 10_000,
    includedPages: 2_500,
    priceEnv: "PADDLE_PRICE_STUDIO_ACCESS",
    /*
      Contact sales (CAT-D4, 2026-11-16, lead decision on PR #230).

      PR #230 flipped this plan to self-serve. That flip is not landed: the V22 price book and its
      plan structure arrive through the catalog work orders (WO-CAT-1/2), and no price or sale
      channel changes before them. The plan stays a contact-sales plan, and `saleChannel` is the
      per-offer gate: the checkout route refuses any offer whose channel is "contact"
      (`decideOfferCheckoutPolicy`), whatever the commercial mode.
    */
    saleChannel: "contact",
    status: "retired",
    accessLevel: "studio_access",
    included: null,
    requires: [],
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
      "Everything in Developer (2026-09 plan)",
      "Review queue and version history",
      "Local-folder connections",
    ],
    // Kept as main has it: `lib/v34/routes.test.ts` holds /teams exactly while this lists shared members.
    notYetSold: ["Shared members and roles", "Per-member source permissions"],
  },
} as const satisfies Record<string, { requires: readonly Capability[]; [field: string]: unknown }>;

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

/** Free and Enterprise have no Paddle price, so they are not offers; the pricing page reads every plan from this module. */
export const PRICE_BOOK_EXTRA = {
  free: { label: "Free", priceUsd: 0, saleChannel: "self_serve" },
  enterprise: { label: "Enterprise", priceUsd: null, saleChannel: "contact" },
} as const;

const isRetired = (code: BillingOfferCode) => BILLING_OFFERS[code].status === "retired";

export function readConfiguredBillingOffers(env: Environment = process.env) {
  const claimed = new Map<string, BillingOfferCode[]>();
  for (const [code, definition] of Object.entries(BILLING_OFFERS) as Array<
    [BillingOfferCode, (typeof BILLING_OFFERS)[BillingOfferCode]]
  >) {
    const priceId = env[definition.priceEnv]?.trim() ?? "";
    if (/^pri_[a-z0-9]{26}$/.test(priceId)) claimed.set(priceId, [...claimed.get(priceId) ?? [], code]);
  }
  const configured = new Map<BillingOfferCode, BillingOffer>();
  for (const [priceId, codes] of claimed) {
    // A price id a retired offer holds stays with it, and one id claimed by two current offers
    // belongs to neither: `findOfferByPriceId` must name one offer, or a renewal settles on a guess.
    const owners = codes.some(isRetired) ? codes.filter(isRetired) : codes.length === 1 ? codes : [];
    for (const code of owners) configured.set(code, { ...BILLING_OFFERS[code], code, priceId });
  }
  return configured;
}

export type PlanAvailability = "purchasable" | "request_access" | "retired";

const lineDelivered = (code: BillingOfferCode, delivered: ReadonlySet<Capability>) =>
  (BILLING_OFFERS[code].requires as readonly Capability[]).every((c) => delivered.has(c));

/** The current offers whose whole line is delivered: they go on sale together, or none of them does. */
const saleGroup = (delivered: ReadonlySet<Capability>) =>
  (Object.keys(BILLING_OFFERS) as BillingOfferCode[]).filter((code) => !isRetired(code) && lineDelivered(code, delivered));

/**
 * The one decision every surface reads: buy online only when the product delivers the whole line and the sale is
 * configured whole. With DELIVERED as it is, that is Personal and Developer together: one of the two prices alone (or
 * one that is not a usable `pri_` id, which `readConfiguredBillingOffers` drops) opens neither -- `catalogConfigured`
 * reports it as a configuration error instead of a half-open sale.
 */
export function planAvailability(
  code: BillingOfferCode,
  configured: ReadonlyMap<BillingOfferCode, unknown> = readConfiguredBillingOffers(),
  delivered: ReadonlySet<Capability> = DELIVERED,
): PlanAvailability {
  if (isRetired(code)) return "retired";
  return lineDelivered(code, delivered) && saleGroup(delivered).every((member) => configured.has(member))
    ? "purchasable"
    : "request_access";
}

/**
 * What is wrong with the price configuration, by env name (empty = configured). A retired offer without its price is
 * a renewal incident; a current offer's env that is set to something `readConfiguredBillingOffers` cannot use (not a
 * `pri_` id, or shared with another offer) is an error, not "unset"; and the sale group is priced whole or not at
 * all. Every current price unset is a closed sale, which is a valid configuration. Env names only, never a value.
 */
export function priceConfigurationProblems(
  env: Environment = process.env,
  delivered: ReadonlySet<Capability> = DELIVERED,
): string[] {
  const configured = readConfiguredBillingOffers(env);
  const problems: string[] = [];
  for (const code of Object.keys(BILLING_OFFERS) as BillingOfferCode[]) {
    const { priceEnv } = BILLING_OFFERS[code];
    if (configured.has(code)) continue;
    if (isRetired(code)) problems.push(`${priceEnv}: missing, so a renewal of this retired plan cannot resolve`);
    else if (env[priceEnv]?.trim()) problems.push(`${priceEnv}: set, but not a usable Paddle price id`);
  }
  const group = saleGroup(delivered);
  const priced = group.filter((code) => configured.has(code));
  if (priced.length > 0 && priced.length < group.length) {
    const with_ = priced.map((code) => BILLING_OFFERS[code].priceEnv).join(", ");
    for (const code of group.filter((member) => !configured.has(member))) {
      problems.push(`${BILLING_OFFERS[code].priceEnv}: required with ${with_}; no plan is sold until the whole group is priced`);
    }
  }
  return problems;
}

/** Readiness of the price configuration, as /api/status and /status report it: no problem above. */
export function catalogConfigured(env: Environment = process.env, delivered: ReadonlySet<Capability> = DELIVERED) {
  return priceConfigurationProblems(env, delivered).length === 0;
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
