/**
 * The intent is the only thing allowed to cross the sign-in.
 *
 * The value in these assertions is what they forbid. A carried intent is a URL a visitor can
 * edit, so the one failure that matters is a price, an amount or a currency travelling in it --
 * and the second is an arbitrary string being accepted as an offer and reaching the checkout
 * call. Both are cheap to introduce later by "just adding the amount so the login page can show
 * it", which is exactly the change these tests exist to fail.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { BILLING_OFFERS, planAvailability, readConfiguredBillingOffers, type PlanAvailability } from "./billing-catalog";
import {
  checkoutSellable,
  decideCheckoutResume,
  heldOfferSentence,
  loginUrlForOffer,
  readOfferParam,
  rememberCheckoutIntent,
  servedAvailability as served,
  takeCheckoutIntent,
  type ResumeAccess,
} from "./checkout-intent";

const OFFER_CODES = Object.keys(BILLING_OFFERS) as Array<keyof typeof BILLING_OFFERS>;
const AVAILABILITIES: readonly PlanAvailability[] = ["purchasable", "request_access", "retired"];

function installStorage() {
  const map = new Map<string, string>();
  vi.stubGlobal("window", {
    sessionStorage: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    },
  });
  return map;
}

describe("checkoutSellable: the one predicate /login's notice and H1 both read (B-07)", () => {
  it("promises nothing before the deployment has answered", () => {
    for (const availability of AVAILABILITIES) expect(checkoutSellable(served(availability), null)).toBeNull();
  });

  it("sells nothing on a deployment where no plan can be bought", () => {
    for (const availability of AVAILABILITIES) expect(checkoutSellable(served(availability), false)).toBe(false);
  });

  it("sells, on an open deployment, only a purchasable plan", () => {
    expect(checkoutSellable(served("purchasable"), true)).toBe(true);
    // Failure paths: a plan waiting for its capabilities, and a retired one, are never sold online.
    expect(checkoutSellable(served("request_access"), true)).toBe(false);
    expect(checkoutSellable(served("retired"), true)).toBe(false);
  });

  it("fails closed for every offer with nothing delivered, even with every price configured", () => {
    const configured = new Map(OFFER_CODES.map((code) => [code, true] as const));
    for (const code of OFFER_CODES) {
      expect(planAvailability(code, configured, new Set()), code).not.toBe("purchasable");
      expect(checkoutSellable(served(planAvailability(code, configured, new Set())), true), code).toBe(false);
    }
  });

  /*
    WO-REL-1, both price-env states through the real catalog: with the two V22 prices unset no offer is sellable even on
    an open deployment; with both set exactly Personal and Developer are; with one alone, none is.
  */
  it("sells Personal and Developer only with both V22 prices set, in the release as it is", () => {
    const sellable = (env: Record<string, string>) => OFFER_CODES.filter((code) =>
      checkoutSellable(served(planAvailability(code, readConfiguredBillingOffers(env))), true));
    const retired = { PADDLE_PRICE_OBSERVER_ACCESS: `pri_${"o".repeat(26)}`, PADDLE_PRICE_STUDIO_ACCESS: `pri_${"s".repeat(26)}` };
    expect(sellable(retired)).toEqual([]);
    expect(sellable({ ...retired, PADDLE_PRICE_PERSONAL: `pri_${"p".repeat(26)}` })).toEqual([]);
    expect(sellable({ ...retired, PADDLE_PRICE_PERSONAL: `pri_${"p".repeat(26)}`, PADDLE_PRICE_DEVELOPER: `pri_${"d".repeat(26)}` }))
      .toEqual(["personal", "developer"]);
  });

  /*
    WO-CAT-2 N3: the type is the rule. Neither function takes an offer code and resolves it from the runtime's own
    environment any more, and neither takes a bare availability: only one a server branded (`servedAvailability`).
    `tsc --noEmit` fails if any of these lines compiles.
  */
  it("takes no offer code, and no availability the caller made up (type-level failure paths)", () => {
    const constant: PlanAvailability = "purchasable";
    // @ts-expect-error an offer code is not an availability
    expect(() => checkoutSellable("personal", true)).not.toThrow();
    // @ts-expect-error a literal is not a server's answer
    expect(checkoutSellable("purchasable", true)).toBe(true);
    // @ts-expect-error nor is a PlanAvailability constant
    expect(checkoutSellable(constant, true)).toBe(true);
    // @ts-expect-error decideCheckoutResume takes a server's answer or none (null), never an offer code
    expect(decideCheckoutResume("team", true, null)).toBe("open");
    // @ts-expect-error nor a constant standing in for the server
    expect(decideCheckoutResume(constant, true, null)).toBe("hold_release");
  });
});

