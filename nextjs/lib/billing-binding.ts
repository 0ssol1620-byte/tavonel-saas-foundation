import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { isBillingOfferCode, type BillingOfferCode } from "./billing-catalog";

export type CheckoutBinding = {
  tavonel_binding_version: "v2";
  tavonel_user_id: string;
  tavonel_workspace_id: string;
  tavonel_offer_code: BillingOfferCode;
  tavonel_nonce: string;
  tavonel_issued_at: string;
  tavonel_binding: string;
};

export const CHECKOUT_BINDING_MAX_AGE_MS = 15 * 60 * 1_000;

function bindingPayload(value: Omit<CheckoutBinding, "tavonel_binding">) {
  return [
    value.tavonel_binding_version,
    value.tavonel_user_id,
    value.tavonel_workspace_id,
    value.tavonel_offer_code,
    value.tavonel_nonce,
    value.tavonel_issued_at,
  ].join("\0");
}

function signature(value: Omit<CheckoutBinding, "tavonel_binding">, secret: string) {
  return createHmac("sha256", secret).update(bindingPayload(value), "utf8").digest("hex");
}

export function createCheckoutBinding(
  input: { userId: string; workspaceId: string; offerCode: BillingOfferCode },
  secret: string,
  now = new Date(),
): CheckoutBinding {
  if (secret.length < 32 || !Number.isFinite(now.getTime())) throw new Error("billing_binding_secret_unqualified");
  const unsigned = {
    tavonel_binding_version: "v2" as const,
    tavonel_user_id: input.userId,
    tavonel_workspace_id: input.workspaceId,
    tavonel_offer_code: input.offerCode,
    tavonel_nonce: randomUUID(),
    tavonel_issued_at: now.toISOString(),
  };
  return { ...unsigned, tavonel_binding: signature(unsigned, secret) };
}

export function verifyCheckoutBinding(
  value: unknown,
  secret: string | undefined,
  now = new Date(),
): CheckoutBinding | null {
  if (!value || typeof value !== "object" || !secret || secret.length < 32) return null;
  const input = value as Record<string, unknown>;
  if (
    input.tavonel_binding_version !== "v2" ||
    typeof input.tavonel_user_id !== "string" ||
    !/^[a-f0-9-]{36}$/i.test(input.tavonel_user_id) ||
    typeof input.tavonel_workspace_id !== "string" ||
    !/^pilot-[a-zA-Z0-9]{1,16}$/.test(input.tavonel_workspace_id) ||
    !isBillingOfferCode(input.tavonel_offer_code) ||
    typeof input.tavonel_nonce !== "string" ||
    !/^[a-f0-9-]{36}$/i.test(input.tavonel_nonce) ||
    typeof input.tavonel_issued_at !== "string" ||
    typeof input.tavonel_binding !== "string" ||
    !/^[a-f0-9]{64}$/i.test(input.tavonel_binding)
  ) {
    return null;
  }
  const issuedAtMs = Date.parse(input.tavonel_issued_at);
  const nowMs = now.getTime();
  if (!Number.isFinite(issuedAtMs) || !Number.isFinite(nowMs)
    || issuedAtMs > nowMs || nowMs - issuedAtMs > CHECKOUT_BINDING_MAX_AGE_MS) return null;
  const binding = input as CheckoutBinding;
  const expected = Buffer.from(signature(binding, secret), "hex");
  const received = Buffer.from(binding.tavonel_binding, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected) ? binding : null;
}
