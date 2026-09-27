import { createHmac, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createCheckoutBinding } from "./billing-binding";
import { parsePaddleBillingAction } from "./paddle-billing-event";

const SECRET = "billing-test-secret-that-is-at-least-32-characters";
const OBSERVER_PRICE = `pri_${"o".repeat(26)}`;
const EVENT_AT = "2026-08-29T07:00:00.000Z";
const env = {
  FOUNDATION_BILLING_HMAC: SECRET,
  PADDLE_PRICE_OBSERVER_ACCESS: OBSERVER_PRICE,
};
const bindingInput = {
  userId: "969dc192-daa2-4119-969d-c192daa24119",
  workspaceId: "pilot-969dc192daa24119",
} as const;

function checkoutBinding(issuedAt = new Date(EVENT_AT)) {
  return createCheckoutBinding({ ...bindingInput, offerCode: "observer_access" }, SECRET, issuedAt);
}

function legacyCheckoutBinding() {
  const unsigned = {
    tavonel_binding_version: "v2",
    tavonel_user_id: bindingInput.userId,
    tavonel_workspace_id: bindingInput.workspaceId,
    tavonel_offer_code: "observer_access",
    tavonel_nonce: randomUUID(),
    tavonel_issued_at: EVENT_AT,
  };
  return {
    ...unsigned,
    tavonel_binding: createHmac("sha256", SECRET)
      .update(Object.values(unsigned).join("\0"), "utf8")
      .digest("hex"),
  };
}

function body(eventType: string, data: Record<string, unknown>, eventCharacter = "e") {
  return JSON.stringify({
    event_id: `evt_${eventCharacter.repeat(26)}`,
    event_type: eventType,
    occurred_at: EVENT_AT,
    data,
  });
}

