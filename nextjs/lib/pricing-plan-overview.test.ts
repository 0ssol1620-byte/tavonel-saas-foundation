import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import PricingPlanOverview, { pricingPlanId } from "../components/pricing-plan-overview";
import { BILLING_OFFERS } from "./billing-catalog";

// Catalog v2: the page's plans are the current offers. A retired offer is never rendered on a public page.
const current = Object.values(BILLING_OFFERS).filter(offer => offer.status !== "retired");
const summaries = current.map(offer => ({
  name: offer.label, price: `$${offer.priceUsd} USD`, unit: "per month",
}));
const english = readFileSync(new URL("../components/pricing-page-client.tsx", import.meta.url), "utf8");

function expectDisclosureBefore(source: string, disclosure: string, destination: string) {
  const disclosureIndex = source.indexOf(disclosure);
  const destinationIndex = source.indexOf(destination);
  expect(disclosureIndex, `Missing disclosure: ${disclosure}`).toBeGreaterThanOrEqual(0);
  expect(destinationIndex, `Missing destination: ${destination}`).toBeGreaterThanOrEqual(0);
  expect(disclosureIndex).toBeLessThan(destinationIndex);
}

describe("pricing plan overview", () => {
  it("rejects missing disclosures, missing destinations and reversed order", () => {
    expect(() => expectDisclosureBefore("action", "warning", "action")).toThrow();
    expect(() => expectDisclosureBefore("warning", "warning", "action")).toThrow();
    expect(() => expectDisclosureBefore("action warning", "warning", "action")).toThrow();
  });

  it("renders catalog prices as navigation to the corresponding detail sections", () => {
    const html = renderToStaticMarkup(createElement(PricingPlanOverview, { plans: summaries }));
    expect(html).toContain('aria-label="Compare plans and jump to details"');
    expect(current.map(offer => offer.label)).toEqual(["Personal", "Developer", "Team", "Business"]);
    for (const [index, offer] of current.entries()) {
      expect(html).toContain(`href="#${pricingPlanId(index)}"`);
      expect(html).toContain(`${offer.label}, $${offer.priceUsd} USD, per month — View plan details`);
      expect(html).toContain(`>${offer.label}</span>`);
      expect(html).toContain(`>$${offer.priceUsd} USD</span>`);
    }
    expect(html).not.toContain("checkout");
    expect(html).not.toContain("onClick");
  });

  it("keeps Korean navigation labels and the supplied price/period unchanged", () => {
    const plans = summaries.map(plan => ({ ...plan, price: plan.price.replace(" USD", ""), unit: "/월, USD" }));
    const html = renderToStaticMarkup(createElement(PricingPlanOverview, { plans, korean: true }));
    expect(html).toContain('aria-label="요금제 비교 및 상세 보기"');
    for (const [index, plan] of plans.entries()) {
      expect(html).toContain(`${plan.name}, ${plan.price}, ${plan.unit} — 요금제 상세 보기`);
      expect(html).toContain(`href="#${pricingPlanId(index)}"`);
    }
    expect(html).not.toContain("View plan details");
  });

  it("keeps the gated evaluation wording before the overview and ships no unapproved plan-scope wording", () => {
    expect(english).toContain('unit: plan.kind === "evaluation" && !selfService ? "to explore the public World" : plan.unit');
    // SEC-2 / FE-B2 (review 2): plan-scope wording is pricing wording and is founder-only. main's
    // card line stays; the proposed sentence is listed for founder approval, not shipped.
    expect(english).not.toContain("single-member workspaces. The Team name does not include");
    // The plan cards name what each plan delivers and carry no membership line.
    expect(english).not.toContain("<b>Single-member workspace</b>");
    expectDisclosureBefore(english, 'gates.find(gate => gate.id === "customerData")?.reason', "<PricingPlanOverview");
    expect(english).toContain("plans={PLANS.map(plan => ({");
    expect(english).toContain('id={pricingPlanId(index)} tabIndex={-1}');
  });

  it("has no Korean pricing page: /ko/pricing redirects with a 308", () => {
    expect(existsSync(new URL("../app/ko", import.meta.url))).toBe(false);
    const config = readFileSync(new URL("../next.config.mjs", import.meta.url), "utf8");
    expect(config).toContain('{ source: "/ko/:path*", destination: "/:path*", permanent: true }');
  });
});
