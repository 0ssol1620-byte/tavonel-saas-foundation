export const BILLING_OFFERS = {
  observer_access: {
    kind: "subscription",
    label: "Observer",
    priceUsd: 29,
    credits: 0,
    priceEnv: "PADDLE_PRICE_OBSERVER_ACCESS",
  },
  studio_access: {
    kind: "subscription",
    label: "Studio",
    priceUsd: 99,
    credits: 0,
    priceEnv: "PADDLE_PRICE_STUDIO_ACCESS",
  },
  credit_starter: {
    kind: "prepaid",
    label: "Starter",
    priceUsd: 12,
    credits: 100,
    priceEnv: "PADDLE_PRICE_CREDIT_STARTER",
  },
  credit_builder: {
    kind: "prepaid",
    label: "Builder",
    priceUsd: 30,
    credits: 300,
    priceEnv: "PADDLE_PRICE_CREDIT_BUILDER",
  },
  credit_scale: {
    kind: "prepaid",
    label: "Scale",
    priceUsd: 75,
    credits: 800,
    priceEnv: "PADDLE_PRICE_CREDIT_SCALE",
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
