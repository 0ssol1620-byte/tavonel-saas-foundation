import { describe, expect, it } from "vitest";
import { BILLING_OFFERS } from "./billing-catalog";
import { decideCheckoutPolicy, decideOfferCheckoutPolicy, decideSubscriptionChange } from "./checkout-policy";
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
    // Team self-serve (2026-11-10, intended): Team is self_serve. The gate itself still refuses any contact-only offer.
    expect(decideOfferCheckoutPolicy(BILLING_OFFERS.studio_access)).toEqual({ allowed: true });
    expect(decideOfferCheckoutPolicy({ saleChannel: "contact" })).toEqual({
      allowed: false,
      code: "BILLING_OFFER_CONTACT_REQUIRED",
    });
  });
});

describe("one subscription per workspace (Team self-serve, 2026-11-10)", () => {
  const none = { accessPlan: null, subscriptionStatus: "inactive", subscriptionCancelAt: null, paddleSubscriptionId: null };
  const developer = { accessPlan: "observer_access", subscriptionStatus: "active", subscriptionCancelAt: null, paddleSubscriptionId: "sub_1" };
  it("lets a workspace with no live subscription buy either plan", () => {
    expect(decideSubscriptionChange(none, "observer_access")).toEqual({ allowed: true });
    expect(decideSubscriptionChange(none, "studio_access")).toEqual({ allowed: true });
    expect(decideSubscriptionChange({ ...developer, subscriptionStatus: "canceled" }, "studio_access")).toEqual({ allowed: true });
  });
  it("refuses a second subscription, and admits only the Developer-to-Team replacement after Developer is set to cancel", () => {
    expect(decideSubscriptionChange(developer, "observer_access")).toEqual({ allowed: false, code: "BILLING_PLAN_ALREADY_ACTIVE" });
    expect(decideSubscriptionChange(developer, "studio_access")).toEqual({ allowed: false, code: "BILLING_PLAN_CHANGE_REQUIRED" });
    expect(decideSubscriptionChange({ ...developer, subscriptionCancelAt: "2026-12-01T00:00:00Z" }, "studio_access")).toEqual({ allowed: true });
    const team = { ...developer, accessPlan: "studio_access" };
    expect(decideSubscriptionChange(team, "observer_access")).toEqual({ allowed: false, code: "BILLING_PLAN_CHANGE_REQUIRED" });
    expect(decideSubscriptionChange({ ...team, subscriptionCancelAt: "2026-12-01T00:00:00Z" }, "observer_access"))
      .toEqual({ allowed: false, code: "BILLING_PLAN_CHANGE_REQUIRED" });
  });
});
