import { createElement, type FunctionComponent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BILLING_OFFERS, deliveredForSale, planAvailability, readConfiguredBillingOffers } from "./billing-catalog";
import { OFFER_CODES, REVENUE_PATHS, revenuePathForOffer, type RevenuePath } from "./revenue-paths";

// /pricing is rendered below; its header reads the route it is on.
vi.mock("next/navigation", () => ({ usePathname: () => "/pricing" }));

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

  it("maps every offer the release can sell to a sold path, and the retired codes to the allowance ledger", () => {
    expect(OFFER_CODES.length).toBe(6);
    const everyEnv = Object.fromEntries(OFFER_CODES.map((c, i) => [BILLING_OFFERS[c].priceEnv, `pri_${String(i).repeat(26)}`]));
    const configured = readConfiguredBillingOffers(everyEnv);
    // WO-REL-1: with every price set (and, WO-REL-5, the page meter on for every workspace), Personal and Developer are
    // purchasable, so their paths are sold self-serve.
    const metered = deliveredForSale({ TAVONEL_PAGE_METER_COHORT: "*" });
    expect(OFFER_CODES.filter((code) => planAvailability(code, configured, metered) === "purchasable")).toEqual(["personal", "developer"]);
    for (const code of OFFER_CODES) {
      if (planAvailability(code, configured, metered) === "purchasable") expect(revenuePathForOffer(code).state, code).toBe("sold_self_serve");
    }
    // With no price set nothing is purchasable, whatever the table says (the closed sale of build 1).
    for (const code of OFFER_CODES) expect(planAvailability(code, readConfiguredBillingOffers({})), code).not.toBe("purchasable");
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

  /*
    WO-CAT-2 L2: the rule made exact, on the RENDERED /pricing page (header, footer, JSON-LD and all), not on a source grep.
    It was written when the page had no allowance lines. A term of a not_sold family may appear only
      (a) in the allowance line of a plan card whose action is Request access, and
      (b) in a row of the overage-rate table whose action is Request access.
    Never on a card or row that carries a Buy action, and never in any other sentence. A plan cannot open for sale while
    its allowance names a not_sold meter family: the catalog's own test refuses that (billing-catalog.test.ts).
  */
  describe("pricing copy names a not_sold family only where its action is Request access", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    /**
     * Today's page, or (saleOpen) the same release with its two V22 prices set: build 2 of the release plan. WO-REL-5:
     * build 2 also sets TAVONEL_PAGE_METER_COHORT to `*`; `cohort` replaces that value (undefined = unset).
     */
    async function pricingHtml(seam?: { saleOpen: boolean; cohort?: string | undefined }) {
      vi.resetModules();
      if (seam?.saleOpen) {
        vi.stubEnv("PADDLE_PRICE_PERSONAL", `pri_${"c".repeat(26)}`);
        vi.stubEnv("PADDLE_PRICE_DEVELOPER", `pri_${"d".repeat(26)}`);
        vi.stubEnv("TAVONEL_PAGE_METER_COHORT", "cohort" in seam ? seam.cohort : "*");
        // A Buy action also needs the deployment's purchase open: the launch flags `nextjs/vercel.json` sets in production.
        for (const [name, value] of Object.entries({
          VERCEL_ENV: "production", COMMERCIAL_MODE: "live", TAVONEL_BILLING_LAUNCH_APPROVED: "true", ACCESS_MODE: "self_service",
          PADDLE_SANDBOX: "false", NEXT_PUBLIC_SUPABASE_URL: "https://revenue-paths.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "revenue-paths-anon",
        })) vi.stubEnv(name, value);
      }
      const { default: PricingPage } = await import("../app/pricing/page");
      return renderToStaticMarkup(createElement(PricingPage as FunctionComponent<Record<string, unknown>>));
    }

    /** [start, end) of the element that opens at `open`, matched by depth. */
    function elementAt(html: string, open: number, tag: string): [number, number] {
      const pattern = new RegExp(`<${tag}\\b|</${tag}>`, "g");
      pattern.lastIndex = open;
      let depth = 0;
      for (let match = pattern.exec(html); match; match = pattern.exec(html)) {
        depth += match[0].startsWith("</") ? -1 : 1;
        if (depth === 0) return [open, match.index + match[0].length];
      }
      throw new Error(`unclosed <${tag}> at ${open}`);
    }
    const elements = (html: string, opening: RegExp, tag: string, within: [number, number] = [0, html.length]) =>
      [...html.slice(within[0], within[1]).matchAll(opening)].map((match) => elementAt(html, within[0] + match.index!, tag));
    const text = (fragment: string) => fragment.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const requestsOnly = (fragment: string) => /\bRequest\b/.test(text(fragment)) && !/\bBuy\b/.test(text(fragment));

    /** The two places a not_sold term may stand, as ranges of the markup. */
    function allowedRanges(html: string) {
      const ranges: Array<[number, number]> = [];
      for (const card of elements(html, /<article\b[^>]*class="plan\b/g, "article")) {
        if (requestsOnly(html.slice(...card))) ranges.push(...elements(html, /<p\b[^>]*class="[^"]*\bplan-included\b/g, "p", card));
      }
      const title = html.indexOf('id="pricing-overage-title"');
      expect(title, "the overage table is rendered").toBeGreaterThanOrEqual(0);
      const table = elementAt(html, html.indexOf("<table", title), "table");
      for (const row of elements(html, /<tr\b/g, "tr", table)) {
        if (requestsOnly(html.slice(...row))) ranges.push(row);
      }
      return ranges;
    }

    /**
     * Every occurrence of a not_sold term outside those places, with the text around it. A term starts a word ("GB" is
     * not the "gb" of "rgba"); it may end inside one, so "Skill run" still finds "Skill runs".
     */
    function misplacedTerms(html: string, paths: readonly RevenuePath[] = REVENUE_PATHS) {
      const ranges = allowedRanges(html);
      return paths.filter((path) => path.state === "not_sold").flatMap((path) => path.terms.flatMap((term) =>
        [...html.matchAll(new RegExp(`(?<![A-Za-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "gi"))]
          .filter((match) => !ranges.some(([start, end]) => match.index! >= start && match.index! < end))
          .map((match) => `${path.family} "${term}": ${text(html.slice(Math.max(0, match.index! - 90), match.index! + 60)).trim()}`)));
    }

    it("appears only in a Request access allowance line or overage row on today's page", async () => {
      const html = await pricingHtml();
      // The rule reads what it guards: four request-access allowance lines and four overage rows, and they name KQU.
      expect(allowedRanges(html)).toHaveLength(8);
      expect(text(html)).toMatch(/\bKQU\b/);
      expect(misplacedTerms(html)).toEqual([]);
    }, 180_000);

    it("holds with the sale open: Personal and Developer carry Buy, and the meters on their line are sold", async () => {
      const html = await pricingHtml({ saleOpen: true });
      expect(text(html)).toContain("Buy Personal");
      expect(text(html)).toContain("Buy Developer");
      // Team and Business keep Request access, and so does every overage row: 2 + 4 places.
      expect(allowedRanges(html)).toHaveLength(6);
      expect(misplacedTerms(html)).toEqual([]);
    }, 180_000);

    it("WO-REL-5: with both prices set but the page meter on for a canary list, unset or malformed, every plan is Request access", async () => {
      for (const cohort of [undefined, "pilot-canary01", " *"]) {
        const html = await pricingHtml({ saleOpen: true, cohort });
        expect(text(html), JSON.stringify(cohort)).not.toMatch(/\bBuy\b/);
        expect(allowedRanges(html), JSON.stringify(cohort)).toHaveLength(8);
        expect(html, JSON.stringify(cohort)).not.toContain("pilot-canary");
        vi.unstubAllEnvs();
      }
    }, 540_000);

    /*
      WO-REL-1 flipped KQU and storage to sold (their meters are delivered), so the failure paths below run the guard
      against the table as it stood before the release: it must still catch a not_sold meter's term where it may not be.
    */
    const NOT_SOLD_METERS: RevenuePath[] = REVENUE_PATHS.map((path) =>
      path.meter === "kqu" ? { ...path, state: "not_sold", terms: ["KQU"] }
        : path.meter === "storageGb" ? { ...path, state: "not_sold", terms: ["GB"] } : path);

    it("is caught on a card that carries a Buy action (failure path: the sale open while KQU is not sold)", async () => {
      const html = await pricingHtml({ saleOpen: true });
      expect(text(html)).toContain("Buy Personal");
      const misplaced = misplacedTerms(html, NOT_SOLD_METERS);
      expect(misplaced.some((line) => line.startsWith('CONTEXT_KQU "KQU"') && line.includes("Each month: 500 PCU")), misplaced.join("\n")).toBe(true);
    }, 180_000);

    it("is caught in a sentence outside the two places (failure path)", () => {
      const html = '<p>A KQU is one bounded knowledge retrieval request.</p><h3 id="pricing-overage-title">x</h3><table><tr><td>KQU</td><td>Request access</td></tr></table>';
      expect(misplacedTerms(html, NOT_SOLD_METERS)).toHaveLength(1);
      expect(misplacedTerms(html, NOT_SOLD_METERS)[0]).toContain("A KQU is one bounded knowledge retrieval request.");
    });

    it("is caught on a storage quantity in GB outside the two places (failure path, WO-CAT-2 N5)", () => {
      const overage = '<h3 id="pricing-overage-title">x</h3><table><tr><td>Storage</td><td>$0.20 / GB-month</td><td>Request access</td></tr></table>';
      const misplaced = misplacedTerms(`<table><tr><th>Storage included, GB</th><td>50</td></tr></table>${overage}`, NOT_SOLD_METERS);
      expect(misplaced).toHaveLength(1);
      expect(misplaced[0]).toMatch(/^STORAGE_RETENTION "GB": Storage included, GB 50 /);
      // The rate in its Request access row stays allowed, and "rgba" is not a GB.
      expect(misplacedTerms(`<p style="color: rgba(0,0,0,1)">x</p>${overage}`, NOT_SOLD_METERS)).toEqual([]);
    });
  });
});
