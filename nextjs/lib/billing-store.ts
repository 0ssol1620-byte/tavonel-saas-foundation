import type { PaddleBillingAction } from "./paddle-billing-event";
import type { CheckoutBinding } from "./billing-binding";
import type { BillingOffer } from "./billing-catalog";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";

export type FoundationBillingAccount = {
  workspaceKey: string;
  userId: string;
  accessPlan: string | null;
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

export async function getFoundationBillingAccount(workspaceKey: string, userId: string) {
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false as const, code: "BILLING_STORE_NOT_CONFIGURED" };
  const query = new URLSearchParams({
    select: "workspace_key,user_id,access_plan,subscription_status,credit_balance,lifetime_credits_purchased,lifetime_credits_reversed,overage_enabled,overage_units,billing_hold,paddle_customer_id,paddle_subscription_id,subscription_cancel_at,updated_at",
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
