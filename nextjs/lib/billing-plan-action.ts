import type { BillingOfferCode } from "./billing-catalog";

type AccessAccount = {
  accessPlan: string | null;
  subscriptionStatus: string;
  subscriptionCancelAt: string | null;
  paddleCustomerId: string | null;
};

export type AccessPlanAction =
  | { kind: "checkout"; label: string; offerCode: BillingOfferCode }
  | { kind: "portal"; label: string }
  | { kind: "disabled"; label: string };

const ACTIVE_SUBSCRIPTION = new Set(["active", "trialing"]);

/**
 * Select the one safe billing action for an access plan. Paddle webhooks still own entitlement;
 * this only prevents duplicate or unsupported subscription checkouts in the browser.
 */
export function accessPlanAction(
  account: AccessAccount | null,
  offerCode: "observer_access" | "studio_access",
): AccessPlanAction {
  const isActive = Boolean(account && ACTIVE_SUBSCRIPTION.has(account.subscriptionStatus));

  if (!account || !isActive || !account.accessPlan) {
    return { kind: "checkout", label: `Choose ${offerCode === "studio_access" ? "Studio" : "Observer"}`, offerCode };
  }
  if (account.accessPlan === offerCode) return { kind: "disabled", label: "Current plan" };
  if (account.accessPlan === "studio_access" && offerCode === "observer_access") {
    return { kind: "disabled", label: "Included with Studio" };
  }
  if (account.accessPlan === "observer_access" && offerCode === "studio_access") {
    if (account.subscriptionCancelAt) {
      return { kind: "checkout", label: "Start Studio", offerCode };
    }
    return account.paddleCustomerId
      ? { kind: "portal", label: "Manage plan" }
      : { kind: "disabled", label: "Billing support required" };
  }
  return { kind: "disabled", label: "Billing support required" };
}
