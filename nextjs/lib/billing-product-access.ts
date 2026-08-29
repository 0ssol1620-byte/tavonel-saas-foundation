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
  const stored = await getFoundationBillingAccount(workspaceKey, userId);
  if (!stored.ok) return { ok: false as const, code: stored.code, status: 503 };
  return billingProductDecision(stored.account, required);
}
