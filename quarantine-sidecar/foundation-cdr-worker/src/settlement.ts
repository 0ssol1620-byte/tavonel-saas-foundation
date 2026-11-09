import type { FailureClass } from "../../../shared/uskcEnums";
import { RetryableError } from "./errors";
import { cdrRequestSignature, hmacSecretIsConfigured, sha256DigestHeader } from "./hmac";
import { parseQuarantineSourceKey } from "./keys";
import { parseCompletedReadFacts } from "../../../shared/completedReadReceipt";

export type SettlementEnv = {
  FOUNDATION_COMPLETED_READ_ENABLED?: string;
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
  completedRead?: import("../../../shared/completedReadReceipt").CompletedReadFacts;
  /** The refusal sentence, verbatim and bounded, so the customer reads a reason not a category. */
  terminalReason?: string;
  /** The frozen failure class the refusal receipt was written with. */
  failureClass?: FailureClass;
  /** `sha256:<hex>` over the source bytes, computed once while sanitizing. */
  sourceSha256?: string;
  /**
   * The page meter (Foundation migration 20261109080000): what a finished or failed read is
   * charged on. `pages` is the reader's `pageCount` of the sanitized PDF, null only when the read
   * could not count it, which settles as operator review and never as a guess. No complex-page
   * count is sent: nothing in this pipeline classifies a page as complex yet.
   */
  meter?: { pages: number | null };
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
  /*
    Read raw, never trimmed. Foundation verifies with the exact value, so a trimmed signer and a
    raw verifier disagree on a pasted newline and every settlement is refused. A value with
    surrounding whitespace is refused here too (nextjs/lib/billing-secrets.ts is the other half).
  */
  const secret = env.FOUNDATION_BILLING_SETTLEMENT_HMAC ?? "";
  if (secret !== secret.trim()) {
    throw new RetryableError("compute settlement secret has leading or trailing whitespace");
  }
  const parts = parseQuarantineSourceKey(sourceKey);
  if (!parts || !isFoundationSettlementUrl(url) || !hmacSecretIsConfigured(secret)) {
    throw new RetryableError("compute settlement is not configured");
  }
  if (facts.completedRead) {
    const proof = parseCompletedReadFacts(facts.completedRead);
    if (env.FOUNDATION_COMPLETED_READ_ENABLED !== "true" || !proof || proof.originalKey !== sourceKey
      || proof.originalSha256 !== facts.sourceSha256 || outcome !== "settled" || actualCredits !== 2
      || reasonCode !== "OCR_COMPLETED") throw new RetryableError("completed read settlement facts are invalid");
  }
  // A read is charged by its pages, so every settlement that is not a release carries them, and a
  // `settled` read carries a real count. Anything else stays on the queue rather than settling.
  const meter = facts.meter;
  if (outcome !== "released" && (!meter
    || (meter.pages !== null && (!Number.isSafeInteger(meter.pages) || meter.pages < 1))
    || (outcome === "settled" && meter.pages === null))) {
    throw new RetryableError("compute settlement page meter facts are missing or invalid");
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
    // `actualCredits` above is the per-document figure a pre-meter Foundation still settles on, so
    // this Worker can deploy before or after the site; the metered site ignores it.
    ...(outcome !== "released" && meter ? { pages: meter.pages } : {}),
    ...(facts.completedRead ? { completedRead: facts.completedRead } : {}),
  });
  const timestamp = now().toISOString();
  const requestId = newRequestId();
  const bytes = new TextEncoder().encode(body);
  if (bytes.byteLength > 2_048) throw new RetryableError("compute settlement facts exceed the body budget");
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
  if (facts.completedRead) {
    const body: unknown = await response.json().catch(() => null);
    const receipt = body && typeof body === "object" ? (body as { result?: Record<string, unknown> }).result : null;
    // A generic 200 or the legacy echo is not evidence that proof and settlement committed.
    const parsed = parseCompletedReadFacts(receipt?.completedRead);
    if (!receipt || receipt.state !== "settled" || receipt.settledCredits !== actualCredits
      || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(String(receipt.reservationId))
      || !["paid", "trial", "owner"].includes(String(receipt.billingSource))
      || !["processed", "duplicate"].includes(String(receipt.status))
      || !parsed || Object.keys(facts.completedRead).some(key => parsed[key as keyof typeof parsed] !== facts.completedRead![key as keyof typeof parsed])) {
      throw new RetryableError("completed read settlement receipt is missing or conflicting");
    }
  }
}