describe("checkout intent", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("has offers to carry", () => {
    expect(OFFER_CODES.length).toBeGreaterThan(0);
  });

  it("carries an offer code and never a price, amount or currency", () => {
    for (const code of OFFER_CODES) {
      const url = loginUrlForOffer(code);
      expect(url).toBe(`/login?next=checkout&offer=${code}`);
      expect(url).not.toMatch(/pri_|price|amount|currency|usd|\$|\d+\.\d\d/i);
    }
  });

  it("reads back only codes that exist", () => {
    for (const code of OFFER_CODES) {
      expect(readOfferParam(`?next=checkout&offer=${code}`)).toBe(code);
      expect(readOfferParam(`?checkout=${code}`)).toBe(code);
    }
  });

  it("refuses anything that is not an offer code", () => {
    for (const bad of ["", "free", "studio_access_", "__proto__", "constructor", "pri_01abc", "9.99"]) {
      expect(readOfferParam(`?next=checkout&offer=${encodeURIComponent(bad)}`)).toBeNull();
    }
  });

  it("ignores a lone offer parameter with no intent to check out", () => {
    expect(readOfferParam(`?offer=${OFFER_CODES[0]}`)).toBeNull();
  });

  it("consumes the stored intent exactly once", () => {
    installStorage();
    rememberCheckoutIntent(OFFER_CODES[0]);
    expect(takeCheckoutIntent()).toBe(OFFER_CODES[0]);
    expect(takeCheckoutIntent()).toBeNull();
  });

  it("returns nothing when storage was never written", () => {
    installStorage();
    expect(takeCheckoutIntent()).toBeNull();
  });

  it("does not throw when the browser refuses storage", () => {
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: () => { throw new Error("blocked"); },
        setItem: () => { throw new Error("blocked"); },
        removeItem: () => { throw new Error("blocked"); },
      },
    });
    expect(() => rememberCheckoutIntent(OFFER_CODES[0])).not.toThrow();
    expect(takeCheckoutIntent()).toBeNull();
  });

  it("refuses a stored value that is no longer a valid offer code", () => {
    const map = installStorage();
    map.set("tavonel.checkout-intent", "retired_plan");
    expect(takeCheckoutIntent()).toBeNull();
  });
});