describe("Paddle billing event projection", () => {
  it("grants recurring allowance only for the signed binding and allow-listed price", () => {
    const binding = checkoutBinding();
    const action = parsePaddleBillingAction(body("transaction.completed", {
      id: `txn_${"t".repeat(26)}`,
      customer_id: `ctm_${"c".repeat(26)}`,
      subscription_id: `sub_${"s".repeat(26)}`,
      custom_data: binding,
      items: [{ quantity: 1, price: { id: OBSERVER_PRICE } }],
    }), env);
    expect(action).toMatchObject({
      action: "allowance",
      offerCode: "observer_access",
      priceId: OBSERVER_PRICE,
      configuredCreditDelta: 2_000,
      workspaceId: bindingInput.workspaceId,
      checkoutBindingNonce: binding.tavonel_nonce,
    });

    const tampered = parsePaddleBillingAction(body("transaction.completed", {
      id: `txn_${"t".repeat(26)}`,
      customer_id: `ctm_${"c".repeat(26)}`,
      subscription_id: `sub_${"s".repeat(26)}`,
      custom_data: { ...binding, tavonel_offer_code: "studio_access" },
      items: [{ quantity: 1, price: { id: OBSERVER_PRICE } }],
    }, "f"), env);
    expect(tampered).toMatchObject({ action: "ignored", reason: "binding_invalid" });
  });

  it("does not grant included usage before Paddle completes the transaction", () => {
    const binding = checkoutBinding();
    expect(parsePaddleBillingAction(body("transaction.paid", {
      id: `txn_${"t".repeat(26)}`,
      customer_id: `ctm_${"c".repeat(26)}`,
      custom_data: binding,
      items: [{ quantity: 1, price: { id: OBSERVER_PRICE } }],
    }), env)).toMatchObject({ action: "ignored", reason: "event_not_entitling" });
  });

  it("grants one included-usage allowance from each completed subscription transaction", () => {
    const binding = checkoutBinding();
    expect(parsePaddleBillingAction(body("transaction.completed", {
      id: `txn_${"r".repeat(26)}`,
      customer_id: `ctm_${"c".repeat(26)}`,
      subscription_id: `sub_${"s".repeat(26)}`,
      custom_data: binding,
      items: [{ quantity: 1, price: { id: OBSERVER_PRICE } }],
    }), env)).toMatchObject({
      action: "allowance",
      offerCode: "observer_access",
      configuredCreditDelta: 2_000,
      transactionId: `txn_${"r".repeat(26)}`,
    });
  });

  it("forwards a paid transaction whose price was rotated out of configuration after checkout", () => {
    const binding = checkoutBinding();
    const rotatedEnv = { ...env, PADDLE_PRICE_OBSERVER_ACCESS: `pri_${"n".repeat(26)}` };
    expect(parsePaddleBillingAction(body("transaction.completed", {
      id: `txn_${"t".repeat(26)}`,
      customer_id: `ctm_${"c".repeat(26)}`,
      subscription_id: `sub_${"s".repeat(26)}`,
      custom_data: binding,
      items: [{ quantity: 1, price: { id: OBSERVER_PRICE } }],
    }), rotatedEnv)).toMatchObject({
      action: "allowance",
      offerCode: "observer_access",
      priceId: OBSERVER_PRICE,
      configuredCreditDelta: null,
    });
  });

  it("does not credit another offer's configured price to the bound offer", () => {
    const studioPrice = `pri_${"s".repeat(26)}`;
    expect(parsePaddleBillingAction(body("transaction.completed", {
      id: `txn_${"t".repeat(26)}`,
      customer_id: `ctm_${"c".repeat(26)}`,
      subscription_id: `sub_${"s".repeat(26)}`,
      custom_data: checkoutBinding(),
      items: [{ quantity: 1, price: { id: studioPrice } }],
    }), { ...env, PADDLE_PRICE_STUDIO_ACCESS: studioPrice })).toMatchObject({
      action: "allowance",
      offerCode: "observer_access",
      priceId: studioPrice,
      configuredCreditDelta: null,
    });
  });

  it("ignores a transaction whose item is not a single well-formed price", () => {
    expect(parsePaddleBillingAction(body("transaction.completed", {
      id: `txn_${"t".repeat(26)}`,
      customer_id: `ctm_${"c".repeat(26)}`,
      subscription_id: `sub_${"s".repeat(26)}`,
      custom_data: checkoutBinding(),
      items: [{ quantity: 1, price: { id: "pri_not-a-price" } }],
    }), env)).toMatchObject({ action: "ignored", reason: "transaction_contract_invalid" });
  });

  it.each([
    ["subscription.activated", "active"],
    ["subscription.past_due", "past_due"],
    ["subscription.trialing", "trialing"],
    ["subscription.updated", "active"],
  ])("projects %s as access state without duplicating the transaction allowance", (eventType, status) => {
    const binding = checkoutBinding();
    expect(parsePaddleBillingAction(body(eventType, {
      id: `sub_${"s".repeat(26)}`,
      customer_id: `ctm_${"c".repeat(26)}`,
      status,
      custom_data: binding,
      items: [{ quantity: 1, price: { id: OBSERVER_PRICE } }],
    }), env)).toMatchObject({ action: "subscription", offerCode: "observer_access", subscriptionStatus: status });
  });

  it("projects a period-end cancellation without revoking active access", () => {
    const binding = checkoutBinding();
    expect(parsePaddleBillingAction(body("subscription.updated", {
      id: `sub_${"s".repeat(26)}`,
      customer_id: `ctm_${"c".repeat(26)}`,
      status: "active",
      scheduled_change: { action: "cancel", effective_at: "2026-09-29T10:04:40Z" },
      custom_data: binding,
      items: [{ quantity: 1, price: { id: OBSERVER_PRICE } }],
    }), env)).toMatchObject({
      action: "subscription",
      subscriptionStatus: "active",
      subscriptionCancelAt: "2026-09-29T10:04:40.000Z",
    });
  });

  it("rejects a malformed scheduled cancellation", () => {
    const binding = checkoutBinding();
    expect(parsePaddleBillingAction(body("subscription.updated", {
      id: `sub_${"s".repeat(26)}`,
      customer_id: `ctm_${"c".repeat(26)}`,
      status: "active",
      scheduled_change: { action: "cancel", effective_at: "not-a-date" },
      custom_data: binding,
      items: [{ quantity: 1, price: { id: OBSERVER_PRICE } }],
    }), env)).toMatchObject({ action: "ignored", reason: "subscription_contract_invalid" });
  });

  it("preserves an old authentic binding for stored-subscription reconciliation after a price rotation", () => {
    const binding = checkoutBinding(new Date("2026-06-29T06:44:59.999Z"));
    expect(parsePaddleBillingAction(body("subscription.canceled", {
      id: `sub_${"s".repeat(26)}`,
      customer_id: `ctm_${"c".repeat(26)}`,
      status: "canceled",
      custom_data: binding,
      items: [{ quantity: 1, price: { id: OBSERVER_PRICE } }],
    }), { ...env, PADDLE_PRICE_OBSERVER_ACCESS: `pri_${"n".repeat(26)}` })).toMatchObject({
      action: "subscription",
      subscriptionStatus: "canceled",
      checkoutBindingNonce: binding.tavonel_nonce,
      priceId: OBSERVER_PRICE,
      configuredCreditDelta: null,
    });
  });

  it("preserves authenticated v2 metadata for an existing subscription association only", () => {
    const binding = legacyCheckoutBinding();
    expect(parsePaddleBillingAction(body("subscription.updated", {
      id: `sub_${"s".repeat(26)}`,
      customer_id: `ctm_${"c".repeat(26)}`,
      status: "active",
      custom_data: binding,
      items: [{ quantity: 1, price: { id: OBSERVER_PRICE } }],
    }), env)).toMatchObject({
      action: "subscription",
      checkoutBindingPolicyVersion: "legacy-v2",
      checkoutBindingNonce: binding.tavonel_nonce,
    });
  });

  it("requires a subscription id before a completed subscription transaction can reach projection", () => {
    expect(parsePaddleBillingAction(body("transaction.completed", {
      id: `txn_${"t".repeat(26)}`,
      customer_id: `ctm_${"c".repeat(26)}`,
      custom_data: checkoutBinding(),
      items: [{ quantity: 1, price: { id: OBSERVER_PRICE } }],
    }), env)).toMatchObject({ action: "ignored", reason: "transaction_subscription_binding_invalid" });
  });

  it.each([
    ["adjustment.created", "refund"],
    ["adjustment.updated", "credit"],
    ["adjustment.created", "chargeback"],
    ["adjustment.created", "chargeback_warning"],
  ])("recognizes approved %s %s events for conservative credit reversal", (eventType, adjustmentAction) => {
    expect(parsePaddleBillingAction(body(eventType, {
      id: `adj_${"a".repeat(26)}`,
      transaction_id: `txn_${"t".repeat(26)}`,
      action: adjustmentAction,
      status: "approved",
    }), env)).toMatchObject({ action: "reversal", transactionId: `txn_${"t".repeat(26)}` });
  });

  it("does not reverse rejected or reversal adjustments automatically", () => {
    expect(parsePaddleBillingAction(body("adjustment.updated", {
      id: `adj_${"a".repeat(26)}`,
      transaction_id: `txn_${"t".repeat(26)}`,
      action: "refund",
      status: "rejected",
    }), env)).toMatchObject({ action: "ignored" });
    expect(parsePaddleBillingAction(body("adjustment.created", {
      id: `adj_${"b".repeat(26)}`,
      transaction_id: `txn_${"t".repeat(26)}`,
      action: "chargeback_reverse",
      status: "approved",
    }, "r"), env)).toMatchObject({ action: "ignored" });
  });
});
