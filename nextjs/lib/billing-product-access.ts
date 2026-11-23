import { getFoundationAccountGrant, type FoundationAccountGrant } from "./account-grants";
import { getFoundationBillingAccount, type FoundationBillingAccount } from "./billing-store";
import { foundationWorkspaceId } from "./foundation-pilot";
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
export type ProductAccessLevel = "observer" | "connections" | "studio" | "activation";

/*
  `connections` (2026-11-10): storage connectors -- Google Drive, Dropbox and OneDrive OAuth, and
  the local source agent -- are included on both paid plans. They were `studio` until a paying
  Developer workspace pressed "Connect Google Drive" and was told its plan did not include it.
  Plan-wise this level is answered like `observer`; the free evaluation is what it keeps out,
  which `authorizeFoundationSessionProduct` decides, because only that function knows a trial.
  Synced pages are metered by the same compute reservation as an upload, so nothing about the
  allowance changes here.
*/

/** The levels a route may name as its minimum plan. Activation needs a role and has its own call. */
export type MinimumPlanLevel = Exclude<ProductAccessLevel, "activation">;

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
  if (required === "observer" || required === "connections") return true;
  if (accessPlan === "studio_access") return true;
  return required === "activation" && role === "owner";
}

export function billingProductDecision(
  account: FoundationBillingAccount,
  required: ProductAccessLevel,
  role?: ProductAccessRole,
  now: Date = new Date(),
): { ok: true } | { ok: false; code: string; status: number } {
  if (account.billingHold) return { ok: false, code: "BILLING_HOLD", status: 402 };
  if (!account.accessPlan || !["active", "trialing"].includes(account.subscriptionStatus)) {
    return { ok: false, code: "SUBSCRIPTION_REQUIRED", status: 402 };
  }
  if (!new Set(["observer_access", "studio_access"]).has(account.accessPlan)) {
    return { ok: false, code: "SUBSCRIPTION_PLAN_INVALID", status: 403 };
  }
  // A cancellation that has taken effect ends access even while the provider's final webhook is
  // still in flight; a future scheduled cancellation keeps access until it arrives.
  if (account.subscriptionCancelAt != null) {
    const cancelAt = new Date(account.subscriptionCancelAt).getTime();
    if (Number.isFinite(cancelAt) && cancelAt <= now.getTime()) {
      return { ok: false, code: "SUBSCRIPTION_REQUIRED", status: 402 };
    }
  }
  // The existing refusal code, deliberately. A client branching on STUDIO_SUBSCRIPTION_REQUIRED
  // keeps working: what changed is who satisfies the gate, not what a refusal is called.
  if (!planReachesLevel(account.accessPlan as "observer_access" | "studio_access", required, role)) {
    return { ok: false, code: "STUDIO_SUBSCRIPTION_REQUIRED", status: 402 };
  }
  return { ok: true };
}

/**
 * The operator grant and the billing account that govern this caller in this workspace (WO-C-T2).
 *
 * In their own workspace a caller's own grant is read first and, when there is one, nothing else --
 * exactly as before. Elsewhere the workspace's account is read too: when it belongs to another user
 * (the caller is an active admin or member, `getFoundationBillingAccount`), the grant that governs is
 * that payer's (the account holder, or the owner when there is no account) and the caller's own grant does not carry into a
 * workspace whose plan is somebody else's, as `reserve_foundation_compute_v3` decides it. `member`
 * says which of the two answers this is; a member never draws on a free evaluation.
 */
export async function resolveWorkspaceEntitlement(workspaceKey: string, userId: string): Promise<
  | { ok: true; grant: FoundationAccountGrant; member: boolean }
  | { ok: true; grant: null; account: FoundationBillingAccount; member: boolean }
  | { ok: false; code: string; status: 503 }
> {
  const own = await getFoundationAccountGrant(userId);
  if (!own.ok) return { ok: false, code: own.code, status: 503 };
  if (own.grant && workspaceKey === foundationWorkspaceId(userId)) return { ok: true, grant: own.grant, member: false };
  const stored = await getFoundationBillingAccount(workspaceKey, userId);
  if (!stored.ok) return { ok: false, code: stored.code, status: 503 };
  const member = stored.account.userId !== userId;
  const grant = member ? await getFoundationAccountGrant(stored.account.userId) : own;
  if (!grant.ok) return { ok: false, code: grant.code, status: 503 };
  return grant.grant
    ? { ok: true, grant: grant.grant, member }
    : { ok: true, grant: null, account: stored.account, member };
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
  const entitlement = await resolveWorkspaceEntitlement(workspaceKey, userId);
  if (!entitlement.ok) return entitlement;
  if (entitlement.grant) {
    if (!planReachesLevel(entitlement.grant.accessPlan, required, role)) {
      return { ok: false as const, code: "STUDIO_SUBSCRIPTION_REQUIRED", status: 402 };
    }
    return { ok: true as const, source: "owner" as const, billingExempt: entitlement.grant.billingExempt };
  }

  const decision = billingProductDecision(entitlement.account, required, role);
  return decision.ok
    ? { ok: true as const, source: "paid" as const, billingExempt: false }
    : decision;
}
