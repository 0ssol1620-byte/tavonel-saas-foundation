import type { PaddleBillingAction } from "./paddle-billing-event";
import type { CheckoutBinding } from "./billing-binding";
import type { BillingOffer } from "./billing-catalog";
import { foundationWorkspaceId } from "./foundation-pilot";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";
import { getWorkspaceMembership } from "./workspace-membership";

export type FoundationBillingAccount = {
  workspaceKey: string;
  userId: string;
  accessPlan: string | null;
  /** The v2 offer the subscription was bought as (catalog v2, 20261117140000); null for a legacy plan, whose code is `accessPlan`. */
  planCode: string | null;
  subscriptionStatus: string;
  creditBalance: number;
  lifetimeCreditsPurchased: number;
  lifetimeCreditsReversed: number;
  overageEnabled: boolean;
  overageUnits: number;
  billingHold: boolean;
  paddleCustomerId: string | null;
  paddleSubscriptionId: string | null;
  subscriptionCancelAt: string | null;
  updatedAt: string | null;
};

export const EMPTY_BILLING_ACCOUNT: Omit<FoundationBillingAccount, "workspaceKey" | "userId"> = {
  accessPlan: null,
  planCode: null,
  subscriptionStatus: "inactive",
  creditBalance: 0,
  lifetimeCreditsPurchased: 0,
  lifetimeCreditsReversed: 0,
  overageEnabled: false,
  overageUnits: 0,
  billingHold: false,
  paddleCustomerId: null,
  paddleSubscriptionId: null,
  subscriptionCancelAt: null,
  updatedAt: null,
};

async function reportBillingStoreFailure(stage: "intent" | "projection" | "schedule", response: Response) {
  let databaseCode = "unknown";
  let databaseMessage = "unavailable";
  try {
    const body = await response.json() as { code?: unknown; message?: unknown };
    if (typeof body.code === "string" && /^[A-Z0-9_]{1,32}$/i.test(body.code)) databaseCode = body.code;
    if (typeof body.message === "string" && /^[A-Z0-9_ .:(),-]{1,200}$/i.test(body.message)) {
      databaseMessage = body.message;
    }
  } catch {
    // Keep diagnostics bounded and secret-free when PostgREST does not return JSON.
  }
  console.error("foundation_billing_store_failure", {
    stage,
    status: response.status,
    databaseCode,
    databaseMessage,
  });
}

function normalizeAccount(row: Record<string, unknown>, workspaceKey: string, userId: string): FoundationBillingAccount {
  return {
    workspaceKey,
    userId,
    accessPlan: typeof row.access_plan === "string" ? row.access_plan : null,
    planCode: typeof row.plan_code === "string" ? row.plan_code : null,
    subscriptionStatus: typeof row.subscription_status === "string" ? row.subscription_status : "inactive",
    creditBalance: typeof row.credit_balance === "number" ? row.credit_balance : 0,
    lifetimeCreditsPurchased: typeof row.lifetime_credits_purchased === "number" ? row.lifetime_credits_purchased : 0,
    lifetimeCreditsReversed: typeof row.lifetime_credits_reversed === "number" ? row.lifetime_credits_reversed : 0,
    overageEnabled: row.overage_enabled === true,
    overageUnits: typeof row.overage_units === "number" ? row.overage_units : 0,
    billingHold: row.billing_hold === true,
    paddleCustomerId: typeof row.paddle_customer_id === "string" ? row.paddle_customer_id : null,
    paddleSubscriptionId: typeof row.paddle_subscription_id === "string" ? row.paddle_subscription_id : null,
    subscriptionCancelAt: typeof row.subscription_cancel_at === "string" ? row.subscription_cancel_at : null,
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
  };
}

const ACCOUNT_COLUMNS = "workspace_key,user_id,access_plan,plan_code,subscription_status,credit_balance,lifetime_credits_purchased,lifetime_credits_reversed,overage_enabled,overage_units,billing_hold,paddle_customer_id,paddle_subscription_id,subscription_cancel_at,updated_at";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type BillingAccountRead =
  | { ok: true; account: FoundationBillingAccount }
  | { ok: false; code: string };

