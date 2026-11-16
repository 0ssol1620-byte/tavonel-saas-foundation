import { describe, expect, it } from "vitest";
import { BILLING_OFFERS, REFUND_WINDOW_DAYS, refundablePageAllowance } from "./billing-catalog";
import { refundFacts } from "./refund-eligibility";

const DAY = 86_400_000;
const paidAt = "2026-11-01T00:00:00.000Z";
const base = { accessPlan: "observer_access", paidAt, renewsAt: "2026-12-01T00:00:00.000Z" };

describe("refund facts, recorded data only (R1 review, 2026-11-10)", () => {
  it("states the recorded payment, its window and the plan's page line", () => {
    expect(refundFacts(base)).toEqual({
      plan: "Starter",
      paidAt,
      renewsAt: base.renewsAt,
      windowEndsAt: new Date(Date.parse(paidAt) + REFUND_WINDOW_DAYS * DAY).toISOString(),
      allowancePages: refundablePageAllowance(BILLING_OFFERS.observer_access),
    });
    expect(refundFacts({ ...base, accessPlan: "studio_access" })?.allowancePages)
      .toBe(refundablePageAllowance(BILLING_OFFERS.studio_access));
  });

  it("never states a verdict or a page count, which nothing in the product reads", () => {
    const facts = refundFacts(base)!;
    expect(Object.keys(facts).sort()).toEqual(["allowancePages", "paidAt", "plan", "renewsAt", "windowEndsAt"]);
  });

  it("says unread when no payment was read, and has no facts for a plan off the list", () => {
    expect(refundFacts({ ...base, paidAt: null, renewsAt: null })).toMatchObject({ paidAt: null, windowEndsAt: null, renewsAt: null });
    expect(refundFacts({ ...base, paidAt: "not a date" })).toMatchObject({ paidAt: null, windowEndsAt: null });
    expect(refundFacts({ ...base, accessPlan: null })).toBeNull();
    expect(refundFacts({ ...base, accessPlan: "enterprise" })).toBeNull();
  });
});
