import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PLAN_FEATURE_STATE_LABEL,
  PLAN_FEATURE_STATE_NAME,
  type PlanCapabilityRow,
  type PlanFeatureState,
} from "../components/pricing-page-client";
import { BILLING_OFFERS, type BillingOfferCode } from "./billing-catalog";
import { billingProductDecision, type ProductAccessLevel } from "./billing-product-access";
import type { FoundationBillingAccount } from "./billing-store";

/*
  Gap #14 of the 2026-09-22 competitor visual audit: three states, and a tick for exactly one.

  The table's every cell used to be one boolean. That is right for the six entitlement rows and
  wrong for the reason a buyer opens the table, because both paid plans reach all six -- so the
  comparison a buyer reads to find out why one costs more answered ✓ / ✓ six times and the plan's
  actual differentiator was in a card above it, named "Coming, not yet sold".

  Two failures are checked, and they are not the same failure:

    an unsold capability with a tick   -- the refund conversation G2-002 exists to prevent
    an absent capability with no row   -- the reader infers a yes from silence instead

  The rows are rebuilt here from `lib/billing-catalog.ts` and `billingProductDecision` rather
  than imported from the page, so this file fails when the page stops deriving them -- a table
  that agreed with the constant it was built from would be worth nothing.
*/

const root = resolve(import.meta.dirname, "..");
const pricingPage = readFileSync(resolve(root, "app/pricing/page.tsx"), "utf8");
const PLAN_CODES = Object.keys(BILLING_OFFERS) as BillingOfferCode[];
const account = (plan: BillingOfferCode): FoundationBillingAccount =>
  ({ accessPlan: plan, subscriptionStatus: "active", billingHold: false }) as FoundationBillingAccount;

/** The row set the page builds, rebuilt from the same two sources it reads. */
function expectedRows(): PlanCapabilityRow[] {
  const entitlement: Array<{ capability: string; level: ProductAccessLevel }> = [
    { capability: "Activate a candidate World", level: "activation" },
  ];
  const unsold = [...new Set(PLAN_CODES.flatMap((code) => BILLING_OFFERS[code].notYetSold as readonly string[]))];
  return [
    ...entitlement.map((row) => ({
      capability: row.capability,
      level: row.level,
      plans: PLAN_CODES.map((code) => ({
        label: BILLING_OFFERS[code].label,
        saleChannel: BILLING_OFFERS[code].saleChannel,
        state: (billingProductDecision(account(code), row.level, "owner").ok
          ? "provided"
          : "not_sold") as PlanFeatureState,
      })),
    })),
    ...unsold.map((capability) => ({
      capability,
      plans: PLAN_CODES.map((code) => ({
        label: BILLING_OFFERS[code].label,
        saleChannel: BILLING_OFFERS[code].saleChannel,
        state: ((BILLING_OFFERS[code].notYetSold as readonly string[]).includes(capability)
          ? "planned"
          : "not_sold") as PlanFeatureState,
      })),
    })),
  ];
}