/**
 * The billing account a caller draws on in a workspace. `account.userId` is the PAYER: the caller
 * for an account of their own; for an active admin or member (WO-C-T2) the holder of the workspace's
 * account, or its active owner when it has none -- so a reader tells the two apart by
 * `account.userId !== userId`. The same rule as foundation_workspace_payer (20261123120000).
 *
 * The caller's own account is read exactly as before. Only when there is none, in a workspace that is
 * not the caller's own (`foundationWorkspaceId`), is their membership read: an active admin or member
 * draws on the workspace's account. Two accounts, or no account and no single active owner, is an
 * integrity failure, never an empty plan. Without an active admin or member row the answer is the
 * empty account it always was.
 */
export async function getFoundationBillingAccount(workspaceKey: string, userId: string): Promise<BillingAccountRead> {
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false as const, code: "BILLING_STORE_NOT_CONFIGURED" };
  const query = new URLSearchParams({
    select: ACCOUNT_COLUMNS,
    workspace_key: `eq.${workspaceKey}`,
    user_id: `eq.${userId}`,
    limit: "1",
  });
  let response: Response;
  try {
    response = await supabaseAdminRequest(config, `/rest/v1/foundation_billing_accounts?${query}`);
  } catch {
    return { ok: false as const, code: "BILLING_STORE_READ_FAILED" };
  }
  if (!response.ok) return { ok: false as const, code: "BILLING_STORE_READ_FAILED" };
  const rows = await response.json() as Array<Record<string, unknown>>;
  if (rows[0]) return { ok: true as const, account: normalizeAccount(rows[0], workspaceKey, userId) };
  if (workspaceKey === foundationWorkspaceId(userId)) {
    return { ok: true as const, account: { workspaceKey, userId, ...EMPTY_BILLING_ACCOUNT } };
  }
  return getMemberWorkspaceAccount(config, workspaceKey, userId);
}

async function readRows(config: NonNullable<ReturnType<typeof readSupabaseAdminConfig>>, path: string) {
  try {
    const response = await supabaseAdminRequest(config, path);
    if (!response.ok) return null;
    const rows: unknown = await response.json().catch(() => null);
    return Array.isArray(rows) ? rows as Array<Record<string, unknown>> : null;
  } catch {
    return null;
  }
}

async function getMemberWorkspaceAccount(
  config: NonNullable<ReturnType<typeof readSupabaseAdminConfig>>,
  workspaceKey: string,
  userId: string,
): Promise<BillingAccountRead> {
  // The membership row is read directly (WO-C-T1's resolver is not on this base).
  const actor = await getWorkspaceMembership(workspaceKey, userId);
  if (!actor.ok) return { ok: false, code: actor.code };
  if (!actor.membership || actor.membership.state !== "active" || actor.membership.role === "owner") {
    return { ok: true, account: { workspaceKey, userId, ...EMPTY_BILLING_ACCOUNT } };
  }
  // The payer is the holder of the workspace's account, the user foundation_workspace_capped_plan
  // (20261117160000) reads; a workspace with no account answers to its active owner.
  const accounts = await readRows(config, `/rest/v1/foundation_billing_accounts?${new URLSearchParams({
    select: ACCOUNT_COLUMNS,
    workspace_key: `eq.${workspaceKey}`,
    limit: "2",
  })}`);
  if (!accounts) return { ok: false, code: "BILLING_STORE_READ_FAILED" };
  if (accounts.length > 0) {
    const row = accounts[0];
    if (accounts.length > 1 || row.workspace_key !== workspaceKey
      || typeof row.user_id !== "string" || !UUID.test(row.user_id)) {
      return { ok: false, code: "BILLING_ACCOUNT_INTEGRITY_FAILED" };
    }
    return { ok: true, account: normalizeAccount(row, workspaceKey, row.user_id) };
  }
  const owners = await readRows(config, `/rest/v1/foundation_workspace_members?${new URLSearchParams({
    select: "user_id",
    workspace_key: `eq.${workspaceKey}`,
    role: "eq.owner",
    state: "eq.active",
    limit: "2",
  })}`);
  if (!owners) return { ok: false, code: "BILLING_STORE_READ_FAILED" };
  const ownerId = owners.length === 1 && typeof owners[0].user_id === "string" && UUID.test(owners[0].user_id)
    ? owners[0].user_id : null;
  if (!ownerId) return { ok: false, code: "BILLING_ACCOUNT_PAYER_UNRESOLVED" };
  return { ok: true, account: { workspaceKey, userId: ownerId, ...EMPTY_BILLING_ACCOUNT } };
}

