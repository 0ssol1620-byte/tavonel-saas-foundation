import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BILLING_OFFERS } from "./billing-catalog";
import { OFFER_CODES, REVENUE_PATHS, revenuePathForOffer } from "./revenue-paths";

describe("revenue paths", () => {
  it("has 15 unique families", () => {
    expect(REVENUE_PATHS).toHaveLength(15);
    expect(new Set(REVENUE_PATHS.map((p) => p.family)).size).toBe(15);
  });

  it("maps every catalog offer to exactly one path", () => {
    for (const code of OFFER_CODES) expect(revenuePathForOffer(code).state).not.toBe("not_sold");
  });

  it("fails on an unmapped offer (failure path)", () => {
    expect(() => revenuePathForOffer("new_offer" as never)).toThrow(/0 revenue paths/);
    expect(() => revenuePathForOffer("observer_access", [])).toThrow();
  });

  it("every self-serve path names a ledger path; not_sold paths hold none", () => {
    for (const p of REVENUE_PATHS) {
      if (p.state === "sold_self_serve") expect(p.ledgerPath).not.toBeNull();
      if (p.state === "not_sold") {
        expect(p.ledgerPath).toBeNull();
        expect(p.offerCodes).toHaveLength(0);
      }
    }
  });

  it("an offer's ledger path follows its catalog kind", () => {
    for (const code of OFFER_CODES)
      expect(revenuePathForOffer(code).ledgerPath, code).toBe(BILLING_OFFERS[code].kind === "subscription" ? "allowance" : "purchase");
  });

  it("pricing copy never names a not_sold family", () => {
    const copy = readFileSync(new URL("../components/pricing-page-client.tsx", import.meta.url), "utf8").toLowerCase();
    for (const p of REVENUE_PATHS.filter((x) => x.state === "not_sold"))
      for (const t of p.terms) expect(copy, `${p.family}: ${t}`).not.toContain(t.toLowerCase());
  });
});
