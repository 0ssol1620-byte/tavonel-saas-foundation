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
  loginUrlForOffer,
  readOfferParam,
  rememberCheckoutIntent,
  takeCheckoutIntent,
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
