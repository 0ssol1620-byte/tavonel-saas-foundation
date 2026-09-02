export const BILLING_OFFERS = {
  observer_access: {
    kind: "subscription",
    label: "Developer",
    priceUsd: 29,
    credits: 2_000,
    includedPages: 500,
    priceEnv: "PADDLE_PRICE_OBSERVER_ACCESS",
  },
  studio_access: {
    kind: "subscription",
    label: "Team",
    priceUsd: 99,
    credits: 10_000,
    includedPages: 2_500,
    priceEnv: "PADDLE_PRICE_STUDIO_ACCESS",
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
