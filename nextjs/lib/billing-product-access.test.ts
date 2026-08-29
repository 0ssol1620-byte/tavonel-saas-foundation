import { describe, expect, it } from "vitest";
import { EMPTY_BILLING_ACCOUNT, type FoundationBillingAccount } from "./billing-store";
import { billingProductDecision } from "./billing-product-access";

const account = (overrides: Partial<FoundationBillingAccount> = {}): FoundationBillingAccount => ({
  workspaceKey: "pilot-test",
  userId: "44444444-4444-4444-8444-444444444444",
  ...EMPTY_BILLING_ACCOUNT,
  ...overrides,
});

describe("paid product access matrix", () => {
  it("fails closed for inactive, held, and observer write access", () => {
    expect(billingProductDecision(account(), "observer")).toMatchObject({ ok: false, code: "SUBSCRIPTION_REQUIRED" });
    expect(billingProductDecision(account({ accessPlan: "studio_access", subscriptionStatus: "active", billingHold: true }), "studio"))
      .toMatchObject({ ok: false, code: "BILLING_HOLD" });
    expect(billingProductDecision(account({ accessPlan: "observer_access", subscriptionStatus: "active" }), "studio"))
      .toMatchObject({ ok: false, code: "STUDIO_SUBSCRIPTION_REQUIRED" });
  });

  it("allows Observer reads and Studio governed writes while active or trialing", () => {
    expect(billingProductDecision(account({ accessPlan: "observer_access", subscriptionStatus: "active" }), "observer")).toEqual({ ok: true });
    expect(billingProductDecision(account({ accessPlan: "studio_access", subscriptionStatus: "trialing" }), "studio")).toEqual({ ok: true });
  });
});
