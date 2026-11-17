import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { intent, binding, offers, delivered } = vi.hoisted(() => ({
  intent: vi.fn(),
  binding: vi.fn(),
  offers: { current: new Map<import("./billing-catalog").BillingOfferCode, unknown>() },
  delivered: { all: true },
}));

vi.mock("@/lib/account-grants", () => ({ getFoundationAccountGrant: async () => ({ ok: true, grant: null }) }));
vi.mock("@/lib/billing-binding", () => ({ createCheckoutBinding: binding }));
// The test seam: "every capability delivered" is the one thing a test may change about the catalog.
vi.mock("@/lib/billing-catalog", async (original) => {
  const catalog = await original<typeof import("./billing-catalog")>();
  return {
    ...catalog,
    readConfiguredBillingOffers: () => offers.current,
    planAvailability: (code: never) =>
      catalog.planAvailability(code, offers.current, delivered.all ? new Set(Object.values(catalog.BILLING_OFFERS).flatMap((o) => o.requires)) : new Set()),
    readPaddleBrowserConfig: () => ({ environment: "sandbox", clientToken: `test_${"a".repeat(30)}` }),
  };
});
vi.mock("@/lib/billing-store", () => ({
  issueFoundationCheckoutIntent: intent,
  getFoundationBillingAccount: async () => ({
    ok: true,
    account: { accessPlan: null, planCode: null, subscriptionStatus: "inactive", subscriptionCancelAt: null, paddleSubscriptionId: null },
  }),
}));
vi.mock("@/lib/commercial-state", () => ({
  readCommercialState: () => ({ provider: "sandbox", checkoutEnabled: true, liveChargesEnabled: false }),
}));
vi.mock("@/lib/foundation-pilot", () => ({
  getRequestUser: async () => ({ id: "11111111-1111-4111-8111-111111111111", email: "buyer@example.test" }),
  foundationPilotAccess: () => ({ membership: { workspaceId: "pilot-11111111" } }),
}));
vi.mock("@/lib/public-status", () => ({
  readPublicStatusV2: () => ({ availableActions: { purchasePlan: { enabled: true } } }),
}));

import {
  BILLING_OFFERS,
  PRICE_BOOK_VERSION,
  REFUND_MAX_CONSUMED_FRACTION,
  REFUND_WINDOW_DAYS,
  refundablePageAllowance,
  type BillingOfferCode,
} from "./billing-catalog";
import { quoteCheckout } from "./checkout-quote";
import { POST } from "../app/api/billing/checkout/route";

const codes = Object.keys(BILLING_OFFERS) as BillingOfferCode[];
const offerOf = (code: BillingOfferCode) => ({ ...BILLING_OFFERS[code], code });

describe("checkout quote", () => {
  it("covers all six offers", () => expect(codes).toHaveLength(6));

  for (const code of codes) {
    it(`${code}: every number equals the catalog`, async () => {
      const offer = BILLING_OFFERS[code];
      const quote = await quoteCheckout(offerOf(code));
      expect(quote).toMatchObject({
        offerCode: code,
        label: offer.label,
        priceUsd: offer.priceUsd,
        currency: "USD",
        interval: "month",
        includedPages: offer.includedPages,
        included: offer.included,
        overage: "stops_at_limit",
        refundWindowDays: REFUND_WINDOW_DAYS,
        refundablePages: refundablePageAllowance(offer),
      });
      expect(quote.pricingVersion).toMatch(/^sha256:[0-9a-f]{64}$/);
    });
  }

  it("a retired offer is quoted with no v2 allowance, not a made-up one", async () => {
    expect((await quoteCheckout(offerOf("observer_access"))).included).toBeNull();
  });

  it("the version is stable for the same inputs and differs per offer", async () => {
    const [a, b, c] = await Promise.all([quoteCheckout(offerOf("team")), quoteCheckout(offerOf("team")), quoteCheckout(offerOf("business"))]);
    expect(a.pricingVersion).toBe(b.pricingVersion);
    expect(c.pricingVersion).not.toBe(a.pricingVersion);
  });

  it("the version moves when any constant it covers changes", async () => {
    const base = { ...offerOf("developer"), included: { pcu: 500, kqu: 5_000, storageGb: 10, seats: 1 } };
    const same = (await quoteCheckout(base)).pricingVersion;
    const changed = await Promise.all([
      quoteCheckout({ ...base, priceUsd: base.priceUsd + 1 }),
      quoteCheckout({ ...base, includedPages: base.includedPages + 1 }),
      quoteCheckout({ ...base, included: { ...base.included, kqu: base.included.kqu + 1 } }),
      quoteCheckout(base, { windowDays: REFUND_WINDOW_DAYS + 1, maxConsumedFraction: REFUND_MAX_CONSUMED_FRACTION }),
      quoteCheckout(base, { windowDays: REFUND_WINDOW_DAYS, maxConsumedFraction: REFUND_MAX_CONSUMED_FRACTION + 0.05 }),
    ]);
    for (const quote of changed) expect(quote.pricingVersion).not.toBe(same);
    expect(new Set(changed.map((q) => q.pricingVersion)).size).toBe(changed.length);
  });

  it("pins the price book the quote belongs to", () => expect(PRICE_BOOK_VERSION).toBe("PB-2026-11-V22"));
});