/*
  P2-29 (register D-14, journey defect D-01): processing terms, then the production launch, then
  checkout. A held offer resumes only into a workspace released for production processing (the
  stage, not file access: review B1); until then it is kept, never spent on a refusal the server is
  certain to give.
*/
describe("decideCheckoutResume: terms -> launch -> checkout (D-14)", () => {
  const newAccount: ResumeAccess = {
    source: "unentitled", billingExempt: false, customerDataEnabled: false, processingStage: null,
    sourcePending: "terms_acceptance_required",
  };
  const released: ResumeAccess = {
    source: "trial", billingExempt: false, customerDataEnabled: true, processingStage: "production", sourcePending: null,
  };

  it("changes nothing where the plan is not sold online: the request goes out as on main", () => {
    for (const purchaseOpen of [false, null]) {
      for (const access of [newAccount, released, null]) {
        for (const availability of [...AVAILABILITIES.map(served), null]) {
          expect(decideCheckoutResume(availability, purchaseOpen, access), `${availability} ${purchaseOpen}`).toBe("open");
        }
      }
    }
    // A plan that is not purchasable is a conversation; its checkout is refused with the contact sentence, never held.
    expect(decideCheckoutResume(served("request_access"), true, newAccount)).toBe("open");
    expect(decideCheckoutResume(served("retired"), true, newAccount)).toBe("open");
  });

  /*
    WO-CAT-2 N2. The workspace has no server answer for a carried offer, and passes none (null): a current offer is
    held exactly as a purchasable one would be, which claims nothing -- the checkout route answers when the hold ends.
  */
  it("holds with no server answer (null) exactly as a purchasable plan is held, on an open deployment only", () => {
    for (const access of [newAccount, released, null, { ...released, source: "owner" as const, billingExempt: true },
      { ...newAccount, sourcePending: "release_pending" as const }, { ...released, processingStage: "qualification" as const }]) {
      expect(decideCheckoutResume(null, true, access), JSON.stringify(access)).toBe(decideCheckoutResume(served("purchasable"), true, access));
    }
    expect(decideCheckoutResume(null, true, newAccount)).toBe("hold_terms");
  });

  it("opens only for production processing in this workspace", () => {
    expect(decideCheckoutResume(served("purchasable"), true, released)).toBe("open");
  });

  /*
    Review B1 (2026-10-19): a released workspace whose trial was refused (expired, a second account on
    the device, review required, trials off) answers ACCESS_READY_NO_ENTITLEMENT with no file access of
    its own, and buying is its way forward. Released means the production stage, which bootstrap sends
    only when the workspace gate is open -- not the trial's file access.
  */
  it("opens for a released workspace with no entitlement: the trial-refused buyer is not held", () => {
    const unentitledReleased: ResumeAccess = { ...newAccount, sourcePending: null, processingStage: "production" };
    expect(decideCheckoutResume(served("purchasable"), true, unentitledReleased)).toBe("open");
    // Not released: still held, whatever else is true.
    expect(decideCheckoutResume(served("purchasable"), true, { ...unentitledReleased, processingStage: "qualification" })).toBe("hold_release");
    expect(decideCheckoutResume(served("purchasable"), true, { ...unentitledReleased, processingStage: null })).toBe("hold_release");
  });

  it("holds for the processing terms before anything else", () => {
    expect(decideCheckoutResume(served("purchasable"), true, newAccount)).toBe("hold_terms");
  });

  it("holds for the launch once the terms are accepted, and fails closed on anything short of production", () => {
    const short: ResumeAccess[] = [
      { ...newAccount, sourcePending: "release_pending" },
      { ...newAccount, sourcePending: "workspace_refused" },
      { ...newAccount, sourcePending: null }, // gate v1 sends no reason
      { ...released, processingStage: "qualification" }, // a qualification grant is never billable
      { ...released, processingStage: null },
      { ...released, processingStage: undefined },
    ];
    for (const access of short) {
      expect(decideCheckoutResume(served("purchasable"), true, access), JSON.stringify(access)).toBe("hold_release");
    }
    // Access could not be read: kept, not spent.
    expect(decideCheckoutResume(served("purchasable"), true, null)).toBe("hold_release");
  });

  it("drops the intent for a billing-exempt owner instead of holding it", () => {
    expect(decideCheckoutResume(served("purchasable"), true, { ...newAccount, source: "owner", billingExempt: true })).toBe("drop_owner");
    expect(decideCheckoutResume(served("purchasable"), true, { ...released, source: "owner", billingExempt: true })).toBe("drop_owner");
    // An owner grant that is not billing-exempt buys like anyone else.
    expect(decideCheckoutResume(served("purchasable"), true, { ...released, source: "owner", billingExempt: false })).toBe("open");
  });

  it("says the live /login hold sentence and nothing it cannot keep (register C4)", () => {
    expect(heldOfferSentence("personal")).toBe("Personal is held for you.");
    for (const code of OFFER_CODES) {
      expect(heldOfferSentence(code)).toBe(`${BILLING_OFFERS[code].label} is held for you.`);
      expect(heldOfferSentence(code)).not.toMatch(/opens by itself|once you are in/);
    }
  });
});
