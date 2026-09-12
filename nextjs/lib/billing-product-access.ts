import { getFoundationAccountGrant } from "./account-grants";
import { getFoundationBillingAccount, type FoundationBillingAccount } from "./billing-store";
import type { WorkspaceMembership } from "./pilot-tenant";

/*
  The three levels a route may demand, and the one that needs to know who is asking.

  `observer` and `studio` are plan-only questions. `activation` -- promoting a candidate World to
  active and rolling one back -- is a plan *and* role question, because the two plans reach it for
  different reasons. Team (`studio_access`) sells shared membership, so activation stays with the
  workspace's governing roles exactly as before. Developer (`observer_access`) is a single-person
  plan bought with a card, so it reaches activation only as the workspace owner: a Developer
  workspace that admitted a `member` would be granting a governance right the plan does not sell.

  Everything else about promotion is unchanged and enforced where it already was: the human
  decision, the equivalence gate, source freshness, the connector ACL, the re-authorisation pass
  and the compute reservation. This function answers one question -- may this plan, held by this
  role, reach this level -- and the /pricing capability table is rendered from the same answer, so
  the page cannot promise a different one.
*/
export type ProductAccessLevel = "observer" | "studio" | "activation";

/**
 * The caller's workspace role, as the membership row spells it rather than a second list of
 * roles kept here. Absent means "not stated", which never reaches activation.
 */
export type ProductAccessRole = WorkspaceMembership["role"];

/**
 * Whether a plan, in the hands of this role, reaches this level.
 *
 * Fails closed on an unstated role: a caller that does not say who is asking is answered as
 * somebody who is not the owner, which is a refusal on Developer.
 */
export function planReachesLevel(
  accessPlan: "observer_access" | "studio_access",
  required: ProductAccessLevel,
  role?: ProductAccessRole,
) {
  if (required === "observer") return true;
  if (accessPlan === "studio_access") return true;
  return required === "activation" && role === "owner";
}

export function billingProductDecision(
  account: FoundationBillingAccount,
  required: ProductAccessLevel,
  role?: ProductAccessRole,
): { ok: true } | { ok: false; code: string; status: number } {
  if (account.billingHold) return { ok: false, code: "BILLING_HOLD", status: 402 };
  if (!account.accessPlan || !["active", "trialing"].includes(account.subscriptionStatus)) {
    return { ok: false, code: "SUBSCRIPTION_REQUIRED", status: 402 };
  }
  if (!new Set(["observer_access", "studio_access"]).has(account.accessPlan)) {
    return { ok: false, code: "SUBSCRIPTION_PLAN_INVALID", status: 403 };
  }
  // The existing refusal code, deliberately. A client branching on STUDIO_SUBSCRIPTION_REQUIRED
  // keeps working: what changed is who satisfies the gate, not what a refusal is called.
  if (!planReachesLevel(account.accessPlan as "observer_access" | "studio_access", required, role)) {
    return { ok: false, code: "STUDIO_SUBSCRIPTION_REQUIRED", status: 402 };
  }
  return { ok: true };
}

export async function authorizeFoundationProduct(
  workspaceKey: string,
  userId: string,
  required: ProductAccessLevel,
  role?: ProductAccessRole,
) {
  // An owner grant is an operator decision, not a synthetic Paddle subscription. It is checked
  // before billing so the product remains usable even if a historical provider subscription is
  // inactive, has no credits, or is eventually removed. The grant itself is stored server-side
  // and browser roles cannot read or mint it.
  const grant = await getFoundationAccountGrant(userId);
  if (!grant.ok) return { ok: false as const, code: grant.code, status: 503 };
  if (grant.grant) {
    if (!planReachesLevel(grant.grant.accessPlan, required, role)) {
      return { ok: false as const, code: "STUDIO_SUBSCRIPTION_REQUIRED", status: 402 };
    }
    return { ok: true as const, source: "owner" as const, billingExempt: grant.grant.billingExempt };
  }

  const stored = await getFoundationBillingAccount(workspaceKey, userId);
  if (!stored.ok) return { ok: false as const, code: stored.code, status: 503 };
  const decision = billingProductDecision(stored.account, required, role);
  return decision.ok
    ? { ok: true as const, source: "paid" as const, billingExempt: false }
    : decision;
}
