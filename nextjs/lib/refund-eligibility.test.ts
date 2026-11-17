import { describe, expect, it } from "vitest";
import { BILLING_OFFERS, REFUND_WINDOW_DAYS, refundablePageAllowance } from "./billing-catalog";
import { refundFacts } from "./refund-eligibility";

const DAY = 86_400_000;
const paidAt = "2026-11-01T00:00:00.000Z";
// A v2 holder as the billing projection writes it (20261117140000): the level in access_plan, the plan bought in plan_code.
const base = { accessPlan: "observer_access", planCode: "personal", paidAt, renewsAt: "2026-12-01T00:00:00.000Z" };
const v2 = (code: "personal" | "developer" | "team" | "business") => ({ ...base, accessPlan: BILLING_OFFERS[code].accessLevel, planCode: code });
const factsOf = (input: Parameters<typeof refundFacts>[0]) => {
  const reading = refundFacts(input);
  if (!reading.ok) throw new Error(reading.code);
  return reading.facts;
};

describe("refund facts, recorded data only (R1 review, 2026-11-10)", () => {
  it("states the recorded payment, its window and the plan's page line", () => {
    expect(factsOf(base)).toEqual({
      plan: "Personal",
      paidAt,
      renewsAt: base.renewsAt,
      windowEndsAt: new Date(Date.parse(paidAt) + REFUND_WINDOW_DAYS * DAY).toISOString(),
      allowancePages: refundablePageAllowance(BILLING_OFFERS.personal),
    });
    // The page line follows each plan's included pages (= PCU): 10% of the allowance, per plan.
    for (const code of ["developer", "team", "business"] as const) {
      expect(factsOf(v2(code)).allowancePages, code).toBe(refundablePageAllowance(BILLING_OFFERS[code]));
    }
    expect(factsOf(v2("team")).allowancePages).toBeGreaterThan(factsOf(base).allowancePages);
  });

  // WO-CAT-3B. Reading the level instead of the plan code names the 2026-09 Team plan and its 2,500 pages (250).
  it("states a v2 Team holder Team and the v2 Team page line, never its level's legacy plan", () => {
    expect(factsOf(v2("team"))).toMatchObject({ plan: "Team", allowancePages: refundablePageAllowance(BILLING_OFFERS.team) });
    expect(factsOf(v2("team")).allowancePages).toBe(300);
    expect(factsOf(v2("business"))).toMatchObject({ plan: "Business", allowancePages: 1_200 });
    expect(factsOf(v2("developer"))).toMatchObject({ plan: "Developer" });
  });

  // Golden values read from refundFacts at 7821b0fc, before the resolver (receipts/WO-CAT-3B/golden-legacy-before.json).
  it("states a retired plan's own label and page line to its holder, unchanged by the resolver", () => {
    const legacy = { paidAt, renewsAt: "2026-12-01T00:00:00.000Z", planCode: null };
    expect(refundFacts({ ...legacy, accessPlan: "observer_access" })).toEqual({ ok: true, facts: {
      plan: "Developer (2026-09 plan)", paidAt, renewsAt: "2026-12-01T00:00:00.000Z", windowEndsAt: "2026-11-15T00:00:00.000Z", allowancePages: 50,
    } });
    expect(refundFacts({ ...legacy, accessPlan: "studio_access" })).toEqual({ ok: true, facts: {
      plan: "Team (2026-09 plan)", paidAt, renewsAt: "2026-12-01T00:00:00.000Z", windowEndsAt: "2026-11-15T00:00:00.000Z", allowancePages: 250,
    } });
  });

  it("never states a verdict or a page count, which nothing in the product reads", () => {
    expect(Object.keys(factsOf(base)).sort()).toEqual(["allowancePages", "paidAt", "plan", "renewsAt", "windowEndsAt"]);
  });

  it("says unread when no payment was read, and has no facts for no plan or a plan the resolver refuses", () => {
    expect(factsOf({ ...base, paidAt: null, renewsAt: null })).toMatchObject({ paidAt: null, windowEndsAt: null, renewsAt: null });
    expect(factsOf({ ...base, paidAt: "not a date" })).toMatchObject({ paidAt: null, windowEndsAt: null });
    expect(refundFacts({ ...base, accessPlan: null, planCode: null })).toEqual({ ok: false, code: "REFUND_NO_PAID_PLAN" });
    for (const row of [
      { accessPlan: "studio_access", planCode: "enterprise" },
      { accessPlan: "observer_access", planCode: "team" },
      { accessPlan: null, planCode: "personal" },
      { accessPlan: "enterprise", planCode: null },
      { accessPlan: "team", planCode: null },
    ]) expect(refundFacts({ ...base, ...row }), JSON.stringify(row)).toEqual({ ok: false, code: "BILLING_PLAN_CODE_UNKNOWN" });
  });
});
