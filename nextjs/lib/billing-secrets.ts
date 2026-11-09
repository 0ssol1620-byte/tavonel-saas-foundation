/**
 * The one reader of the billing HMAC secrets, for every signer and every verifier.
 *
 * Signers used to `trim()` the value and verifiers used it raw, so one trailing newline pasted
 * into FOUNDATION_BILLING_HMAC made checkout sign with one key while the webhook verified with
 * another: every live `transaction.completed` was quarantined as `binding_invalid` with a 200
 * (Paddle never retries), so the customer was charged and got no allowance. The same newline in
 * FOUNDATION_BILLING_SETTLEMENT_HMAC turned every settlement into a 401.
 *
 * Trimming on both sides would hide the mistake; this refuses it instead. A value with leading or
 * trailing whitespace is not a key: every caller treats it as missing, `/status` reports billing
 * as not configured, checkout answers BILLING_NOT_CONFIGURED and the webhook answers 503 so
 * Paddle redelivers once the value is fixed.
 */
export type BillingSecretName =
  | "FOUNDATION_BILLING_HMAC"
  | "FOUNDATION_BILLING_HMAC_PREVIOUS"
  | "FOUNDATION_BILLING_SETTLEMENT_HMAC";

export type BillingSecretRefusal =
  | "BILLING_SECRET_MISSING"
  | "BILLING_SECRET_WHITESPACE"
  | "BILLING_SECRET_TOO_SHORT";

export const BILLING_SECRET_MIN_LENGTH = 32;

type Environment = Readonly<Record<string, string | undefined>>;

export function readBillingSecret(
  name: BillingSecretName,
  env: Environment = process.env,
): { ok: true; value: string } | { ok: false; code: BillingSecretRefusal } {
  const raw = env[name];
  if (raw === undefined || raw === "") return { ok: false, code: "BILLING_SECRET_MISSING" };
  if (raw !== raw.trim()) return { ok: false, code: "BILLING_SECRET_WHITESPACE" };
  if (raw.length < BILLING_SECRET_MIN_LENGTH) return { ok: false, code: "BILLING_SECRET_TOO_SHORT" };
  return { ok: true, value: raw };
}

/** The qualified value, or undefined. A whitespace refusal is logged by name and code, never the value. */
export function billingSecret(name: BillingSecretName, env: Environment = process.env): string | undefined {
  const secret = readBillingSecret(name, env);
  if (secret.ok) return secret.value;
  if (secret.code === "BILLING_SECRET_WHITESPACE") console.error("billing_secret_refused", { name, code: secret.code });
  return undefined;
}
