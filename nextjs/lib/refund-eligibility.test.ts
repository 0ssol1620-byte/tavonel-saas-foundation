import { describe, expect, it } from "vitest";
import { BILLING_OFFERS, REFUND_WINDOW_DAYS, refundablePageAllowance } from "./billing-catalog";
import { refundFacts } from "./refund-eligibility";

const DAY = 86_400_000;
const paidAt = "2026-11-01T00:00:00.000Z";
const paid = Date.parse(paidAt);
const developer = BILLING_OFFERS.observer_access;
const perPage = developer.credits / developer.includedPages;
const base = { accessPlan: "observer_access", creditBalance: developer.credits, paidAt, renewsAt: "2026-12-01T00:00:00.000Z" };

describe("refund eligibility, from the catalog's rule", () => {
  it("is inside the rule within the window and under the page line", () => {
    const facts = refundFacts({ ...base, creditBalance: developer.credits - 10 * perPage }, paid + 3 * DAY);
    expect(facts).toEqual({
      plan: "Developer",
      paidAt,
      renewsAt: base.renewsAt,
      windowEndsAt: new Date(paid + REFUND_WINDOW_DAYS * DAY).toISOString(),
      consumedPages: 10,
      allowancePages: refundablePageAllowance(developer),
      eligible: true,
    });
  });

  it("is outside the rule once the allowance is reached, even inside the window", () => {
    const allowance = refundablePageAllowance(developer);
    expect(refundFacts({ ...base, creditBalance: developer.credits - (allowance - 1) * perPage }, paid)?.eligible).toBe(true);
    expect(refundFacts({ ...base, creditBalance: developer.credits - allowance * perPage }, paid)?.eligible).toBe(false);
    // A partly used page counts as a page.
    expect(refundFacts({ ...base, creditBalance: developer.credits - 1 }, paid)?.consumedPages).toBe(1);
  });

  it("is outside the rule after the window, even with nothing used", () => {
    expect(refundFacts(base, paid + REFUND_WINDOW_DAYS * DAY)?.eligible).toBe(true);
    expect(refundFacts(base, paid + REFUND_WINDOW_DAYS * DAY + 1)?.eligible).toBe(false);
  });

  it("says unread, not no, when the payment date was not read", () => {
    const facts = refundFacts({ ...base, paidAt: null, renewsAt: null }, paid);
    expect(facts).toMatchObject({ paidAt: null, windowEndsAt: null, renewsAt: null, eligible: null });
    expect(refundFacts({ ...base, paidAt: "not a date" }, paid)).toMatchObject({ paidAt: null, eligible: null });
  });

  it("counts a balance above the plan's credits as nothing consumed, and has no facts for a plan off the list", () => {
    expect(refundFacts({ ...base, creditBalance: developer.credits * 2 }, paid)?.consumedPages).toBe(0);
    expect(refundFacts({ ...base, accessPlan: null }, paid)).toBeNull();
    expect(refundFacts({ ...base, accessPlan: "enterprise" }, paid)).toBeNull();
  });
});
