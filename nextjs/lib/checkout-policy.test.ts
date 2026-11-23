import { describe, expect, it } from "vitest";
import { BILLING_OFFERS, type BillingOfferCode } from "./billing-catalog";
import { LedgerOracle, type EventOp, type IntentOp, type Op } from "./billing-ledger-replay";
import { decideCheckoutPolicy, decideOfferCheckoutPolicy, decideSubscriptionChange, heldOffer, projectionAdmitsReplacement } from "./checkout-policy";
import type { CommercialState } from "./commercial-state";

const state = (overrides: Partial<CommercialState>): CommercialState => ({
  mode: "live",
  provider: "production",
  checkoutEnabled: true,
  liveChargesEnabled: true,
  legalTermsVersion: "live-2026-08-30",
  ...overrides,
});

describe("checkout deployment policy", () => {
  it("refuses production money while the purchased workflow is closed", () => {
    expect(decideCheckoutPolicy(state({}), false)).toEqual({
      allowed: false,
      code: "BILLING_LAUNCH_PENDING",
    });
  });

  it("permits production only when commerce and the workflow are both open", () => {
    expect(decideCheckoutPolicy(state({}), true)).toEqual({ allowed: true, mode: "production" });
    expect(decideCheckoutPolicy(state({ checkoutEnabled: false }), true).allowed).toBe(false);
  });

  it("keeps sandbox qualification available without claiming live purchasing", () => {
    expect(decideCheckoutPolicy(state({
      mode: "pilot",
      provider: "sandbox",
      liveChargesEnabled: false,
      legalTermsVersion: "pilot-2026-08-30",
    }), false)).toEqual({ allowed: true, mode: "sandbox_qualification" });
  });

  it("opens an offer only when it is purchasable and self-serve", () => {
    const personal = { code: "personal" as const, saleChannel: BILLING_OFFERS.personal.saleChannel };
    expect(decideOfferCheckoutPolicy(personal, "purchasable")).toEqual({ allowed: true });
  });

  it("refuses every offer that is not purchasable, before any intent exists (failure path)", () => {
    for (const code of Object.keys(BILLING_OFFERS) as BillingOfferCode[]) {
      const offer = { code, saleChannel: BILLING_OFFERS[code].saleChannel };
      for (const availability of ["request_access", "retired"] as const) {
        expect(decideOfferCheckoutPolicy(offer, availability), `${code} ${availability}`).toEqual({
          allowed: false,
          code: "BILLING_OFFER_CONTACT_REQUIRED",
        });
      }
      // With nothing delivered, the default reads the catalog and refuses every offer too.
      expect(decideOfferCheckoutPolicy(offer).allowed, code).toBe(false);
    }
  });

  it("still keeps a contact-channel offer out of checkout when it is otherwise purchasable", () => {
    expect(decideOfferCheckoutPolicy({ code: "team", saleChannel: "contact" }, "purchasable")).toEqual({
      allowed: false,
      code: "BILLING_OFFER_CONTACT_REQUIRED",
    });
  });
});