/**
 * The latest subscription payment the billing projection granted to this workspace: the newest
 * `transaction.completed` it recorded as `allowance_granted`. Its allowance rows carry no
 * subscription id (20260911130000), and a workspace holds one subscription at a time, so the
 * workspace and payer identify it. `paidAt` is null when none is recorded. A failed read says so.
 */
export async function getLatestSubscriptionPayment(workspaceKey: string, userId: string) {
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false as const, code: "BILLING_STORE_NOT_CONFIGURED" };
  const query = new URLSearchParams({
    select: "occurred_at",
    workspace_key: `eq.${workspaceKey}`,
    user_id: `eq.${userId}`,
    event_type: "eq.transaction.completed",
    processing_result: "eq.allowance_granted",
    order: "occurred_at.desc",
    limit: "1",
  });
  try {
    const response = await supabaseAdminRequest(config, `/rest/v1/foundation_billing_events?${query}`);
    if (!response.ok) return { ok: false as const, code: "BILLING_STORE_READ_FAILED" };
    const rows = await response.json() as Array<Record<string, unknown>>;
    const occurredAt = rows[0]?.occurred_at;
    return { ok: true as const, paidAt: typeof occurredAt === "string" ? occurredAt : null };
  } catch {
    return { ok: false as const, code: "BILLING_STORE_READ_FAILED" };
  }
}

/**
 * Records what the checkout route authorized, while it is authorized: the binding's nonce and
 * the price and credits offered. The webhook settles a new binding from this row, so a gate that
 * closes or a price id that rotates after the buyer reached Paddle cannot drop their payment.
 */
export async function issueFoundationCheckoutIntent(
  binding: CheckoutBinding,
  offer: Pick<BillingOffer, "priceId" | "credits">,
) {
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false as const, code: "BILLING_STORE_NOT_CONFIGURED" };
  let response: Response;
  try {
    response = await supabaseAdminRequest(config, "/rest/v1/rpc/issue_foundation_checkout_intent", {
      method: "POST",
      body: JSON.stringify({
        p_nonce: binding.tavonel_nonce,
        p_workspace_key: binding.tavonel_workspace_id,
        p_user_id: binding.tavonel_user_id,
        p_offer_code: binding.tavonel_offer_code,
        p_policy_version: binding.tavonel_policy_version,
        p_price_id: offer.priceId,
        p_credit_delta: offer.credits,
        p_issued_at: binding.tavonel_issued_at,
      }),
    });
  } catch {
    return { ok: false as const, code: "BILLING_INTENT_UNAVAILABLE" };
  }
  if (!response.ok) {
    await reportBillingStoreFailure("intent", response);
    return { ok: false as const, code: "BILLING_INTENT_UNAVAILABLE" };
  }
  const result = await response.json() as Record<string, unknown>;
  if (result.status === "issued") return { ok: true as const };
  return {
    ok: false as const,
    code: result.reason === "checkout_account_billing_exempt" ? "OWNER_ACCESS_ACTIVE" : "BILLING_INTENT_UNAVAILABLE",
  };
}

