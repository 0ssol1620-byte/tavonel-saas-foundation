import type { CommercialState } from "./commercial-state";
import { BILLING_OFFERS, isBillingOfferCode, planAvailability, type BillingOffer, type BillingOfferCode, type PlanAvailability } from "./billing-catalog";

export type CheckoutPolicyDecision =
  | { allowed: true; mode: "sandbox_qualification" | "production" }
  | { allowed: false; code: "BILLING_LAUNCH_PENDING" };

export type OfferCheckoutPolicyDecision =
  | { allowed: true }
  | { allowed: false; code: "BILLING_OFFER_CONTACT_REQUIRED" };

/**
 * Enforces the catalog's per-offer sales boundary independently of deployment-wide readiness.
 * An offer is sold online only when it is `purchasable` (every capability on its line delivered, its
 * price configured) and its channel is self-serve; a retired or not-yet-deliverable offer is refused
 * here, before an intent exists.
 */
export function decideOfferCheckoutPolicy(
  offer: Pick<BillingOffer, "code" | "saleChannel">,
  availability: PlanAvailability = planAvailability(offer.code),
): OfferCheckoutPolicyDecision {
  return availability === "purchasable" && offer.saleChannel === "self_serve"
    ? { allowed: true }
    : { allowed: false, code: "BILLING_OFFER_CONTACT_REQUIRED" };
}

export type SubscriptionChangeDecision =
  | { allowed: true }
  | {
      allowed: false;
      code:
        | "BILLING_OFFER_INVALID"
        | "BILLING_PLAN_CODE_UNKNOWN"
        | "BILLING_PLAN_ALREADY_ACTIVE"
        | "BILLING_PLAN_CHANGE_REQUIRED"
        | "BILLING_SUBSCRIPTION_NEEDS_PORTAL"
        | "BILLING_RESUBSCRIBE_CONTACT";
    };

/** The two columns of `foundation_billing_accounts` that say which plan an account holds (20261117140000). */
export type PlanIdentity = {
  /** The entitlement level: `observer_access` / `studio_access`, or null with no plan. */
  accessPlan: string | null;
  /** The v2 offer bought (catalog v2), or null for a legacy plan, whose code is its level. Required: absent is not null. */
  planCode: string | null;
};

export type HeldOffer =
  | { ok: true; code: BillingOfferCode | null }
  | { ok: false; code: "BILLING_PLAN_CODE_UNKNOWN" };

/**
 * Which offer this account holds, the one answer every reader of the plan uses (WO-CAT-3B): the
 * `plan_code` when present, else the legacy level, whose code is the level itself. It accepts exactly
 * the rows `foundation_billing_accounts_plan_code_check` accepts (20261117140100): a plan code is a v2
 * code whose level is `access_plan`. Anything else -- an unknown code, a code above or below its level,
 * a plan code with no level, an absent field -- is refused, never read as the level.
 */
export function heldOffer(account: PlanIdentity): HeldOffer {
  const { accessPlan, planCode } = account;
  if (planCode === null) {
    if (accessPlan === null) return { ok: true, code: null };
    if (isBillingOfferCode(accessPlan) && BILLING_OFFERS[accessPlan].accessLevel === accessPlan) return { ok: true, code: accessPlan };
  } else if (isBillingOfferCode(planCode)) {
    const level = BILLING_OFFERS[planCode].accessLevel;
    if (level !== planCode && level === accessPlan) return { ok: true, code: planCode };
  }
  return { ok: false, code: "BILLING_PLAN_CODE_UNKNOWN" };
}

/*
  2026-11-10, with Team self-serve; widened 2026-11-17 for catalog v2 (20261117140000). This mirrors
  what the billing projection accepts, so a checkout is refused before Paddle can take a payment the
  projection would then refuse to apply.

  - 0005 (the base under v3 to v6) writes a subscription event only when the account has no
    `paddle_subscription_id` yet or the event carries the same one. Nothing ever clears that id.
    Cancellation, past due and pause only change the status.
  - v3 (0011, widened by 20261117140000) admits one kind of replacement, for the same Paddle customer,
    over a subscription that is `active` or `trialing` with its cancellation scheduled
    (`projectionAdmitsReplacement`).

  So once a workspace has held any subscription, the only checkout the projection can apply is that
  replacement. Past due and paused are fixed or cancelled in the customer portal. An ended
  subscription cannot be replaced by a new one, so re-subscribing is arranged with us.
*/
export function decideSubscriptionChange(
  account: PlanIdentity & {
    subscriptionStatus: string;
    subscriptionCancelAt: string | null;
    paddleSubscriptionId: string | null;
  },
  offerCode: string,
): SubscriptionChangeDecision {
  // The projection names six codes and raises for any other (foundation_offer_access_plan), so nothing else is sold.
  if (!isBillingOfferCode(offerCode)) return { allowed: false, code: "BILLING_OFFER_INVALID" };
  const held = heldOffer(account);
  if (!held.ok) return { allowed: false, code: held.code };
  if (!account.paddleSubscriptionId) return { allowed: true };
  if (account.subscriptionStatus === "past_due" || account.subscriptionStatus === "paused") {
    return { allowed: false, code: "BILLING_SUBSCRIPTION_NEEDS_PORTAL" };
  }
  if (account.subscriptionStatus !== "active" && account.subscriptionStatus !== "trialing") {
    return { allowed: false, code: "BILLING_RESUBSCRIBE_CONTACT" };
  }
  if (held.code === offerCode) return { allowed: false, code: "BILLING_PLAN_ALREADY_ACTIVE" };
  if (account.subscriptionCancelAt && projectionAdmitsReplacement(held.code, offerCode)) return { allowed: true };
  return { allowed: false, code: "BILLING_PLAN_CHANGE_REQUIRED" };
}

/**
 * The plan pairs v3's replacement admits (20261117140000), held plan first: a legacy Developer
 * (`observer_access`, no plan code) to the legacy Team (`studio_access`), as 0010/0011 always did; and
 * any held plan to a v2 plan it does not already hold. A retired code is never a target, and an unknown
 * code is never admitted (the SQL mapping raises on it).
 */
export function projectionAdmitsReplacement(held: string | null, target: string): boolean {
  if (held === "observer_access" && target === "studio_access") return true;
  return isBillingOfferCode(target) && BILLING_OFFERS[target].status === "v2" && held !== target;
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