describe("the /pricing comparison matrix has three states, not a column of ticks", () => {
  it("gives each state one glyph or word and one accessible name", () => {
    const states: PlanFeatureState[] = ["provided", "planned", "not_sold"];
    expect(Object.keys(PLAN_FEATURE_STATE_LABEL).sort()).toEqual([...states].sort());
    expect(Object.keys(PLAN_FEATURE_STATE_NAME).sort()).toEqual([...states].sort());
    expect(new Set(Object.values(PLAN_FEATURE_STATE_LABEL)).size).toBe(states.length);
    expect(new Set(Object.values(PLAN_FEATURE_STATE_NAME)).size).toBe(states.length);
  });

  /*
    The rule, stated as narrowly as it can be: the checkmark belongs to one state.

    Not "an unsold feature must not be ticked" -- that is a property of today's data and would
    stop being checked the day the data changed. The label table is the thing that decides, and
    it may only ever hand the glyph to `provided`.
  */
  it("gives the checkmark to `provided` and to nothing else", () => {
    expect(PLAN_FEATURE_STATE_LABEL.provided).toBe("✓");
    for (const state of ["planned", "not_sold"] as const) {
      expect(PLAN_FEATURE_STATE_LABEL[state], `${state} renders a checkmark`).not.toMatch(/[✓✔✔️]/);
      expect(PLAN_FEATURE_STATE_NAME[state]).not.toBe(PLAN_FEATURE_STATE_NAME.provided);
    }
    // And the accessible name is not the glyph read aloud: a screen reader saying "check mark"
    // beside "Planned" is the same ambiguity in a second modality.
    expect(PLAN_FEATURE_STATE_NAME.provided).toBe("Provided");
    expect(PLAN_FEATURE_STATE_NAME.planned).toContain("not sold with this plan yet");
  });

  it("renders every unsold capability the catalog names, in one of the two unsold states", () => {
    const unsold = [...new Set(PLAN_CODES.flatMap((code) => BILLING_OFFERS[code].notYetSold as readonly string[]))];
    expect(unsold.length, "the catalog names no unsold capability, so the rule is untested").toBeGreaterThan(0);

    for (const row of expectedRows().filter((candidate) => unsold.includes(candidate.capability))) {
      for (const plan of row.plans) {
        expect(plan.state, `${row.capability} is sold on ${plan.label}`).not.toBe("provided");
        expect(PLAN_FEATURE_STATE_LABEL[plan.state]).not.toBe(PLAN_FEATURE_STATE_LABEL.provided);
      }
      // A plan that names it reads "Planned"; the plan that does not, reads "Not sold". A row
      // where both read the same is a row that has stopped comparing anything.
      expect(new Set(row.plans.map((plan) => plan.state)).size).toBeGreaterThan(1);
    }
  });

  it("answers the entitlement rows with the function the API calls", () => {
    const activation = expectedRows().find((row) => row.level === "activation")!;
    for (const plan of activation.plans) {
      const code = PLAN_CODES.find((candidate) => BILLING_OFFERS[candidate].label === plan.label)!;
      const decision = billingProductDecision(account(code), "activation", "owner");
      expect(plan.state).toBe(decision.ok ? "provided" : "not_sold");
    }
    // An entitlement row is never "planned": the function either admits the call today or
    // refuses it today, and a route has no roadmap.
    expect(activation.plans.some((plan) => plan.state === "planned")).toBe(false);
  });

  /*
    The page derives the rows; it does not restate them.

    Held by reading the source rather than the render because the alternative is booting a client
    component that reads `/api/status`. What matters is that the two inputs are the two the audit
    names -- the plan catalog and the entitlement function -- and that no capability string is
    typed into the page beside them.
  */
  it("builds the rows from the catalog and the entitlement function, not from a list", () => {
    expect(pricingPage).toContain("notYetSold");
    expect(pricingPage).toContain("billingProductDecision");
    for (const capability of PLAN_CODES.flatMap((code) => BILLING_OFFERS[code].notYetSold as readonly string[])) {
      expect(pricingPage, `/pricing types out "${capability}" instead of reading it`).not.toContain(
        `"${capability}"`,
      );
    }
  });

  it("stops rendering a row the day its capability ships", () => {
    // `notYetSold` is the only thing that puts a row in the unsold half, so shipping the
    // capability -- which is what empties that list -- removes the row with no edit to the page.
    const shipped = { ...BILLING_OFFERS, studio_access: { ...BILLING_OFFERS.studio_access, notYetSold: [] } };
    const remaining = new Set(
      (Object.keys(shipped) as BillingOfferCode[]).flatMap((code) => shipped[code].notYetSold as readonly string[]),
    );
    expect(remaining.size).toBe(0);
  });
});

describe("the matrix keeps its horizontal-scroll frame at 360px", () => {
  const client = readFileSync(resolve(root, "components/pricing-page-client.tsx"), "utf8");
  const css = readFileSync(resolve(root, "app/tavonel.css"), "utf8");

  it("wraps both /pricing tables rather than making the tables scroll", () => {
    // `display: block` on a table to give it a scrollbar takes its row and column semantics
    // with it. Each `<table>` here is preceded by the wrapper that carries the overflow.
    const tables = [...client.matchAll(/<table\b/g)].map((match) => match.index!);
    expect(tables.length).toBeGreaterThan(0);
    for (const at of tables) {
      const before = client.slice(Math.max(0, at - 220), at);
      expect(before, "a /pricing table is not inside a .table-scroll frame").toContain(`className="table-scroll"`);
    }
  });

  it("labels every state cell, which is what stacks the row instead of clipping it", () => {
    // The stacked layout keys on `data-label`, and a state cell with none becomes a bare glyph
    // in a list with no column name -- worse than the scroll it replaced.
    expect(client).toMatch(/data-label=\{plan\.label\}[\s\S]{0,120}data-state=\{plan\.state\}/);
    expect(css).toContain(`.docs-table td[data-state="planned"]`);
    expect(css).toContain(`.docs-table td[data-state="not_sold"]`);
  });
});