/** Persist a signed provider event that cannot be mapped to a customer binding. */
export async function quarantineFoundationBillingEnvelope(
  action: Extract<PaddleBillingAction, { action: "ignored" }>,
) {
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false as const, code: "BILLING_STORE_NOT_CONFIGURED" };
  let response: Response;
  try {
    response = await supabaseAdminRequest(config, "/rest/v1/rpc/quarantine_foundation_billing_envelope", {
      method: "POST",
      body: JSON.stringify({
        p_event_id: action.eventId,
        p_event_type: action.eventType,
        p_occurred_at: action.occurredAt,
        p_payload_sha256: action.payloadSha256,
        p_reason: action.reason,
      }),
    });
  } catch {
    return { ok: false as const, code: "BILLING_QUARANTINE_FAILED" };
  }
  if (!response.ok) {
    await reportBillingStoreFailure("projection", response);
    return { ok: false as const, code: "BILLING_QUARANTINE_FAILED" };
  }
  const result = await response.json() as Record<string, unknown>;
  return result.status === "binding_rejected"
    ? { ok: true as const }
    : { ok: false as const, code: "BILLING_QUARANTINE_FAILED" };
}

export async function applyFoundationBillingAction(action: Exclude<PaddleBillingAction, { action: "ignored" }>) {
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false as const, code: "BILLING_STORE_NOT_CONFIGURED" };
  const isReversal = action.action === "reversal";
  let response: Response;
  try {
    // No checkout policy is read here: a new binding is judged against the intent the checkout
    // route recorded while the gate was open (apply_foundation_billing_event_v6).
    response = await supabaseAdminRequest(config, "/rest/v1/rpc/apply_foundation_billing_event_v6", {
      method: "POST",
      body: JSON.stringify({
        p_event_id: action.eventId,
        p_event_type: action.eventType,
        p_occurred_at: action.occurredAt,
        p_payload_sha256: action.payloadSha256,
        p_action: action.action,
        p_workspace_key: isReversal ? null : action.workspaceId,
        p_user_id: isReversal ? null : action.userId,
        p_offer_code: isReversal ? null : action.offerCode,
        p_transaction_id: action.action === "purchase" || action.action === "allowance" || isReversal ? action.transactionId : null,
        p_customer_id: isReversal ? null : action.customerId,
        p_subscription_id: isReversal ? null : action.subscriptionId,
        p_subscription_status: action.action === "subscription" ? action.subscriptionStatus : null,
        p_adjustment_id: isReversal ? action.adjustmentId : null,
        p_binding_nonce: isReversal ? null : action.checkoutBindingNonce,
        p_binding_issued_at: isReversal ? null : action.checkoutBindingIssuedAt,
        p_binding_policy_version: isReversal ? null : action.checkoutBindingPolicyVersion,
        p_price_id: isReversal ? null : action.priceId,
        p_configured_credit_delta: isReversal ? null : action.configuredCreditDelta,
      }),
    });
  } catch {
    return { ok: false as const, code: "BILLING_EVENT_APPLY_FAILED" };
  }
  if (!response.ok) {
    await reportBillingStoreFailure("projection", response);
    return { ok: false as const, code: "BILLING_EVENT_APPLY_FAILED" };
  }
  const result = await response.json() as Record<string, unknown>;
  if (result.status === "binding_rejected") return { ok: true as const, result };
  if (action.action === "subscription") {
    try {
      response = await supabaseAdminRequest(config, "/rest/v1/rpc/apply_foundation_subscription_schedule", {
        method: "POST",
        body: JSON.stringify({
          p_event_id: action.eventId,
          p_workspace_key: action.workspaceId,
          p_subscription_id: action.subscriptionId,
          p_subscription_cancel_at: action.subscriptionCancelAt,
        }),
      });
    } catch {
      return { ok: false as const, code: "BILLING_EVENT_APPLY_FAILED" };
    }
    if (!response.ok) {
      await reportBillingStoreFailure("schedule", response);
      return { ok: false as const, code: "BILLING_EVENT_APPLY_FAILED" };
    }
  }
  return { ok: true as const, result };
}
