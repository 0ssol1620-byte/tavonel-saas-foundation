import type { FailureClass } from "../../../shared/uskcEnums";
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

/**
 * What the settlement carries beyond the money.
 *
 * This channel is the only outbound path the worker has (`isFoundationSettlementUrl` pins it to
 * one endpoint), which is why a refusal used to exist nowhere but a billing release. Widening it
 * is what lets the site write a document state and one audit row for a refusal, and what lets the
 * trial abuse gate use the digest the worker already computed over the bytes it read instead of
 * the application server downloading the source a second time to compute its own.
 *
 * Every field is something the worker observed. None of it is a filename or document content.
 */
export type SettlementFacts = {
  /** The refusal sentence, verbatim and bounded, so the customer reads a reason not a category. */
  terminalReason?: string;
  /** The frozen failure class the refusal receipt was written with. */
  failureClass?: FailureClass;
  /** `sha256:<hex>` over the source bytes, computed once while sanitizing. */
  sourceSha256?: string;
};

/** Long enough for any refusal this worker raises, short enough for the 2 KiB body budget. */
const MAX_TERMINAL_REASON = 200;

export async function dispatchComputeSettlement(
  env: SettlementEnv,
  sourceKey: string,
  outcome: "settled" | "operator_review" | "released",
  actualCredits: 0 | 2,
  reasonCode: string,
  fetcher: typeof fetch = fetch,
  now: () => Date = () => new Date(),
  newRequestId: () => string = () => crypto.randomUUID(),
  facts: SettlementFacts = {},
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
    ...(facts.terminalReason ? { terminalReason: facts.terminalReason.slice(0, MAX_TERMINAL_REASON) } : {}),
    ...(facts.failureClass ? { failureClass: facts.failureClass } : {}),
    ...(facts.sourceSha256 ? { sourceSha256: facts.sourceSha256 } : {}),
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
