import { beforeEach, describe, expect, it, vi } from "vitest";

const { gate, intent, commercial, binding, billingAccount, seam, quote } = vi.hoisted(() => ({
  billingAccount: vi.fn(),
  // The real quote by default (set in beforeEach); a test makes it fail to pin the order of quote and intent.
  quote: vi.fn(),
  gate: vi.fn(),
  intent: vi.fn(),
  commercial: vi.fn(),
  binding: vi.fn(),
  // The catalog v2 test seam: what the deployment delivers and holds. Everything below is the live gate with a plan on sale.
  seam: { delivered: true, configured: true, paddle: true },
}));

vi.mock("@/lib/account-grants", () => ({
  getFoundationAccountGrant: async () => ({ ok: true, grant: null }),
}));
vi.mock("@/lib/billing-binding", () => ({ createCheckoutBinding: binding }));
/*
  Catalog v2 (WO-CAT-1/2): no plan is purchasable while `DELIVERED` is empty, so this file gives the route a purchasable plan the
  way `checkout-quote.test.ts` does: the catalog with `planAvailability` handed every capability, plus a configured v2 price.
  The live-checkout customer-data gate it exercises is unchanged; only the plan it is exercised with is the v2 `developer`.
*/
vi.mock("@/lib/billing-catalog", async (original) => {
  const catalog = await original<typeof import("./billing-catalog")>();
  const all = new Set(Object.values(catalog.BILLING_OFFERS).flatMap((offer) => offer.requires));
  const configured = () => seam.configured
    ? new Map([["developer", { ...catalog.BILLING_OFFERS.developer, code: "developer", priceId: `pri_${"a".repeat(26)}` }]])
    : new Map();
  return {
    ...catalog,
    readConfiguredBillingOffers: configured,
    planAvailability: (code: never, offers: never = configured() as never) =>
      catalog.planAvailability(code, offers, seam.delivered ? all : new Set()),
    readPaddleBrowserConfig: () => !seam.paddle ? null : commercial().provider === "sandbox"
      ? { environment: "sandbox", clientToken: `test_${"a".repeat(30)}` }
      : { environment: "production", clientToken: `live_${"a".repeat(30)}` },
  };
});
vi.mock("@/lib/billing-store", () => ({
  issueFoundationCheckoutIntent: intent,
  getFoundationBillingAccount: billingAccount,
}));
vi.mock("@/lib/commercial-state", () => ({ readCommercialState: commercial }));
vi.mock("@/lib/checkout-quote", () => ({ quoteCheckout: quote }));
vi.mock("@/lib/customer-data-admission", async () => ({
  readCustomerSourceAuthorization: gate,
  authorizationStage: (await import("../../shared/customerDataAuthorization")).authorizationStage,
}));
const refused = { ok: false, code: "SCOPED_RELEASE_NOT_FOUND" };
const approved = (stage?: "production" | "qualification") => ({ ok: true, decision: stage
  ? { allowed: true, schemaVersion: "tavonel.customer_data_gate.v2", stage,
      release: { stage }, grant: { stage } }
  : { allowed: true, schemaVersion: "tavonel.customer_data_gate.v1" } });
vi.mock("@/lib/foundation-pilot", () => ({
  getRequestUser: async () => ({ id: "11111111-1111-4111-8111-111111111111", email: "buyer@example.test" }),
  foundationPilotAccess: () => ({ membership: { workspaceId: "pilot-11111111" } }),
}));
vi.mock("@/lib/public-status", () => ({
  readPublicStatusV2: () => ({ availableActions: { purchasePlan: { enabled: true } } }),
}));

import { POST } from "../app/api/billing/checkout/route";
const { quoteCheckout: realQuote } = await vi.importActual<typeof import("./checkout-quote")>("./checkout-quote");

function request(offerCode = "developer") {
  const body = JSON.stringify({ offerCode });
  return new Request("https://tavonel.test/api/billing/checkout", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(body)) },
    body,
  });
}

