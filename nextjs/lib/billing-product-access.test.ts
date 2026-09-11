import { describe, expect, it } from "vitest";
import { EMPTY_BILLING_ACCOUNT, type FoundationBillingAccount } from "./billing-store";
import { billingProductDecision } from "./billing-product-access";

const account = (overrides: Partial<FoundationBillingAccount> = {}): FoundationBillingAccount => ({
  workspaceKey: "pilot-test",
  userId: "44444444-4444-4444-8444-444444444444",
  ...EMPTY_BILLING_ACCOUNT,
  ...overrides,
});

const developer = account({ accessPlan: "observer_access", subscriptionStatus: "active" });
const team = account({ accessPlan: "studio_access", subscriptionStatus: "active" });

describe("paid product access matrix", () => {
  it("fails closed for inactive, held, and observer write access", () => {
    expect(billingProductDecision(account(), "observer")).toMatchObject({ ok: false, code: "SUBSCRIPTION_REQUIRED" });
    expect(billingProductDecision(account({ accessPlan: "studio_access", subscriptionStatus: "active", billingHold: true }), "studio"))
      .toMatchObject({ ok: false, code: "BILLING_HOLD" });
    expect(billingProductDecision(developer, "studio"))
      .toMatchObject({ ok: false, code: "STUDIO_SUBSCRIPTION_REQUIRED" });
  });

  it("allows Observer reads and Studio governed writes while active or trialing", () => {
    expect(billingProductDecision(developer, "observer")).toEqual({ ok: true });
    expect(billingProductDecision(account({ accessPlan: "studio_access", subscriptionStatus: "trialing" }), "studio")).toEqual({ ok: true });
  });
});

/*
  World activation, which is the one level that is a plan *and* a role question.

  The Developer plan is a single-person plan bought with a card, so it activates as the workspace
  owner and only as the owner. The Team plan sells shared membership, so its answer here does not
  move at all -- the roles that governed activation before still govern it, enforced by the route,
  and this function keeps admitting the plan regardless of which of them is asking.

  Every refusal is `STUDIO_SUBSCRIPTION_REQUIRED`, deliberately: it is the code clients already
  branch on, and what changed is who satisfies the gate rather than what a refusal is called.
*/
describe("World activation", () => {
  it("admits the Developer plan when the caller owns the workspace", () => {
    expect(billingProductDecision(developer, "activation", "owner")).toEqual({ ok: true });
  });

  it.each(["admin", "member", "viewer"] as const)(
    "refuses the Developer plan for a %s with the existing code",
    (role) => {
      const decision = billingProductDecision(developer, "activation", role);
      expect(decision).toMatchObject({ ok: false, code: "STUDIO_SUBSCRIPTION_REQUIRED", status: 402 });
    },
  );

  it("refuses the Developer plan when no role was stated at all", () => {
    // Fails closed: a caller that does not say who is asking is not answered as the owner.
    expect(billingProductDecision(developer, "activation")).toMatchObject({
      ok: false,
      code: "STUDIO_SUBSCRIPTION_REQUIRED",
    });
  });

  it.each(["owner", "admin", "member", "viewer", undefined] as const)(
    "leaves the Team plan admitted for %s, as before",
    (role) => {
      expect(billingProductDecision(team, "activation", role)).toEqual({ ok: true });
    },
  );

  /*
    The evaluation trial. It holds no `accessPlan`, so it never reaches the plan/role question at
    all -- it is refused one step earlier, and told that its subscription is what is missing
    rather than that its role is wrong.
  */
  it("refuses an evaluation trial, owner role and all", () => {
    expect(billingProductDecision(account(), "activation", "owner")).toMatchObject({
      ok: false,
      code: "SUBSCRIPTION_REQUIRED",
      status: 402,
    });
  });

  it("refuses an owner on a cancelled Developer subscription", () => {
    const lapsed = account({ accessPlan: "observer_access", subscriptionStatus: "canceled" });
    expect(billingProductDecision(lapsed, "activation", "owner")).toMatchObject({
      ok: false,
      code: "SUBSCRIPTION_REQUIRED",
    });
  });

  it("refuses an owner on either plan while a billing hold is in force", () => {
    for (const plan of ["observer_access", "studio_access"] as const) {
      const held = account({ accessPlan: plan, subscriptionStatus: "active", billingHold: true });
      expect(billingProductDecision(held, "activation", "owner")).toMatchObject({
        ok: false,
        code: "BILLING_HOLD",
      });
    }
  });
});
