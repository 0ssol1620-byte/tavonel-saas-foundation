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
  it("lets a workspace that never held a subscription buy either plan", () => {
    expect(decideSubscriptionChange(none, "observer_access")).toEqual({ allowed: true });
    expect(decideSubscriptionChange(none, "studio_access")).toEqual({ allowed: true });
  });
  /*
    R1 review (2026-11-10, intended): the projection (0005) never replaces a held subscription id
    except by the 0010 upgrade, so these are refused before Paddle charges. The earlier pin let an
    ended Developer buy again, which Paddle would charge and the projection would refuse.
  */
  it("sends past due and paused to the portal, and an ended subscription to us, for either plan", () => {
    for (const offer of ["observer_access", "studio_access"]) {
      for (const status of ["past_due", "paused"]) {
        expect(decideSubscriptionChange({ ...developer, subscriptionStatus: status }, offer))
          .toEqual({ allowed: false, code: "BILLING_SUBSCRIPTION_NEEDS_PORTAL" });
        expect(decideSubscriptionChange({ ...developer, accessPlan: "studio_access", subscriptionStatus: status }, offer))
          .toEqual({ allowed: false, code: "BILLING_SUBSCRIPTION_NEEDS_PORTAL" });
      }
      for (const status of ["canceled", "inactive"]) {
        expect(decideSubscriptionChange({ ...developer, subscriptionStatus: status, subscriptionCancelAt: "2026-12-01T00:00:00Z" }, offer))
          .toEqual({ allowed: false, code: "BILLING_RESUBSCRIBE_CONTACT" });
      }
    }
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
