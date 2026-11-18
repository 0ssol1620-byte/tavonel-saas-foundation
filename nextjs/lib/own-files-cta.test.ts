import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCESS_CTA, SELF_SERVE_CTA, START_FREE_LABEL, TRIAL_ALLOWANCE } from "@/lib/site-navigation";
import { BILLING_OFFERS } from "@/lib/billing-catalog";
import { ownFilesCopy } from "@/components/own-files-cta";

const PERSONAL_PRICE = `${BILLING_OFFERS.personal.label} is $${BILLING_OFFERS.personal.priceUsd}/month`;

describe("the 'Run this on your own files' block", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("offers the free start with the trial row's allowance and the catalog price when commerce is live and Personal is sold", () => {
    const copy = ownFilesCopy(SELF_SERVE_CTA, "purchasable");
    expect(copy.primary).toEqual({ href: "/login", label: START_FREE_LABEL });
    expect(copy.secondary).toEqual({ href: "/contact", label: "Talk to us" });
    expect(copy.note).toContain(`${TRIAL_ALLOWANCE.days} days`);
    expect(copy.note).toContain(`${TRIAL_ALLOWANCE.files} files`);
    expect(copy.note).toContain(`${TRIAL_ALLOWANCE.pages} standard pages`);
    expect(copy.note).toContain(PERSONAL_PRICE);
    expect(copy.note).not.toMatch(/;/);
    // public-layout-balance flags a narrow paragraph of 28 words or more.
    expect(copy.note.split(/\s+/).length).toBeLessThan(28);
  });

  // WO-REL-4 (release review non-blocker 8): a price is stated only for a plan that can be bought.
  for (const availability of ["request_access", "retired"] as const) {
    it(`states no Personal price while Personal is ${availability}`, () => {
      const copy = ownFilesCopy(SELF_SERVE_CTA, availability);
      expect(copy.note).toContain(`${TRIAL_ALLOWANCE.days} days`);
      expect(copy.note).not.toContain(BILLING_OFFERS.personal.label);
      expect(copy.note).not.toContain(`$${BILLING_OFFERS.personal.priceUsd}`);
    });
  }

  /*
    The real path: OwnFilesCta reads the deployment's action and Personal's availability when it renders. The live
    commerce env is the one revenue-paths.test.ts uses for build 2 (page meter on for every workspace, which the sale
    requires since WO-REL-5); only the two V22 prices differ between the renders.
  */
  it("states the Personal price on a live deployment only once the two V22 prices are set", async () => {
    const render = async (prices: boolean) => {
      vi.unstubAllEnvs();
      vi.resetModules();
      for (const [name, value] of Object.entries({
        VERCEL_ENV: "production", COMMERCIAL_MODE: "live", TAVONEL_BILLING_LAUNCH_APPROVED: "true", ACCESS_MODE: "self_service",
        PADDLE_SANDBOX: "false", TAVONEL_PAGE_METER_COHORT: "*", NEXT_PUBLIC_SUPABASE_URL: "https://own-files.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "own-files-anon",
        PADDLE_PRICE_PERSONAL: prices ? `pri_${"c".repeat(26)}` : "",
        PADDLE_PRICE_DEVELOPER: prices ? `pri_${"d".repeat(26)}` : "",
      })) vi.stubEnv(name, value);
      const [{ OwnFilesCta }, { planAvailability }] = await Promise.all([import("@/components/own-files-cta"), import("@/lib/billing-catalog")]);
      return { html: renderToStaticMarkup(createElement(OwnFilesCta)), personal: planAvailability("personal") };
    };
    const closed = await render(false);
    expect(closed.personal).toBe("request_access");
    expect(closed.html, "the live deployment offers the free start").toContain(START_FREE_LABEL);
    expect(closed.html).not.toContain(`$${BILLING_OFFERS.personal.priceUsd}/month`);
    const open = await render(true);
    expect(open.personal).toBe("purchasable");
    expect(open.html).toContain(START_FREE_LABEL);
    expect(open.html).toContain(PERSONAL_PRICE);
  });

  it("promises nothing free and does not link /contact twice when the deployment cannot sell", () => {
    const copy = ownFilesCopy(ACCESS_CTA, "purchasable");
    expect(copy.primary).toEqual(ACCESS_CTA);
    expect(copy.secondary).toBeNull();
    expect(copy.note).not.toMatch(/free|\$|card/i);
  });
});