describe("one subscription per workspace (Team self-serve, 2026-11-10)", () => {
  const none = { accessPlan: null, planCode: null, subscriptionStatus: "inactive", subscriptionCancelAt: null, paddleSubscriptionId: null };
  const developer = { accessPlan: "observer_access", planCode: null, subscriptionStatus: "active", subscriptionCancelAt: null, paddleSubscriptionId: "sub_1" };
  it("lets a workspace that never held a subscription buy either plan", () => {
    expect(decideSubscriptionChange(none, "observer_access")).toEqual({ allowed: true });
    expect(decideSubscriptionChange(none, "studio_access")).toEqual({ allowed: true });
  });
  /*
    R1 review (2026-11-10, intended): the projection (0005) never replaces a held subscription id
    except by the 0010 upgrade, so these are refused before Paddle charges. The earlier pin let an
    ended Developer buy again, which Paddle would charge and the projection would refuse.
  */
  it("sends past due and paused to the portal, and an ended subscription to us, for either plan", () => {
    for (const offer of ["observer_access", "studio_access"]) {
      for (const status of ["past_due", "paused"]) {
        expect(decideSubscriptionChange({ ...developer, subscriptionStatus: status }, offer))
          .toEqual({ allowed: false, code: "BILLING_SUBSCRIPTION_NEEDS_PORTAL" });
        expect(decideSubscriptionChange({ ...developer, accessPlan: "studio_access", subscriptionStatus: status }, offer))
          .toEqual({ allowed: false, code: "BILLING_SUBSCRIPTION_NEEDS_PORTAL" });
      }
      for (const status of ["canceled", "inactive"]) {
        expect(decideSubscriptionChange({ ...developer, subscriptionStatus: status, subscriptionCancelAt: "2026-12-01T00:00:00Z" }, offer))
          .toEqual({ allowed: false, code: "BILLING_RESUBSCRIBE_CONTACT" });
      }
    }
  });
  it("refuses a second subscription, and admits only the Developer-to-Team replacement after Developer is set to cancel", () => {
    expect(decideSubscriptionChange(developer, "observer_access")).toEqual({ allowed: false, code: "BILLING_PLAN_ALREADY_ACTIVE" });
    expect(decideSubscriptionChange(developer, "studio_access")).toEqual({ allowed: false, code: "BILLING_PLAN_CHANGE_REQUIRED" });
    expect(decideSubscriptionChange({ ...developer, subscriptionCancelAt: "2026-12-01T00:00:00Z" }, "studio_access")).toEqual({ allowed: true });
    const team = { ...developer, accessPlan: "studio_access" };
    expect(decideSubscriptionChange(team, "observer_access")).toEqual({ allowed: false, code: "BILLING_PLAN_CHANGE_REQUIRED" });
    expect(decideSubscriptionChange({ ...team, subscriptionCancelAt: "2026-12-01T00:00:00Z" }, "observer_access"))
      .toEqual({ allowed: false, code: "BILLING_PLAN_CHANGE_REQUIRED" });
  });
});

