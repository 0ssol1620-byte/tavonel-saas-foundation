import { describe, expect, it } from "vitest";
import { estimatorRows, monthlyTotalUsd } from "@/components/pricing-page-client";
import { BILLING_OFFERS } from "@/lib/billing-catalog";
import { MAX_UNITS_PER_PAGE, PROCESSING_UNIT_USD, STANDARD_UNITS_PER_PAGE } from "@/lib/usage-pricing";

/*
  BA-121. The /pricing estimator and the /pricing volume table, held to the same arithmetic.

  They disagreed on the same screen by more than a factor of two. The table was built from
  `monthlyTotalUsd` -- the subscription plus the pages past the plan's included pages -- and the
  estimator was built from `quoteCompilePages`, which multiplies pages by the unit rate and knows
  nothing about a plan or a subscription. At the estimator's old default of 348 pages it printed a
  third of what the table said the same volume costs, because it left the subscription out. The
  number a buyer reads last was the one understating the bill.

  Four volumes, the ones the audit named: 50 and 250 are inside the Developer plan, 300 and 348
  are also inside it (the plan includes 500), and the failure path below is the one that matters
  -- a volume past the included pages has to cost more than the subscription, in both surfaces.
*/
const STANDARD_PAGE_USD = STANDARD_UNITS_PER_PAGE * PROCESSING_UNIT_USD;
const MAXIMUM_PAGE_USD = MAX_UNITS_PER_PAGE * PROCESSING_UNIT_USD;
const developer = BILLING_OFFERS.observer_access;
const team = BILLING_OFFERS.studio_access;

describe("the /pricing estimator agrees with the volume table", () => {
  it.each([50, 250, 300, 348])("quotes %i pages as the table does", (pages) => {
    const rows = estimatorRows(pages);
    expect(rows.developerTotalUsd).toBe(monthlyTotalUsd(developer, pages));
    expect(rows.teamTotalUsd).toBe(monthlyTotalUsd(team, pages));
  });

  it.each([50, 250, 300, 348])("never prices %i pages below the subscription", (pages) => {
    const rows = estimatorRows(pages);
    // The defect this replaces: a per-page quote with no plan in it, under the subscription.
    expect(rows.developerTotalUsd).toBeGreaterThanOrEqual(developer.priceUsd);
    expect(rows.developerTotalUsd).not.toBe(pages * STANDARD_PAGE_USD);
    // Inside the included pages nothing is added, and the extra row says so with a zero.
    expect(rows.extraPages).toBe(0);
    expect(rows.extraPagesUsd).toBe(0);
  });

  it("charges the published rate for the pages past the plan", () => {
    const pages = developer.includedPages + 100;
    const rows = estimatorRows(pages);
    expect(rows.extraPages).toBe(100);
    expect(rows.extraPagesUsd).toBeCloseTo(100 * STANDARD_PAGE_USD, 10);
    expect(rows.developerTotalUsd).toBeCloseTo(developer.priceUsd + 100 * STANDARD_PAGE_USD, 10);
    expect(rows.developerTotalUsd).toBeGreaterThan(developer.priceUsd);
  });

  it("caps the maximum at the complex-page ceiling and never below the standard total", () => {
    const rows = estimatorRows(developer.includedPages + 100);
    expect(rows.developerMaximumUsd).toBeCloseTo(developer.priceUsd + 100 * MAXIMUM_PAGE_USD, 10);
    expect(rows.developerMaximumUsd).toBeGreaterThan(rows.developerTotalUsd);
    // Failure path: inside the plan there is nothing to escalate, so the ceiling is the plan.
    expect(estimatorRows(1).developerMaximumUsd).toBe(developer.priceUsd);
  });

  it("refuses to read a page count as a bare unit-rate quote", () => {
    // 348 was the old default, and a bare unit-rate quote for it sat under the plan price.
    expect(estimatorRows(348).developerTotalUsd).not.toBeCloseTo(348 * STANDARD_PAGE_USD, 2);
  });
});
