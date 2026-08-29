import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { isBillingOfferCode, type BillingOfferCode } from "./billing-catalog";

export type CheckoutBinding = {
  tavonel_binding_version: "v1";
  tavonel_user_id: string;
  tavonel_workspace_id: string;
  tavonel_offer_code: BillingOfferCode;
  tavonel_nonce: string;
  tavonel_binding: string;
};

function bindingPayload(value: Omit<CheckoutBinding, "tavonel_binding">) {
  return [
    value.tavonel_binding_version,
    value.tavonel_user_id,
    value.tavonel_workspace_id,
    value.tavonel_offer_code,
    value.tavonel_nonce,
  ].join("\0");
}

function signature(value: Omit<CheckoutBinding, "tavonel_binding">, secret: string) {
  return createHmac("sha256", secret).update(bindingPayload(value), "utf8").digest("hex");
}

export function createCheckoutBinding(
  input: { userId: string; workspaceId: string; offerCode: BillingOfferCode },
  secret: string,
): CheckoutBinding {
  if (secret.length < 32) throw new Error("billing_binding_secret_unqualified");
  const unsigned = {
    tavonel_binding_version: "v1" as const,
    tavonel_user_id: input.userId,
    tavonel_workspace_id: input.workspaceId,
    tavonel_offer_code: input.offerCode,
    tavonel_nonce: randomUUID(),
  };
  return { ...unsigned, tavonel_binding: signature(unsigned, secret) };
}

export function verifyCheckoutBinding(value: unknown, secret: string | undefined): CheckoutBinding | null {
  if (!value || typeof value !== "object" || !secret || secret.length < 32) return null;
  const input = value as Record<string, unknown>;
  if (
    input.tavonel_binding_version !== "v1" ||
    typeof input.tavonel_user_id !== "string" ||
    !/^[a-f0-9-]{36}$/i.test(input.tavonel_user_id) ||
    typeof input.tavonel_workspace_id !== "string" ||
    !/^pilot-[a-zA-Z0-9]{1,16}$/.test(input.tavonel_workspace_id) ||
    !isBillingOfferCode(input.tavonel_offer_code) ||
    typeof input.tavonel_nonce !== "string" ||
    !/^[a-f0-9-]{36}$/i.test(input.tavonel_nonce) ||
    typeof input.tavonel_binding !== "string" ||
    !/^[a-f0-9]{64}$/i.test(input.tavonel_binding)
  ) {
    return null;
  }
  const binding = input as CheckoutBinding;
  const expected = Buffer.from(signature(binding, secret), "hex");
  const received = Buffer.from(binding.tavonel_binding, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected) ? binding : null;
}
