import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BILLING_OFFERS, type BillingOfferCode } from "./billing-catalog";
import { billingProductDecision } from "./billing-product-access";
import type { FoundationBillingAccount } from "./billing-store";

/**
 * A plan may only claim what a route actually grants.
 *
 * Every failure this file guards against was live at once. The pricing page sold Developer "500
 * standard compile pages" and "API + MCP" while `/api/collections/compile` and every developer
 * key route demanded a Team subscription — so the entry plan could upload documents, pay to
 * have them read, and then reach neither the compiler nor a credential. It sold Team "Up to 5
 * seats" against a product with no invitation, no roles and no seat accounting, and Enterprise
 * "SSO / SCIM when qualified", which is a feature card for something that does not exist.
 *
 * The bullets now come from the billing catalog, and these tests check them against the code
 * that enforces them. A new bullet without a route behind it fails here.
 */

const root = new URL("../", import.meta.url);
const read = (relative: string) => readFileSync(new URL(relative, root), "utf8");

function account(plan: BillingOfferCode): FoundationBillingAccount {
  return {
    accessPlan: plan,
    subscriptionStatus: "active",
    billingHold: false,
  } as FoundationBillingAccount;
}

/** Routes whose capability a paid plan's bullets promise, with the level each demands. */
const PROMISED_ROUTES = [
  ["app/api/collections/compile/route.ts", "compile your own worlds"],
  ["app/api/uploads/capability/route.ts", "upload documents"],
  ["app/api/developer/keys/route.ts", "mint an API key"],
  ["app/api/developer/keys/[id]/route.ts", "revoke an API key"],
  ["app/api/v1/developer/keys/[id]/rotate/route.ts", "rotate an API key"],
] as const;

describe("plan entitlement", () => {
  it("admits the Developer plan to every capability its card promises", () => {
    expect(billingProductDecision(account("observer_access"), "observer")).toEqual({ ok: true });
  });

  it("admits the Team plan everywhere the Developer plan is admitted", () => {
    expect(billingProductDecision(account("studio_access"), "observer")).toEqual({ ok: true });
    expect(billingProductDecision(account("studio_access"), "studio")).toEqual({ ok: true });
  });

  it("keeps Team-only capabilities closed to the Developer plan", () => {
    const decision = billingProductDecision(account("observer_access"), "studio");
    expect(decision.ok).toBe(false);
    expect(decision.ok === false && decision.code).toBe("STUDIO_SUBSCRIPTION_REQUIRED");
  });

  it.each(PROMISED_ROUTES)("%s is reachable by the entry plan, so it can %s", (route) => {
    const source = read(route);
    expect(source, `${route} must not require a Team subscription`)
      .not.toMatch(/(?:authorizeFoundationRequest|requireFoundationSession)\([^)]*"studio"/);
  });

  /*
    Unenforced claims, named so they cannot come back by habit.

    Seats, SSO and SCIM are the three that were on the page without anything behind them. Each
    belongs on a card the day the mechanism ships, and not before.
  */
  it("makes no plan claim the product cannot enforce", () => {
    const bullets = Object.values(BILLING_OFFERS)
      .flatMap((offer) => offer.features as readonly string[])
      .join(" ")
      .toLowerCase();
    for (const unenforced of ["seat", "sso", "scim", "when qualified", "coming soon"]) {
      expect(bullets, `no plan may advertise "${unenforced}" yet`).not.toContain(unenforced);
    }
  });

  it("states included pages on the card and in the ledger as one number", () => {
    for (const offer of Object.values(BILLING_OFFERS)) {
      const claim = offer.features.find((feature) => feature.includes("verified standard pages"));
      expect(claim, `${offer.label} must state its included pages`).toBeDefined();
      expect(claim).toContain(offer.includedPages.toLocaleString("en-US"));
    }
  });

  /*
    Team is contact-sales until the membership flow exists, and that must not depend on
    billing being in pilot. Pilot routes every plan to /contact because checkout is closed
    for everyone; the day live checkout opens, that cover disappears and a plan selling
    invitations, roles and seat accounting -- none of which exist in any migration or route
    -- would start taking cards. The gate therefore lives on the offer, not on the mode.
  */
  it("keeps a plan whose product is unfinished off self-serve checkout", () => {
    expect(BILLING_OFFERS.studio_access.saleChannel).toBe("contact");
    expect(BILLING_OFFERS.observer_access.saleChannel).toBe("self_serve");
    const pricing = readFileSync(new URL("../app/pricing/page.tsx", import.meta.url), "utf8");
    expect(pricing, "the pricing card must derive checkout from saleChannel")
      .toContain('offerCode: offer.saleChannel === "self_serve" ? offerCode : null');
  });

  it("does not sell a plan the pricing page invents on its own", () => {
    const pricing = read("app/pricing/page.tsx");
    expect(pricing, "plans come from the billing catalog").toContain("BILLING_OFFERS");
    expect(pricing, "no second hand-written plan list").not.toMatch(/offerCode: "observer_access"/);
    expect(pricing, "no second hand-written plan list").not.toMatch(/offerCode: "studio_access"/);
  });
});
