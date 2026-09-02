import { createHash } from "node:crypto";
import { findOfferByPriceId, type BillingOfferCode } from "./billing-catalog";
import { verifyCheckoutBinding } from "./billing-binding";

const EVENT_ID = /^evt_[a-z0-9]{26}$/;
const TRANSACTION_ID = /^txn_[a-z0-9]{26}$/;
const CUSTOMER_ID = /^ctm_[a-z0-9]{26}$/;
const SUBSCRIPTION_ID = /^sub_[a-z0-9]{26}$/;
const ADJUSTMENT_ID = /^adj_[a-z0-9]{26}$/;
const SUBSCRIPTION_EVENTS = new Set([
  "subscription.activated",
  "subscription.created",
  "subscription.updated",
  "subscription.canceled",
  "subscription.past_due",
  "subscription.paused",
  "subscription.resumed",
  "subscription.trialing",
]);
const SUBSCRIPTION_STATUSES = new Set(["trialing", "active", "past_due", "paused", "canceled", "inactive"]);
const ADJUSTMENT_EVENTS = new Set(["adjustment.created", "adjustment.updated"]);
const ADVERSE_ADJUSTMENT_ACTIONS = new Set(["credit", "refund", "chargeback", "chargeback_warning"]);

type CommonAction = {
  eventId: string;
  eventType: string;
  occurredAt: string;
  payloadSha256: string;
};

export type PaddleBillingAction =
  | (CommonAction & {
      action: "purchase";
      userId: string;
      workspaceId: string;
      offerCode: BillingOfferCode;
      transactionId: string;
      customerId: string;
      creditDelta: number;
    })
  | (CommonAction & {
      action: "subscription";
      userId: string;
      workspaceId: string;
      offerCode: BillingOfferCode;
      subscriptionId: string;
      customerId: string;
      subscriptionStatus: string;
      subscriptionCancelAt: string | null;
    })
  | (CommonAction & {
      action: "allowance";
      userId: string;
      workspaceId: string;
      offerCode: BillingOfferCode;
      transactionId: string;
      customerId: string;
      creditDelta: number;
    })
  | (CommonAction & {
      action: "reversal";
      transactionId: string;
      adjustmentId: string;
    })
  | (CommonAction & { action: "ignored"; reason: string });

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function eventEnvelope(rawBody: string) {
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (!isRecord(payload) || typeof payload.event_id !== "string" || !EVENT_ID.test(payload.event_id)) return null;
  if (typeof payload.event_type !== "string" || typeof payload.occurred_at !== "string") return null;
  if (!Number.isFinite(Date.parse(payload.occurred_at)) || !isRecord(payload.data)) return null;
  return {
    payload,
    data: payload.data,
    common: {
      eventId: payload.event_id,
      eventType: payload.event_type,
      occurredAt: new Date(payload.occurred_at).toISOString(),
      payloadSha256: `sha256:${createHash("sha256").update(rawBody, "utf8").digest("hex")}`,
    },
  };
}

function itemPriceIds(data: Record<string, unknown>) {
  if (!Array.isArray(data.items)) return [];
  return data.items.flatMap((item) => {
    if (!isRecord(item) || item.quantity !== 1 || !isRecord(item.price) || typeof item.price.id !== "string") return [];
    return [item.price.id];
  });
}

export function parsePaddleBillingAction(
  rawBody: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): PaddleBillingAction | null {
  const envelope = eventEnvelope(rawBody);
  if (!envelope) return null;
  const { data, common } = envelope;

  if (common.eventType === "transaction.completed") {
    const binding = verifyCheckoutBinding(data.custom_data, env.FOUNDATION_BILLING_HMAC);
    const transactionId = typeof data.id === "string" ? data.id : "";
    const customerId = typeof data.customer_id === "string" ? data.customer_id : "";
    const prices = itemPriceIds(data);
    if (!binding) return { ...common, action: "ignored", reason: "binding_invalid" };
    if (!TRANSACTION_ID.test(transactionId) || !CUSTOMER_ID.test(customerId) || prices.length !== 1) {
      return { ...common, action: "ignored", reason: "transaction_contract_invalid" };
    }
    const offer = findOfferByPriceId(prices[0], env);
    if (!offer || offer.code !== binding.tavonel_offer_code) {
      return { ...common, action: "ignored", reason: "transaction_price_not_allowed" };
    }
    if (offer.kind === "subscription") {
      return {
        ...common,
        action: "allowance",
        userId: binding.tavonel_user_id,
        workspaceId: binding.tavonel_workspace_id,
        offerCode: offer.code,
        transactionId,
        customerId,
        creditDelta: offer.credits,
      };
    }
    return {
      ...common,
      action: "purchase",
      userId: binding.tavonel_user_id,
      workspaceId: binding.tavonel_workspace_id,
      offerCode: offer.code,
      transactionId,
      customerId,
      creditDelta: offer.credits,
    };
  }

  if (SUBSCRIPTION_EVENTS.has(common.eventType)) {
    const binding = verifyCheckoutBinding(data.custom_data, env.FOUNDATION_BILLING_HMAC);
    const subscriptionId = typeof data.id === "string" ? data.id : "";
    const customerId = typeof data.customer_id === "string" ? data.customer_id : "";
    const status = typeof data.status === "string" ? data.status : "";
    let subscriptionCancelAt: string | null = null;
    if (data.scheduled_change !== null && data.scheduled_change !== undefined) {
      if (!isRecord(data.scheduled_change) || typeof data.scheduled_change.action !== "string") {
        return { ...common, action: "ignored", reason: "subscription_contract_invalid" };
      }
      if (data.scheduled_change.action === "cancel") {
        const effectiveAt = data.scheduled_change.effective_at;
        if (typeof effectiveAt !== "string" || !Number.isFinite(Date.parse(effectiveAt))) {
          return { ...common, action: "ignored", reason: "subscription_contract_invalid" };
        }
        subscriptionCancelAt = new Date(effectiveAt).toISOString();
      }
    }
    const prices = itemPriceIds(data);
    if (!binding) return { ...common, action: "ignored", reason: "binding_invalid" };
    if (!SUBSCRIPTION_ID.test(subscriptionId) || !CUSTOMER_ID.test(customerId) || !SUBSCRIPTION_STATUSES.has(status) || prices.length !== 1) {
      return { ...common, action: "ignored", reason: "subscription_contract_invalid" };
    }
    const offer = findOfferByPriceId(prices[0], env);
    if (!offer || offer.kind !== "subscription" || offer.code !== binding.tavonel_offer_code) {
      return { ...common, action: "ignored", reason: "subscription_price_not_allowed" };
    }
    return {
      ...common,
      action: "subscription",
      userId: binding.tavonel_user_id,
      workspaceId: binding.tavonel_workspace_id,
      offerCode: offer.code,
      subscriptionId,
      customerId,
      subscriptionStatus: status,
      subscriptionCancelAt,
    };
  }

  if (ADJUSTMENT_EVENTS.has(common.eventType)) {
    const adjustmentId = typeof data.id === "string" ? data.id : "";
    const transactionId = typeof data.transaction_id === "string" ? data.transaction_id : "";
    const action = typeof data.action === "string" ? data.action : "";
    const status = typeof data.status === "string" ? data.status : "";
    if (
      ADJUSTMENT_ID.test(adjustmentId) &&
      TRANSACTION_ID.test(transactionId) &&
      ADVERSE_ADJUSTMENT_ACTIONS.has(action) &&
      status === "approved"
    ) {
      return { ...common, action: "reversal", adjustmentId, transactionId };
    }
  }

  return { ...common, action: "ignored", reason: "event_not_entitling" };
}
