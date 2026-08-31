import { RetryableError } from "./errors";
import { cdrRequestSignature, hmacSecretIsConfigured, sha256DigestHeader } from "./hmac";
import { parseQuarantineSourceKey } from "./keys";

export type SettlementEnv = {
  FOUNDATION_BILLING_SETTLEMENT_URL?: string;
  FOUNDATION_BILLING_SETTLEMENT_HMAC?: string;
};

export function isFoundationSettlementUrl(value: string | undefined) {
  if (!value) return false;
  try {
    const url = new URL(value);
    const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    return (url.protocol === "https:" || local)
      && (local || url.hostname === "tavonel-saas-foundation.vercel.app")
      && url.pathname === "/api/internal/billing/settle"
      && !url.search && !url.hash;
  } catch {
    return false;
  }
}

async function safeSettlementErrorCode(response: Response): Promise<string | null> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return null;
  }
  const code = body && typeof body === "object" && "code" in body
    ? (body as { code?: unknown }).code
    : null;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]{2,79}$/.test(code) ? code : null;
}

export async function dispatchComputeSettlement(
  env: SettlementEnv,
  sourceKey: string,
  outcome: "settled" | "operator_review" | "released",
  actualCredits: 0 | 2,
  reasonCode: string,
  fetcher: typeof fetch = fetch,
  now: () => Date = () => new Date(),
  newRequestId: () => string = () => crypto.randomUUID(),
) {
  const url = env.FOUNDATION_BILLING_SETTLEMENT_URL?.trim() ?? "";
  const secret = env.FOUNDATION_BILLING_SETTLEMENT_HMAC?.trim() ?? "";
  const parts = parseQuarantineSourceKey(sourceKey);
  if (!parts || !isFoundationSettlementUrl(url) || !hmacSecretIsConfigured(secret)) {
    throw new RetryableError("compute settlement is not configured");
  }
  const body = JSON.stringify({
    workspaceKey: parts.workspaceId,
    documentId: parts.documentId,
    outcome,
    actualCredits,
    reasonCode,
  });
  const timestamp = now().toISOString();
  const requestId = newRequestId();
  const bytes = new TextEncoder().encode(body);
  const digest = await sha256DigestHeader(bytes);
  const signature = await cdrRequestSignature(secret, timestamp, requestId, digest);
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tavonel-billing-timestamp": timestamp,
        "x-tavonel-billing-request-id": requestId,
        "x-tavonel-input-sha256": digest,
        "x-tavonel-billing-signature": signature,
      },
      body,
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new RetryableError("compute settlement request failed");
  }
  if (!response.ok) {
    const code = await safeSettlementErrorCode(response);
    throw new RetryableError(`compute settlement returned HTTP ${response.status}${code ? ` (${code})` : ""}`);
  }
}
