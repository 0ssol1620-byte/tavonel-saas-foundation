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
  | { allowed: false; code: "BILLING_PLAN_ALREADY_ACTIVE" | "BILLING_PLAN_CHANGE_REQUIRED" };

/*
  2026-11-10, with Team self-serve. A workspace holds one subscription. A second checkout while one
  is live would be a second charge that the billing projection then refuses to apply, because the
  projection admits exactly one replacement: Developer to Team, once the Developer subscription is
  scheduled to cancel (`supabase/migrations/0010_foundation_subscription_upgrade.sql`). So a live
  subscription refuses every other checkout before a Paddle intent exists. The change goes through
  the customer portal (cancel Developer at period end), then Team is bought and replaces it.
*/
export function decideSubscriptionChange(
  account: { accessPlan: string | null; subscriptionStatus: string; subscriptionCancelAt: string | null; paddleSubscriptionId: string | null },
  offerCode: string,
): SubscriptionChangeDecision {
  const live = Boolean(account.paddleSubscriptionId) && ["active", "trialing"].includes(account.subscriptionStatus);
  if (!live) return { allowed: true };
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
