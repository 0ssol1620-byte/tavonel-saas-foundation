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
import { BILLING_OFFERS } from "./billing-catalog";
import {
  checkoutSellable,
  decideCheckoutResume,
  heldOfferSentence,
  loginUrlForOffer,
  readOfferParam,
  rememberCheckoutIntent,
  takeCheckoutIntent,
  type ResumeAccess,
} from "./checkout-intent";

const OFFER_CODES = Object.keys(BILLING_OFFERS) as Array<keyof typeof BILLING_OFFERS>;

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
    for (const code of OFFER_CODES) expect(checkoutSellable(code, null)).toBeNull();
  });

  it("sells nothing on a deployment where no plan can be bought", () => {
    for (const code of OFFER_CODES) expect(checkoutSellable(code, false)).toBe(false);
  });

  it("sells, on an open deployment, exactly the offers whose sale channel is self_serve", () => {
    for (const code of OFFER_CODES) {
      expect(checkoutSellable(code, true), code).toBe(BILLING_OFFERS[code].saleChannel === "self_serve");
    }
    expect(checkoutSellable("studio_access", true)).toBe(false);
    expect(checkoutSellable("observer_access", true)).toBe(true);
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
  checkout. A held offer resumes only into a workspace whose files may be processed in production;
  until then it is kept, never spent on a refusal the server is certain to give.
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
        expect(decideCheckoutResume("observer_access", purchaseOpen, access), String(purchaseOpen)).toBe("open");
      }
    }
    // Team is a conversation; its checkout is refused with the contact sentence, never held.
    expect(decideCheckoutResume("studio_access", true, newAccount)).toBe("open");
  });

  it("opens only for production processing in this workspace", () => {
    expect(decideCheckoutResume("observer_access", true, released)).toBe("open");
  });

  /*
    Review B1 (2026-10-19): a released workspace whose trial was refused (expired, a second account on
    the device, review required, trials off) answers ACCESS_READY_NO_ENTITLEMENT with no file access of
    its own, and buying is its way forward. Released means the production stage, which bootstrap sends
    only when the workspace gate is open -- not the trial's file access.
  */
  it("opens for a released workspace with no entitlement: the trial-refused buyer is not held", () => {
    const unentitledReleased: ResumeAccess = { ...newAccount, sourcePending: null, processingStage: "production" };
    expect(decideCheckoutResume("observer_access", true, unentitledReleased)).toBe("open");
    // Not released: still held, whatever else is true.
    expect(decideCheckoutResume("observer_access", true, { ...unentitledReleased, processingStage: "qualification" })).toBe("hold_release");
    expect(decideCheckoutResume("observer_access", true, { ...unentitledReleased, processingStage: null })).toBe("hold_release");
  });

  it("holds for the processing terms before anything else", () => {
    expect(decideCheckoutResume("observer_access", true, newAccount)).toBe("hold_terms");
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
      expect(decideCheckoutResume("observer_access", true, access), JSON.stringify(access)).toBe("hold_release");
    }
    // Access could not be read: kept, not spent.
    expect(decideCheckoutResume("observer_access", true, null)).toBe("hold_release");
  });

  it("drops the intent for a billing-exempt owner instead of holding it", () => {
    expect(decideCheckoutResume("observer_access", true, { ...newAccount, source: "owner", billingExempt: true })).toBe("drop_owner");
    expect(decideCheckoutResume("observer_access", true, { ...released, source: "owner", billingExempt: true })).toBe("drop_owner");
    // An owner grant that is not billing-exempt buys like anyone else.
    expect(decideCheckoutResume("observer_access", true, { ...released, source: "owner", billingExempt: false })).toBe("open");
  });

  it("says the live /login hold sentence and nothing it cannot keep (register C4)", () => {
    expect(heldOfferSentence("observer_access")).toBe("Developer is held for you.");
    for (const code of OFFER_CODES) {
      expect(heldOfferSentence(code)).toBe(`${BILLING_OFFERS[code].label} is held for you.`);
      expect(heldOfferSentence(code)).not.toMatch(/opens by itself|once you are in/);
    }
  });
});
