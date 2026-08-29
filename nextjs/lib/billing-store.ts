import type { PaddleBillingAction } from "./paddle-billing-event";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";

export type FoundationBillingAccount = {
  workspaceKey: string;
  userId: string;
  accessPlan: string | null;
  subscriptionStatus: string;
  creditBalance: number;
  lifetimeCreditsPurchased: number;
  lifetimeCreditsReversed: number;
  billingHold: boolean;
  paddleCustomerId: string | null;
  paddleSubscriptionId: string | null;
  subscriptionCancelAt: string | null;
  updatedAt: string | null;
};

export const EMPTY_BILLING_ACCOUNT: Omit<FoundationBillingAccount, "workspaceKey" | "userId"> = {
  accessPlan: null,
  subscriptionStatus: "inactive",
  creditBalance: 0,
  lifetimeCreditsPurchased: 0,
  lifetimeCreditsReversed: 0,
  billingHold: false,
  paddleCustomerId: null,
  paddleSubscriptionId: null,
  subscriptionCancelAt: null,
  updatedAt: null,
};

function normalizeAccount(row: Record<string, unknown>, workspaceKey: string, userId: string): FoundationBillingAccount {
  return {
    workspaceKey,
    userId,
    accessPlan: typeof row.access_plan === "string" ? row.access_plan : null,
    subscriptionStatus: typeof row.subscription_status === "string" ? row.subscription_status : "inactive",
    creditBalance: typeof row.credit_balance === "number" ? row.credit_balance : 0,
    lifetimeCreditsPurchased: typeof row.lifetime_credits_purchased === "number" ? row.lifetime_credits_purchased : 0,
    lifetimeCreditsReversed: typeof row.lifetime_credits_reversed === "number" ? row.lifetime_credits_reversed : 0,
    billingHold: row.billing_hold === true,
    paddleCustomerId: typeof row.paddle_customer_id === "string" ? row.paddle_customer_id : null,
    paddleSubscriptionId: typeof row.paddle_subscription_id === "string" ? row.paddle_subscription_id : null,
    subscriptionCancelAt: typeof row.subscription_cancel_at === "string" ? row.subscription_cancel_at : null,
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
  };
}

export async function getFoundationBillingAccount(workspaceKey: string, userId: string) {
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false as const, code: "BILLING_STORE_NOT_CONFIGURED" };
  const query = new URLSearchParams({
    select: "workspace_key,user_id,access_plan,subscription_status,credit_balance,lifetime_credits_purchased,lifetime_credits_reversed,billing_hold,paddle_customer_id,paddle_subscription_id,subscription_cancel_at,updated_at",
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
  return {
    ok: true as const,
    account: rows[0]
      ? normalizeAccount(rows[0], workspaceKey, userId)
      : { workspaceKey, userId, ...EMPTY_BILLING_ACCOUNT },
  };
}

export async function applyFoundationBillingAction(action: Exclude<PaddleBillingAction, { action: "ignored" }>) {
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false as const, code: "BILLING_STORE_NOT_CONFIGURED" };
  const isReversal = action.action === "reversal";
  let response: Response;
  try {
    response = await supabaseAdminRequest(config, "/rest/v1/rpc/apply_foundation_billing_event", {
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
        p_transaction_id: action.action === "purchase" || isReversal ? action.transactionId : null,
        p_customer_id: isReversal ? null : action.customerId,
        p_subscription_id: action.action === "subscription" ? action.subscriptionId : null,
        p_subscription_status: action.action === "subscription" ? action.subscriptionStatus : null,
        p_credit_delta: action.action === "purchase" ? action.creditDelta : 0,
        p_adjustment_id: isReversal ? action.adjustmentId : null,
      }),
    });
  } catch {
    return { ok: false as const, code: "BILLING_EVENT_APPLY_FAILED" };
  }
  if (!response.ok) return { ok: false as const, code: "BILLING_EVENT_APPLY_FAILED" };
  const result = await response.json() as Record<string, unknown>;
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
    if (!response.ok) return { ok: false as const, code: "BILLING_EVENT_APPLY_FAILED" };
  }
  return { ok: true as const, result };
}
