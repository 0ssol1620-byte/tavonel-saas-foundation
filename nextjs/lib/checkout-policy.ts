import type { CommercialState } from "./commercial-state";
import type { BillingOffer } from "./billing-catalog";

export type CheckoutPolicyDecision =
  | { allowed: true; mode: "sandbox_qualification" | "production" }
  | { allowed: false; code: "BILLING_LAUNCH_PENDING" };

export type OfferCheckoutPolicyDecision =
  | { allowed: true }
  | { allowed: false; code: "BILLING_OFFER_CONTACT_REQUIRED" };

/** Enforces the catalog's per-offer sales boundary independently of deployment-wide readiness. */
export function decideOfferCheckoutPolicy(
  offer: Pick<BillingOffer, "saleChannel">,
): OfferCheckoutPolicyDecision {
  return offer.saleChannel === "self_serve"
    ? { allowed: true }
    : { allowed: false, code: "BILLING_OFFER_CONTACT_REQUIRED" };
}

/** Keeps the money path aligned with the customer workflow advertised by public status. */
export function decideCheckoutPolicy(
  commercial: CommercialState,
  purchaseReady: boolean,
): CheckoutPolicyDecision {
  if (!commercial.checkoutEnabled) return { allowed: false, code: "BILLING_LAUNCH_PENDING" };
  if (commercial.provider === "sandbox") return { allowed: true, mode: "sandbox_qualification" };
  return purchaseReady
    ? { allowed: true, mode: "production" }
    : { allowed: false, code: "BILLING_LAUNCH_PENDING" };
}
