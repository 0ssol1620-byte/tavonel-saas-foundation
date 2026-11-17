import { describe, expect, it } from "vitest";
import { estimatorRows, monthlyTotalUsd } from "@/components/pricing-page-client";
import { BILLING_OFFERS, type BillingOfferCode } from "@/lib/billing-catalog";
import { PROCESSING_UNIT_USD, STANDARD_UNITS_PER_PAGE } from "@/lib/usage-pricing";

/*
  BA-121. The /pricing estimator and the /pricing volume table, held to the same arithmetic.

  They disagreed on the same screen by more than a factor of two. The table was built from
  `monthlyTotalUsd` -- the subscription plus the pages past the plan's included pages -- and the
  estimator was built from `quoteCompilePages`, which multiplies pages by the unit rate and knows
  nothing about a plan or a subscription. At the estimator's old default of 348 pages it printed a
  third of what the table said the same volume costs, because it left the subscription out. The
  number a buyer reads last was the one understating the bill.

  Four volumes, the ones the audit named: 50 and 250 are inside the entry plan, 300 and 348
  are also inside it (the plan includes 500), and the failure path below is the one that matters
  -- a volume past the included pages has to cost more than the subscription, in both surfaces.

  Catalog v2 (PB-2026-11-V22): one total per current plan, keyed by offer code, and the pages past
  the entry plan are counted against Personal.

  R1, delegated decision 2026-11-09: nothing sells or bills a page past the plan, so a volume past
  the included pages has no published price in either surface (`null`, "Arranged with us"), and
  the per-page ceiling row is gone. The agreement between the two surfaces is what stays pinned.
*/
const STANDARD_PAGE_USD = STANDARD_UNITS_PER_PAGE * PROCESSING_UNIT_USD;
const personal = BILLING_OFFERS.personal;
const team = BILLING_OFFERS.team;
const current = (Object.keys(BILLING_OFFERS) as BillingOfferCode[]).filter((code) => BILLING_OFFERS[code].status !== "retired");

describe("the /pricing estimator agrees with the volume table", () => {
  it("totals exactly the four current plans, never a retired one", () => {
    expect(current).toEqual(["personal", "developer", "team", "business"]);
    expect(Object.keys(estimatorRows(50).totalsUsd)).toEqual(current);
  });

  it.each([50, 250, 300, 348])("quotes %i pages as the table does", (pages) => {
    const rows = estimatorRows(pages);
    for (const code of current) expect(rows.totalsUsd[code], code).toBe(monthlyTotalUsd(BILLING_OFFERS[code], pages));
  });

  it.each([50, 250, 300, 348])("never prices %i pages below the subscription", (pages) => {
    const rows = estimatorRows(pages);
    for (const code of current) {
      // The defect this replaces: a per-page quote with no plan in it, under the subscription.
      expect(rows.totalsUsd[code], code).toBeGreaterThanOrEqual(BILLING_OFFERS[code].priceUsd);
      expect(rows.totalsUsd[code], code).not.toBe(pages * STANDARD_PAGE_USD);
    }
    // Inside the included pages nothing is added, and the extra row says so with a zero.
    expect(rows.extraPages).toBe(0);
  });

  it("prices no page past the plan, and counts them instead", () => {
    const pages = personal.includedPages + 100;
    const rows = estimatorRows(pages);
    expect(rows.extraPages).toBe(100);
    expect(rows.totalsUsd.personal).toBeNull();
    expect(rows.totalsUsd.developer).toBeNull();
    expect(rows.totalsUsd.personal).toBe(monthlyTotalUsd(personal, pages));
    // Team still covers the volume, so it still has a price.
    expect(rows.totalsUsd.team).toBe(team.priceUsd);
    expect(rows.totalsUsd.business).toBe(BILLING_OFFERS.business.priceUsd);
    expect(rows).not.toHaveProperty("extraPagesUsd");
  });

  it("a volume past every plan has no price on any of them", () => {
    const rows = estimatorRows(BILLING_OFFERS.business.includedPages + 1);
    for (const code of current) expect(rows.totalsUsd[code], code).toBeNull();
  });

  it("refuses to read a page count as a bare unit-rate quote", () => {
    // 348 was the old default, and a bare unit-rate quote for it sat under the plan price.
    expect(estimatorRows(348).totalsUsd.personal).not.toBeCloseTo(348 * STANDARD_PAGE_USD, 2);
  });
});
