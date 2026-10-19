/**
 * The intent to buy, carried across a sign-in.
 *
 * Every pricing control on the landing page was a dead end for a signed-out visitor: clicking
 * "Choose this plan" produced a toast telling them to sign in first, and signing in dropped them
 * in the workspace with no memory of what they had been about to buy. The one moment a visitor
 * declares what they want was the moment the product forgot it.
 *
 * The intent is kept in two places on purpose, because neither survives alone:
 *
 *   - The URL (`/login?next=checkout&offer=<code>`) makes it linkable and visible, and is what a
 *     visitor actually navigates to. It cannot survive the Google round trip, which returns to a
 *     fixed callback path.
 *   - `sessionStorage` carries it across that round trip. It is per-tab and same-origin, so it
 *     never leaks into another tab's flow, and it is cleared the moment it is consumed.
 *
 * What is carried is an offer code and nothing else. No price, no amount, no currency: the server
 * owns the allow-list, and a URL a visitor can edit must not be able to name a number.
 */

import { BILLING_OFFERS, isBillingOfferCode, type BillingOfferCode } from "./billing-catalog";

const KEY = "tavonel.checkout-intent";

/** Where a signed-out visitor goes when they pick an offer. */
/**
 * Whether /login may promise this offer's checkout (B-07). The one predicate the intent notice and
 * the H1 both read, so they cannot disagree.
 *
 * `purchaseOpen` is the deployment's `purchasePlan`; it says whether any plan can be bought. The
 * offer's `saleChannel` says whether this one is sold online at all -- Team is "contact" and its
 * checkout answers 403 BILLING_OFFER_CONTACT_REQUIRED (`checkout-policy.ts`), which is why /pricing
 * already decides per offer. null: the deployment has not answered, so nothing is said either way.
 */
export function checkoutSellable(offerCode: BillingOfferCode, purchaseOpen: boolean | null): boolean | null {
  return purchaseOpen === null ? null : purchaseOpen && BILLING_OFFERS[offerCode].saleChannel === "self_serve";
}

export function loginUrlForOffer(offerCode: BillingOfferCode) {
  return `/login?next=checkout&offer=${encodeURIComponent(offerCode)}`;
}

/** Reads an offer code out of a query string, returning null for anything not on the list. */
export function readOfferParam(search: string): BillingOfferCode | null {
  const params = new URLSearchParams(search);
  if (params.get("next") !== "checkout" && !params.has("checkout")) return null;
  const value = params.get("offer") ?? params.get("checkout");
  return isBillingOfferCode(value) ? value : null;
}

export function rememberCheckoutIntent(offerCode: BillingOfferCode) {
  try {
    window.sessionStorage.setItem(KEY, offerCode);
  } catch {
    // A browser with site data blocked still gets a working sign-in; it just forgets the offer.
  }
}

/** Reads and clears in one step, so a resumed checkout cannot fire twice on a reload. */
export function takeCheckoutIntent(): BillingOfferCode | null {
  try {
    const value = window.sessionStorage.getItem(KEY);
    window.sessionStorage.removeItem(KEY);
    return isBillingOfferCode(value) ? value : null;
  } catch {
    return null;
  }
}