/*
  Catalog v2 (WO-CAT-3, 20261117140000). The checkout refusal must mirror what the billing projection applies, for
  every pair of held plan and target code, in every subscription state: an allowed checkout the projection then
  refuses takes a payment it cannot honour, and a refused one the projection would have applied loses a sale. The
  projection here is the ledger replay's oracle, written from the SQL (v6 -> v3 -> 0005, the schedule RPC) and held
  to the real functions by lib/billing-ledger-replay.db.test.ts; the matrix in supabase/tests/catalog_v2_offer_codes.sql
  holds the database to the same pairs.
*/
describe("plan changes mirror the projection (catalog v2, every code pair)", () => {
  const CODES = Object.keys(BILLING_OFFERS) as BillingOfferCode[];
  const UNKNOWN = ["enterprise", "free", "Personal", "observer", ""];
  const STATUSES = ["active", "trialing", "past_due", "paused", "canceled", "inactive"];
  const id = (prefix: string, tag: string) => `${prefix}_${tag.padStart(26, "0")}`;
  const nonce = (n: number) => `${n}0000000-0000-4000-8000-000000000000`;

  /** Runs the account's history and the new checkout through the projection; returns whether the target became the held plan. */
  function projectionApplies(held: BillingOfferCode | null, status: string, scheduled: boolean, target: string): boolean {
    const oracle = new LedgerOracle("v4");
    const ops: Op[] = [];
    const intent = (n: number, offer: string): IntentOp => ({ k: "intent", retry: false, tag: "t", nonce: nonce(n), offer, price: id("pri", `p${n}`), credit: 100 });
    const event = (n: number, tag: string, offer: string, e: Partial<EventOp>): EventOp => ({
      k: "event", retry: false, tag: "t", action: "subscription", eventId: id("evt", tag), eventType: "subscription.created", t: 0,
      sha: `sha256:${tag}`, offer, txn: null, sub: id("sub", `s${n}`), status: "active", adjustment: null, nonce: nonce(n),
      price: id("pri", `p${n}`), configured: null, ...e,
    });
    if (held) {
      ops.push(intent(1, held), event(1, "a", held, {}));
      if (status !== "active") ops.push(event(1, "b", held, { eventType: "subscription.updated", status, t: 10 }));
      if (scheduled) ops.push({ k: "schedule", retry: false, tag: "t", eventId: id("evt", status !== "active" ? "b" : "a"), sub: id("sub", "s1"), cancelAt: 9000 });
    }
    ops.push(intent(2, target));
    const change = event(2, "c", target, { t: 60 });
    for (const op of ops) oracle.apply(op);
    const outcome = oracle.apply(change);
    const status2 = outcome.ok?.status;
    const account = oracle.snapshotWithPlan(change).account;
    const heldNow = account ? (account.planCode ?? account.accessPlan) : null;
    return (status2 === "processed" || status2 === "processed_subscription_upgrade") && account?.subscriptionId === change.sub && heldNow === target;
  }

  it("allows exactly the checkouts the projection would apply", () => {
    const mismatches: string[] = [];
    let cases = 0;
    for (const held of [null, ...CODES]) {
      for (const status of held ? STATUSES : ["inactive"]) {
        for (const scheduled of held ? [false, true] : [false]) {
          for (const target of [...CODES, ...UNKNOWN]) {
            cases++;
            const decision = decideSubscriptionChange({
              accessPlan: held ? BILLING_OFFERS[held].accessLevel : null,
              planCode: held && BILLING_OFFERS[held].status === "v2" ? held : null,
              subscriptionStatus: held ? status : "inactive",
              subscriptionCancelAt: scheduled ? "2026-12-01T00:00:00Z" : null,
              paddleSubscriptionId: held ? id("sub", "s1") : null,
            }, target);
            const applies = projectionApplies(held, status, scheduled, target);
            if (decision.allowed !== applies) mismatches.push(`${held}/${status}/${scheduled ? "scheduled" : "-"} -> ${JSON.stringify(target)}: decision ${JSON.stringify(decision)}, projection ${applies}`);
          }
        }
      }
    }
    expect(cases).toBe(11 + 6 * 6 * 2 * 11);
    expect(mismatches).toEqual([]);
  });

  it("names the admitted replacements: legacy Developer to legacy Team, and anything to a v2 plan it does not hold", () => {
    const admitted = CODES.flatMap((held) => CODES.filter((target) => projectionAdmitsReplacement(held, target)).map((target) => `${held}>${target}`));
    expect(admitted).toEqual([
      "personal>developer", "personal>team", "personal>business",
      "developer>personal", "developer>team", "developer>business",
      "team>personal", "team>developer", "team>business",
      "business>personal", "business>developer", "business>team",
      "observer_access>personal", "observer_access>developer", "observer_access>team", "observer_access>business", "observer_access>studio_access",
      "studio_access>personal", "studio_access>developer", "studio_access>team", "studio_access>business",
    ]);
    for (const unknown of UNKNOWN) expect(projectionAdmitsReplacement("observer_access", unknown)).toBe(false);
  });

  it("refuses an unknown code even where no subscription is held", () => {
    const none = { accessPlan: null, planCode: null, subscriptionStatus: "inactive", subscriptionCancelAt: null, paddleSubscriptionId: null };
    for (const unknown of UNKNOWN) expect(decideSubscriptionChange(none, unknown)).toEqual({ allowed: false, code: "BILLING_OFFER_INVALID" });
    expect(decideSubscriptionChange(none, "personal")).toEqual({ allowed: true });
  });

  it("reads a v2 holder by its plan code, not by its level", () => {
    const personal = { accessPlan: "observer_access", planCode: "personal", subscriptionStatus: "active", subscriptionCancelAt: "2026-12-01T00:00:00Z", paddleSubscriptionId: "sub_1" };
    expect(decideSubscriptionChange(personal, "personal")).toEqual({ allowed: false, code: "BILLING_PLAN_ALREADY_ACTIVE" });
    expect(decideSubscriptionChange(personal, "developer")).toEqual({ allowed: true });
    // The legacy Developer -> legacy Team path belongs to a legacy holder only.
    expect(decideSubscriptionChange(personal, "studio_access")).toEqual({ allowed: false, code: "BILLING_PLAN_CHANGE_REQUIRED" });
    expect(decideSubscriptionChange({ ...personal, planCode: null }, "studio_access")).toEqual({ allowed: true });
  });
});

