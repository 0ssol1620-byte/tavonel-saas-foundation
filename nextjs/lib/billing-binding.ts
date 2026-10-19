import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { isBillingOfferCode, type BillingOfferCode } from "./billing-catalog";

export type CheckoutBinding = {
  tavonel_binding_version: "v2" | "v3";
  tavonel_user_id: string;
  tavonel_workspace_id: string;
  tavonel_offer_code: BillingOfferCode;
  tavonel_nonce: string;
  tavonel_issued_at: string;
  tavonel_policy_version: string;
  tavonel_binding: string;
};

export const CHECKOUT_BINDING_MAX_AGE_MS = 15 * 60 * 1_000;
export const CHECKOUT_BINDING_POLICY_VERSION = "checkout-v1";
const CHECKOUT_POLICY_VERSION = /^checkout-v[1-9][0-9]*$/;

function bindingPayload(value: Omit<CheckoutBinding, "tavonel_binding">) {
  const fields = [
    value.tavonel_binding_version,
    value.tavonel_user_id,
    value.tavonel_workspace_id,
    value.tavonel_offer_code,
    value.tavonel_nonce,
    value.tavonel_issued_at,
  ];
  if (value.tavonel_binding_version === "v3") fields.push(value.tavonel_policy_version);
  return fields.join("\0");
}

function signature(value: Omit<CheckoutBinding, "tavonel_binding">, secret: string) {
  return createHmac("sha256", secret).update(bindingPayload(value), "utf8").digest("hex");
}

function signedWith(binding: CheckoutBinding, secret: string) {
  const expected = Buffer.from(signature(binding, secret), "hex");
  const received = Buffer.from(binding.tavonel_binding, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

/**
 * The verification-only key of a FOUNDATION_BILLING_HMAC rotation (journey map D-06, A6): the
 * replaced key, kept so metadata Paddle stored under it still authenticates until it is removed.
 * Nothing signs with it -- createCheckoutBinding and the trial device token take only the current
 * key. Absent, blank or shorter than a qualified key, it is not configured and changes nothing.
 */
export function previousBillingHmac(env: Readonly<Record<string, string | undefined>> = process.env) {
  const previous = env.FOUNDATION_BILLING_HMAC_PREVIOUS?.trim() ?? "";
  return previous.length >= 32 ? previous : undefined;
}

export function createCheckoutBinding(
  input: { userId: string; workspaceId: string; offerCode: BillingOfferCode },
  secret: string,
  now = new Date(),
): CheckoutBinding {
  if (secret.length < 32 || !Number.isFinite(now.getTime())) throw new Error("billing_binding_secret_unqualified");
  const unsigned = {
    tavonel_binding_version: "v3" as const,
    tavonel_user_id: input.userId,
    tavonel_workspace_id: input.workspaceId,
    tavonel_offer_code: input.offerCode,
    tavonel_nonce: randomUUID(),
    tavonel_issued_at: now.toISOString(),
    tavonel_policy_version: CHECKOUT_BINDING_POLICY_VERSION,
  };
  return { ...unsigned, tavonel_binding: signature(unsigned, secret) };
}

/**
 * Authenticates durable provider metadata without requiring the original checkout to remain fresh.
 * `previousSecret` is tried only after the current key fails, and never stands in for a missing one.
 */
export function authenticateCheckoutBinding(
  value: unknown,
  secret: string | undefined,
  previousSecret?: string,
): CheckoutBinding | null {
  if (!value || typeof value !== "object" || !secret || secret.length < 32) return null;
  const input = value as Record<string, unknown>;
  if (
    (input.tavonel_binding_version !== "v2" && input.tavonel_binding_version !== "v3") ||
    typeof input.tavonel_user_id !== "string" ||
    !/^[a-f0-9-]{36}$/i.test(input.tavonel_user_id) ||
    typeof input.tavonel_workspace_id !== "string" ||
    !/^pilot-[a-zA-Z0-9]{1,16}$/.test(input.tavonel_workspace_id) ||
    !isBillingOfferCode(input.tavonel_offer_code) ||
    typeof input.tavonel_nonce !== "string" ||
    !/^[a-f0-9-]{36}$/i.test(input.tavonel_nonce) ||
    typeof input.tavonel_issued_at !== "string" ||
    (input.tavonel_binding_version === "v3" && (
      typeof input.tavonel_policy_version !== "string" ||
      !CHECKOUT_POLICY_VERSION.test(input.tavonel_policy_version)
    )) ||
    typeof input.tavonel_binding !== "string" ||
    !/^[a-f0-9]{64}$/i.test(input.tavonel_binding)
  ) {
    return null;
  }
  const signedBinding = input as CheckoutBinding;
  if (!signedWith(signedBinding, secret) &&
    !(previousSecret && previousSecret.length >= 32 && signedWith(signedBinding, previousSecret))) return null;
  return input.tavonel_binding_version === "v2"
    ? { ...signedBinding, tavonel_policy_version: "legacy-v2" }
    : signedBinding;
}

export function isCheckoutBindingFresh(binding: CheckoutBinding, at: Date) {
  const issuedAtMs = Date.parse(binding.tavonel_issued_at);
  const atMs = at.getTime();
  return Number.isFinite(issuedAtMs)
    && Number.isFinite(atMs)
    && issuedAtMs <= atMs
    && atMs - issuedAtMs <= CHECKOUT_BINDING_MAX_AGE_MS
    && binding.tavonel_binding_version === "v3"
    && binding.tavonel_policy_version === CHECKOUT_BINDING_POLICY_VERSION;
}

export function verifyCheckoutBinding(
  value: unknown,
  secret: string | undefined,
  now = new Date(),
): CheckoutBinding | null {
  const binding = authenticateCheckoutBinding(value, secret);
  return binding && isCheckoutBindingFresh(binding, now) ? binding : null;
}
