import { describe, expect, it } from "vitest";
import { accessPlanAction } from "./billing-plan-action";

const account = (overrides: Partial<Parameters<typeof accessPlanAction>[0]> = {}) => ({
  accessPlan: "observer_access",
  subscriptionStatus: "active",
  subscriptionCancelAt: null,
  paddleCustomerId: `ctm_${"a".repeat(26)}`,
  ...overrides,
});

describe("workspace access plan actions", () => {
  it("does not open a duplicate checkout for the active plan", () => {
    expect(accessPlanAction(account(), "observer_access")).toEqual({ kind: "disabled", label: "Current plan" });
  });

  it("routes an active Observer change through Paddle's portal", () => {
    expect(accessPlanAction(account(), "studio_access")).toEqual({ kind: "portal", label: "Manage plan" });
  });

  it("permits the qualified replacement checkout for a canceling Observer plan", () => {
    expect(accessPlanAction(account({ subscriptionCancelAt: "2026-09-29T10:04:40.000Z" }), "studio_access")).toEqual({
      kind: "checkout",
      label: "Start Studio",
      offerCode: "studio_access",
    });
  });

  it("keeps the lower tier disabled when Studio is active", () => {
    expect(accessPlanAction(account({ accessPlan: "studio_access" }), "observer_access")).toEqual({
      kind: "disabled",
      label: "Included with Studio",
    });
  });

  it("offers checkout when no active entitlement exists", () => {
    expect(accessPlanAction(null, "studio_access")).toEqual({
      kind: "checkout",
      label: "Choose Studio",
      offerCode: "studio_access",
    });
  });
});