/*
  WO-CAT-3B. One resolver answers "which offer does this account hold", and it accepts exactly the rows the
  database accepts (foundation_billing_accounts_plan_code_check, 20261117140100). A row it refuses is never
  read as its level: a corrupt plan code must not quietly become the legacy plan of the same level.
*/
describe("heldOffer: the one answer to which offer an account holds", () => {
  const CODES = Object.keys(BILLING_OFFERS) as BillingOfferCode[];

  it("reads a v2 holder by its plan code and a legacy holder by its level, and no plan as none", () => {
    for (const code of CODES) {
      const offer = BILLING_OFFERS[code];
      const row = offer.status === "v2" ? { accessPlan: offer.accessLevel, planCode: code } : { accessPlan: code, planCode: null };
      expect(heldOffer(row), code).toEqual({ ok: true, code });
    }
    expect(heldOffer({ accessPlan: null, planCode: null })).toEqual({ ok: true, code: null });
  });

  it("refuses every row the database check refuses, and an absent field", () => {
    const UNKNOWN = { ok: false, code: "BILLING_PLAN_CODE_UNKNOWN" };
    for (const row of [
      { accessPlan: "studio_access", planCode: "enterprise" }, // a code the catalog does not name
      { accessPlan: "observer_access", planCode: "Personal" },
      { accessPlan: "observer_access", planCode: "team" }, // a plan code above its level
      { accessPlan: "studio_access", planCode: "personal" }, // and below it
      { accessPlan: null, planCode: "personal" }, // a plan code with no level (the guard of 20261117140100)
      { accessPlan: "observer_access", planCode: "observer_access" }, // a legacy code is never a plan code
      { accessPlan: "personal", planCode: null }, // a v2 code is never a level
      { accessPlan: "free", planCode: null },
      { accessPlan: "observer_access", planCode: "" },
    ]) expect(heldOffer(row), JSON.stringify(row)).toEqual(UNKNOWN);
    // Absent is not null: a reader that dropped the column is refused, not read as legacy.
    expect(heldOffer({ accessPlan: "observer_access" } as unknown as Parameters<typeof heldOffer>[0])).toEqual(UNKNOWN);
  });

  it("refuses a checkout over a plan code it cannot resolve, before anything else is decided", () => {
    const corrupt = { accessPlan: "studio_access", planCode: "enterprise", subscriptionStatus: "active", subscriptionCancelAt: "2026-12-01T00:00:00Z", paddleSubscriptionId: "sub_1" };
    expect(decideSubscriptionChange(corrupt, "business")).toEqual({ allowed: false, code: "BILLING_PLAN_CODE_UNKNOWN" });
    expect(decideSubscriptionChange({ ...corrupt, paddleSubscriptionId: null }, "business")).toEqual({ allowed: false, code: "BILLING_PLAN_CODE_UNKNOWN" });
    expect(decideSubscriptionChange({ ...corrupt, accessPlan: null, planCode: "team" }, "personal")).toEqual({ allowed: false, code: "BILLING_PLAN_CODE_UNKNOWN" });
  });
});
