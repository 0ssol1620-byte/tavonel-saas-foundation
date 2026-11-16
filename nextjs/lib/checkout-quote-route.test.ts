import { beforeEach, describe, expect, it, vi } from "vitest";

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
    account: { accessPlan: null, subscriptionStatus: "inactive", subscriptionCancelAt: null, paddleSubscriptionId: null },
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

import { BILLING_OFFERS, type BillingOfferCode } from "./billing-catalog";
import { quoteCheckout } from "./checkout-quote";
import { POST } from "../app/api/billing/checkout/route";

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
