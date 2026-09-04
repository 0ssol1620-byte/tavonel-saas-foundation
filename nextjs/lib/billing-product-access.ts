import { getFoundationAccountGrant } from "./account-grants";
import { getFoundationBillingAccount, type FoundationBillingAccount } from "./billing-store";

export type ProductAccessLevel = "observer" | "studio";

export function billingProductDecision(
  account: FoundationBillingAccount,
  required: ProductAccessLevel,
): { ok: true } | { ok: false; code: string; status: number } {
  if (account.billingHold) return { ok: false, code: "BILLING_HOLD", status: 402 };
  if (!account.accessPlan || !["active", "trialing"].includes(account.subscriptionStatus)) {
    return { ok: false, code: "SUBSCRIPTION_REQUIRED", status: 402 };
  }
  if (!new Set(["observer_access", "studio_access"]).has(account.accessPlan)) {
    return { ok: false, code: "SUBSCRIPTION_PLAN_INVALID", status: 403 };
  }
  if (required === "studio" && account.accessPlan !== "studio_access") {
    return { ok: false, code: "STUDIO_SUBSCRIPTION_REQUIRED", status: 402 };
  }
  return { ok: true };
}

export async function authorizeFoundationProduct(
  workspaceKey: string,
  userId: string,
  required: ProductAccessLevel,
) {
  // An owner grant is an operator decision, not a synthetic Paddle subscription. It is checked
  // before billing so the product remains usable even if a historical provider subscription is
  // inactive, has no credits, or is eventually removed. The grant itself is stored server-side
  // and browser roles cannot read or mint it.
  const grant = await getFoundationAccountGrant(userId);
  if (!grant.ok) return { ok: false as const, code: grant.code, status: 503 };
  if (grant.grant) {
    if (required === "studio" && grant.grant.accessPlan !== "studio_access") {
      return { ok: false as const, code: "STUDIO_SUBSCRIPTION_REQUIRED", status: 402 };
    }
    return { ok: true as const, source: "owner" as const, billingExempt: grant.grant.billingExempt };
  }

  const stored = await getFoundationBillingAccount(workspaceKey, userId);
  if (!stored.ok) return { ok: false as const, code: stored.code, status: 503 };
  const decision = billingProductDecision(stored.account, required);
  return decision.ok
    ? { ok: true as const, source: "paid" as const, billingExempt: false }
    : decision;
}
