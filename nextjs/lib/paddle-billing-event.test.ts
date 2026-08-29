import { describe, expect, it } from "vitest";
import { createCheckoutBinding } from "./billing-binding";
import { parsePaddleBillingAction } from "./paddle-billing-event";

const SECRET = "billing-test-secret-that-is-at-least-32-characters";
const STARTER_PRICE = `pri_${"p".repeat(26)}`;
const OBSERVER_PRICE = `pri_${"o".repeat(26)}`;
const env = {
  FOUNDATION_BILLING_HMAC: SECRET,
  PADDLE_PRICE_CREDIT_STARTER: STARTER_PRICE,
  PADDLE_PRICE_OBSERVER_ACCESS: OBSERVER_PRICE,
};
const bindingInput = {
  userId: "969dc192-daa2-4119-969d-c192daa24119",
  workspaceId: "pilot-969dc192daa24119",
} as const;

function body(eventType: string, data: Record<string, unknown>, eventCharacter = "e") {
  return JSON.stringify({
    event_id: `evt_${eventCharacter.repeat(26)}`,
    event_type: eventType,
    occurred_at: "2026-08-29T07:00:00.000Z",
    data,
  });
}

describe("Paddle billing event projection", () => {
  it("issues prepaid credits only for the signed binding and allow-listed price", () => {
    const binding = createCheckoutBinding({ ...bindingInput, offerCode: "credit_starter" }, SECRET);
    const action = parsePaddleBillingAction(body("transaction.paid", {
      id: `txn_${"t".repeat(26)}`,
      customer_id: `ctm_${"c".repeat(26)}`,
      custom_data: binding,
      items: [{ quantity: 1, price: { id: STARTER_PRICE } }],
    }), env);
    expect(action).toMatchObject({
      action: "purchase",
      offerCode: "credit_starter",
      creditDelta: 100,
      workspaceId: bindingInput.workspaceId,
    });

    const tampered = parsePaddleBillingAction(body("transaction.paid", {
      id: `txn_${"t".repeat(26)}`,
      customer_id: `ctm_${"c".repeat(26)}`,
      custom_data: { ...binding, tavonel_offer_code: "credit_scale" },
      items: [{ quantity: 1, price: { id: STARTER_PRICE } }],
    }, "f"), env);
    expect(tampered).toMatchObject({ action: "ignored", reason: "binding_invalid" });
  });

  it.each([
    ["subscription.activated", "active"],
    ["subscription.past_due", "past_due"],
    ["subscription.trialing", "trialing"],
    ["subscription.updated", "active"],
  ])("projects %s without recurring GPU credits", (eventType, status) => {
    const binding = createCheckoutBinding({ ...bindingInput, offerCode: "observer_access" }, SECRET);
    expect(parsePaddleBillingAction(body(eventType, {
      id: `sub_${"s".repeat(26)}`,
      customer_id: `ctm_${"c".repeat(26)}`,
      status,
      custom_data: binding,
      items: [{ quantity: 1, price: { id: OBSERVER_PRICE } }],
    }), env)).toMatchObject({ action: "subscription", offerCode: "observer_access", subscriptionStatus: status });
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
