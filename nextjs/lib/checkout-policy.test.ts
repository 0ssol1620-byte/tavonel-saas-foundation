import { describe, expect, it } from "vitest";
import { BILLING_OFFERS } from "./billing-catalog";
import { decideCheckoutPolicy, decideOfferCheckoutPolicy } from "./checkout-policy";
import type { CommercialState } from "./commercial-state";

const state = (overrides: Partial<CommercialState>): CommercialState => ({
  mode: "live",
  provider: "production",
  checkoutEnabled: true,
  liveChargesEnabled: true,
  legalTermsVersion: "live-2026-08-30",
  ...overrides,
});

describe("checkout deployment policy", () => {
  it("refuses production money while the purchased workflow is closed", () => {
    expect(decideCheckoutPolicy(state({}), false)).toEqual({
      allowed: false,
      code: "BILLING_LAUNCH_PENDING",
    });
  });

  it("permits production only when commerce and the workflow are both open", () => {
    expect(decideCheckoutPolicy(state({}), true)).toEqual({ allowed: true, mode: "production" });
    expect(decideCheckoutPolicy(state({ checkoutEnabled: false }), true).allowed).toBe(false);
  });

  it("keeps sandbox qualification available without claiming live purchasing", () => {
    expect(decideCheckoutPolicy(state({
      mode: "pilot",
      provider: "sandbox",
      liveChargesEnabled: false,
      legalTermsVersion: "pilot-2026-08-30",
    }), false)).toEqual({ allowed: true, mode: "sandbox_qualification" });
  });

  it("keeps contact-only offers out of both sandbox and production self-service checkout", () => {
    expect(decideOfferCheckoutPolicy(BILLING_OFFERS.observer_access)).toEqual({ allowed: true });
    expect(decideOfferCheckoutPolicy(BILLING_OFFERS.studio_access)).toEqual({
      allowed: false,
      code: "BILLING_OFFER_CONTACT_REQUIRED",
    });
  });
});