describe("live checkout requires the buyer's document-processing receipt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(seam, { delivered: true, configured: true, paddle: true });
    vi.stubEnv("FOUNDATION_BILLING_HMAC", "h".repeat(32));
    commercial.mockReturnValue({ provider: "production", checkoutEnabled: true, liveChargesEnabled: true });
    binding.mockReturnValue({ tavonel_nonce: "nonce" });
    intent.mockResolvedValue({ ok: true });
    quote.mockImplementation(realQuote);
    billingAccount.mockResolvedValue({ ok: true, account: { accessPlan: null, subscriptionStatus: "inactive", subscriptionCancelAt: null, paddleSubscriptionId: null } });
  });

  // R1 review (2026-11-10): a held subscription the projection would not replace refuses before any intent.
  // The holder is on the 2026-09 plan (`observer_access`): over a live subscription the only checkout the projection
  // can apply is a replacement, so an active one is refused with the plan-change code, never a second payment.
  for (const [subscriptionStatus, code] of [
    ["past_due", "BILLING_SUBSCRIPTION_NEEDS_PORTAL"],
    ["paused", "BILLING_SUBSCRIPTION_NEEDS_PORTAL"],
    ["canceled", "BILLING_RESUBSCRIBE_CONTACT"],
    ["active", "BILLING_PLAN_CHANGE_REQUIRED"],
  ] as const) {
    it(`refuses a second subscription over a ${subscriptionStatus} one before any payment intent exists`, async () => {
      gate.mockResolvedValue(approved());
      billingAccount.mockResolvedValue({ ok: true, account: {
        accessPlan: "observer_access", subscriptionStatus, subscriptionCancelAt: null, paddleSubscriptionId: `sub_${"a".repeat(26)}`,
      } });
      const response = await POST(request());
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({ code });
      expect(binding).not.toHaveBeenCalled();
      expect(intent).not.toHaveBeenCalled();
    });
  }

  it("refuses to create a live payment intent when this workspace cannot compile", async () => {
    gate.mockResolvedValue(refused);
    const response = await POST(request());
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ code: "CUSTOMER_DATA_NOT_ENABLED_FOR_WORKSPACE" });
    expect(gate).toHaveBeenCalledWith("pilot-11111111", "direct_upload");
    expect(binding).not.toHaveBeenCalled();
    expect(intent).not.toHaveBeenCalled();
  });

  it("creates the checkout intent after an exact-workspace approval", async () => {
    gate.mockResolvedValue(approved());
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(intent).toHaveBeenCalledOnce();
    // WO-CAT-2 L5: the quote the overlay needs is made before the intent is recorded, and it is the one returned.
    expect(quote.mock.invocationCallOrder[0]).toBeLessThan(intent.mock.invocationCallOrder[0]!);
    expect(quote.mock.invocationCallOrder[0]).toBeLessThan(binding.mock.invocationCallOrder[0]!);
    await expect(response.json()).resolves.toMatchObject({ quote: { offerCode: "developer", priceUsd: 49 } });
    // Billing integrity: the signer is handed the stored key exactly, not a trimmed copy.
    expect(binding).toHaveBeenCalledWith(expect.anything(), "h".repeat(32));
  });

  it("a quote that cannot be made leaves no checkout intent and no signed binding (WO-CAT-2 L5)", async () => {
    gate.mockResolvedValue(approved());
    quote.mockRejectedValue(new Error("fingerprint unavailable"));
    await expect(POST(request())).rejects.toThrow("fingerprint unavailable");
    expect(binding).not.toHaveBeenCalled();
    expect(intent).not.toHaveBeenCalled();
  });

  it("refuses to sign with a binding key that carries surrounding whitespace (billing integrity)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    gate.mockResolvedValue(approved());
    vi.stubEnv("FOUNDATION_BILLING_HMAC", `${"h".repeat(32)}\n`);
    const response = await POST(request());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ code: "BILLING_NOT_CONFIGURED" });
    expect(binding).not.toHaveBeenCalled();
    expect(intent).not.toHaveBeenCalled();
  });

  it("keeps the existing sandbox billing qualification independent of customer-data approval", async () => {
    commercial.mockReturnValue({ provider: "sandbox", checkoutEnabled: true, liveChargesEnabled: false });
    gate.mockResolvedValue(refused);
    const response = await POST(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ environment: "sandbox" });
    expect(gate).not.toHaveBeenCalled();
    expect(intent).toHaveBeenCalledOnce();
  });

  it("never opens a live checkout for a qualification-stage grant", async () => {
    gate.mockResolvedValue(approved("qualification"));
    const response = await POST(request());
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ code: "PROCESSING_QUALIFICATION_NOT_BILLABLE" });
    expect(binding).not.toHaveBeenCalled();
    expect(intent).not.toHaveBeenCalled();

    gate.mockResolvedValue(approved("production"));
    expect((await POST(request())).status).toBe(200);
    expect(intent).toHaveBeenCalledOnce();
  });

  /*
    The order of the two refusals (WO-CAT-2 amendment, section 6(d)). The offer policy runs before the configured-offer
    check, so a plan that is not sold online answers 403 whether or not its price env is set, and a plan that is on sale
    but cannot be opened (no Paddle client token) is the 503. Each order is pinned, both ways.
  */
  describe("the offer policy answers before the configuration check", () => {
    it("an undelivered plan with no price env is 403, never 503 BILLING_NOT_CONFIGURED", async () => {
      Object.assign(seam, { delivered: false, configured: false });
      gate.mockResolvedValue(approved());
      const response = await POST(request());
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({ code: "BILLING_OFFER_CONTACT_REQUIRED" });
      expect(binding).not.toHaveBeenCalled();
      expect(intent).not.toHaveBeenCalled();
    });

    it("an undelivered plan whose price is configured is the same 403", async () => {
      Object.assign(seam, { delivered: false, configured: true });
      gate.mockResolvedValue(approved());
      const response = await POST(request());
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({ code: "BILLING_OFFER_CONTACT_REQUIRED" });
      expect(intent).not.toHaveBeenCalled();
    });

    it("a retired plan is 403 before any intent, whatever the deployment delivers", async () => {
      gate.mockResolvedValue(approved());
      for (const code of ["observer_access", "studio_access"]) {
        const response = await POST(request(code));
        expect(response.status, code).toBe(403);
        await expect(response.json()).resolves.toEqual({ code: "BILLING_OFFER_CONTACT_REQUIRED" });
      }
      expect(intent).not.toHaveBeenCalled();
    });

    it("a plan on sale that cannot be opened is the 503, so the configuration check still answers once the policy allows", async () => {
      Object.assign(seam, { delivered: true, configured: true, paddle: false });
      gate.mockResolvedValue(approved());
      const response = await POST(request());
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({ code: "BILLING_NOT_CONFIGURED" });
      expect(binding).not.toHaveBeenCalled();
      expect(intent).not.toHaveBeenCalled();
    });

    it("a delivered plan whose price is missing is refused by the policy too: the price is half of purchasable", async () => {
      // `planAvailability` needs a configured price, so a missing one cannot be on sale: the policy refuses first.
      Object.assign(seam, { delivered: true, configured: false });
      gate.mockResolvedValue(approved());
      const response = await POST(request());
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({ code: "BILLING_OFFER_CONTACT_REQUIRED" });
    });
  });
});
