import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import PricingPlanOverview, { pricingPlanId } from "../components/pricing-plan-overview";
import { BILLING_OFFERS } from "./billing-catalog";

const summaries = Object.values(BILLING_OFFERS).map(offer => ({
  name: offer.label, price: `$${offer.priceUsd} USD`, unit: "per month",
}));
const english = readFileSync(new URL("../components/pricing-page-client.tsx", import.meta.url), "utf8");
const korean = readFileSync(new URL("../app/ko/pricing/page.tsx", import.meta.url), "utf8");

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
    for (const [index, offer] of Object.values(BILLING_OFFERS).entries()) {
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

  it("keeps the gated evaluation wording and single-member notice before the overview", () => {
    expect(english).toContain('unit: plan.name === EVALUATION.name && !selfService ? "to explore the public World" : plan.unit');
    expectDisclosureBefore(english, "Developer and Team are currently single-member workspaces.", "<PricingPlanOverview");
    expectDisclosureBefore(english, 'gates.find(gate => gate.id === "customerData")?.reason', "<PricingPlanOverview");
    expect(english).toContain("plans={PLANS.map(plan => ({");
    expect(english).toContain('id={pricingPlanId(index)} tabIndex={-1}');
  });

  it("uses the same Korean card presentation in the overview and keeps plan warnings before actions", () => {
    expect(korean).toContain("<PricingPlanOverview plans={planSummaries} korean />");
    expect(korean).toContain("{ name: developer.label, price: `$${developer.priceUsd}`, unit: monthlyUnit }");
    expect(korean).toContain("{ name: team.label, price: `$${team.priceUsd}`, unit: monthlyUnit }");
    expect(korean).toContain("<h3>{publicSample.name}</h3>");
    expect(korean).toContain("<h3>{enterprise.name}</h3>");
    expectDisclosureBefore(korean, "현재 단일 사용자 워크스페이스입니다.", 'href="/ko/contact?plan=Team"');
    expectDisclosureBefore(korean, "자체 자료 컴파일은 승인된 시범 운영 범위에서만 진행합니다.", 'href="/ko/contact?plan=Developer"');
    for (const index of [0, 1, 2, 3]) expect(korean).toContain(`id={pricingPlanId(${index})} tabIndex={-1}`);
  });
});
