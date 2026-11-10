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

export type SubscriptionChangeDecision =
  | { allowed: true }
  | {
      allowed: false;
      code: "BILLING_PLAN_ALREADY_ACTIVE" | "BILLING_PLAN_CHANGE_REQUIRED" | "BILLING_SUBSCRIPTION_NEEDS_PORTAL" | "BILLING_RESUBSCRIBE_CONTACT";
    };

/*
  2026-11-10, with Team self-serve. This mirrors what the billing projection accepts, so a checkout
  is refused before Paddle can take a payment the projection would then refuse to apply.

  - 0005 (the v2 subscription branch, still the base of v3 to v6) writes a subscription event only
    when the account has no `paddle_subscription_id` yet or the event carries the same one.
  - Nothing ever clears that id. Cancellation, past due and pause only change the status.
  - 0010/0011 admit exactly one replacement: a Team subscription over a Developer one that is
    `active` or `trialing` with its cancellation scheduled, for the same Paddle customer.

  So once a workspace has held any subscription, the only checkout the projection can apply is that
  replacement. Past due and paused are fixed or cancelled in the customer portal. An ended
  subscription cannot be replaced by a new one, so re-subscribing is arranged with us.
*/
export function decideSubscriptionChange(
  account: { accessPlan: string | null; subscriptionStatus: string; subscriptionCancelAt: string | null; paddleSubscriptionId: string | null },
  offerCode: string,
): SubscriptionChangeDecision {
  if (!account.paddleSubscriptionId) return { allowed: true };
  if (account.subscriptionStatus === "past_due" || account.subscriptionStatus === "paused") {
    return { allowed: false, code: "BILLING_SUBSCRIPTION_NEEDS_PORTAL" };
  }
  if (account.subscriptionStatus !== "active" && account.subscriptionStatus !== "trialing") {
    return { allowed: false, code: "BILLING_RESUBSCRIBE_CONTACT" };
  }
  if (account.accessPlan === offerCode) return { allowed: false, code: "BILLING_PLAN_ALREADY_ACTIVE" };
  if (offerCode === "studio_access" && account.accessPlan === "observer_access" && account.subscriptionCancelAt) return { allowed: true };
  return { allowed: false, code: "BILLING_PLAN_CHANGE_REQUIRED" };
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