const v2: BillingOfferCode[] = ["personal", "developer", "team", "business"];
const configured = (code: BillingOfferCode) => ({
  ...BILLING_OFFERS[code], code, priceId: `pri_${"a".repeat(26)}`,
});

function request(offerCode: string) {
  const body = JSON.stringify({ offerCode });
  return new Request("https://tavonel.test/api/billing/checkout", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(body)) },
    body,
  });
}

describe("checkout route returns the quote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("FOUNDATION_BILLING_HMAC", "h".repeat(32));
    binding.mockReturnValue({ tavonel_nonce: "nonce" });
    intent.mockResolvedValue({ ok: true });
    delivered.all = true;
    offers.current = new Map(v2.map((code) => [code, configured(code)]));
  });

  for (const code of v2) {
    it(`${code}: CHECKOUT_READY carries the catalog quote`, async () => {
      const response = await POST(request(code));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.code).toBe("CHECKOUT_READY");
      expect(body.quote).toEqual(await quoteCheckout({ ...BILLING_OFFERS[code], code }));
      expect(body.quote.priceUsd).toBe(BILLING_OFFERS[code].priceUsd);
    });
  }

  it("refuses before an intent when no plan is purchasable (nothing delivered)", async () => {
    delivered.all = false;
    for (const code of v2) {
      const response = await POST(request(code));
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({ code: "BILLING_OFFER_CONTACT_REQUIRED" });
    }
    expect(binding).not.toHaveBeenCalled();
    expect(intent).not.toHaveBeenCalled();
  });

  it("refuses a retired offer before an intent, even when its price is configured", async () => {
    offers.current = new Map([["observer_access", configured("observer_access")]]);
    const response = await POST(request("observer_access"));
    expect(response.status).toBe(403);
    expect(intent).not.toHaveBeenCalled();
  });

  it("refuses an unknown offer with 400 and no quote", async () => {
    const response = await POST(request("platinum"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: "BILLING_OFFER_INVALID" });
  });
});

describe("the version covers the module constants (failure path)", () => {
  async function versionWith(catalog?: Record<string, unknown>, usage?: Record<string, unknown>) {
    vi.resetModules();
    if (catalog) vi.doMock("./billing-catalog", async (orig) => ({ ...(await orig<object>()), ...catalog }));
    if (usage) vi.doMock("./usage-pricing", async (orig) => ({ ...(await orig<object>()), ...usage }));
    const { quoteCheckout: quote } = await import("./checkout-quote");
    const { BILLING_OFFERS: offers } = await import("./billing-catalog");
    return (await quote({ ...offers.developer, code: "developer" })).pricingVersion;
  }
  afterEach(() => {
    vi.doUnmock("./billing-catalog");
    vi.doUnmock("./usage-pricing");
  });

  it("PRICE_BOOK_VERSION, METER_RATES_USD and the intake canonical each move it", async () => {
    const base = await versionWith();
    const priceBook = await versionWith({ PRICE_BOOK_VERSION: "PB-X" });
    const meters = await versionWith({ METER_RATES_USD: { pcu: 0.05, kqu: 0.006, storageGbMonth: 0.2, seatMonth: 15 } });
    const intake = await versionWith(undefined, { intakePricingCanonical: () => "changed" });
    expect(new Set([base, priceBook, meters, intake]).size).toBe(4);
  });
});
