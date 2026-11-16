import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BILLING_OFFERS, planAvailability, readConfiguredBillingOffers } from "./billing-catalog";
import { OFFER_CODES, REVENUE_PATHS, revenuePathForOffer } from "./revenue-paths";

describe("revenue paths", () => {
  it("has 15 unique families", () => {
    expect(REVENUE_PATHS).toHaveLength(15);
    expect(new Set(REVENUE_PATHS.map((p) => p.family)).size).toBe(15);
  });

  it("maps every catalog offer to exactly one path, and every code is mapped exactly once", () => {
    for (const code of OFFER_CODES) expect(() => revenuePathForOffer(code), code).not.toThrow();
    const mapped = REVENUE_PATHS.flatMap((p) => p.offerCodes);
    expect([...mapped].sort()).toEqual([...OFFER_CODES].sort());
  });

  it("maps the v2 codes to not_sold paths while the sale is closed, and the retired codes to the allowance ledger", () => {
    expect(OFFER_CODES.length).toBe(6);
    const everyEnv = Object.fromEntries(OFFER_CODES.map((c, i) => [BILLING_OFFERS[c].priceEnv, `pri_${String(i).repeat(26)}`]));
    const configured = readConfiguredBillingOffers(everyEnv);
    for (const code of OFFER_CODES) {
      // No offer is purchasable now, so no path may claim to be sold self-serve.
      expect(planAvailability(code, configured), code).not.toBe("purchasable");
      expect(revenuePathForOffer(code).state, code).not.toBe("sold_self_serve");
    }
    for (const code of ["observer_access", "studio_access"] as const) {
      expect(revenuePathForOffer(code).ledgerPath, code).toBe("allowance");
    }
    expect(revenuePathForOffer("developer").family).toBe("DEV");
    expect(revenuePathForOffer("personal").family).toBe("CORE_PERSONAL_TEAM_BUSINESS");
  });

  it("fails on an unmapped offer (failure path)", () => {
    expect(() => revenuePathForOffer("new_offer" as never)).toThrow(/0 revenue paths/);
    expect(() => revenuePathForOffer("observer_access", [])).toThrow();
  });

  it("every self-serve path names a ledger path; a not_sold path holds one only for the offers it maps", () => {
    for (const p of REVENUE_PATHS) {
      if (p.state === "sold_self_serve") expect(p.ledgerPath).not.toBeNull();
      // A not_sold family holds a ledger path only for offers whose renewals settle through it.
      if (p.state === "not_sold") expect(p.ledgerPath === null, p.family).toBe(p.offerCodes.length === 0);
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
