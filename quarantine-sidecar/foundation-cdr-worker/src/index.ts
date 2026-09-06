import { PermanentReject, isRetryable } from "./errors";
import { evaluateHealth } from "./guards";
import { extractObjectKey, isQuarantineSourceKey } from "./keys";
import { sanitizeObject } from "./sanitize";
import { dispatchComputeSettlement } from "./settlement";

export interface Env {
  FOUNDATION_QUARANTINE: R2Bucket;
  TAVONEL_CDR_URL: string;
  TAVONEL_CDR_HEALTH_URL: string;
  TAVONEL_CDR_PROVIDER: string;
  FOUNDATION_R2_BUCKET: string;
  TAVONEL_CDR_HMAC: string;
  FOUNDATION_OCR_URL?: string;
  TAVONEL_OCR_HMAC?: string;
  RUNPOD_API_KEY?: string;
  FOUNDATION_BILLING_SETTLEMENT_URL?: string;
  FOUNDATION_BILLING_SETTLEMENT_HMAC?: string;
  FOUNDATION_MANUAL_TRIGGER_TOKEN?: string;
}

function authorizeManualTrigger(request: Request, token: string | undefined): "ok" | "disabled" | "denied" {
  if (!token || token.length < 32) return "disabled";
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return "denied";
  const provided = new TextEncoder().encode(header.slice("Bearer ".length));
  const expected = new TextEncoder().encode(token);
  if (provided.length !== expected.length) return "denied";
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= provided[index] ^ expected[index];
  return difference === 0 ? "ok" : "denied";
}

export function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export async function handleRequest(request: Request, env: Env, fetcher: typeof fetch = fetch): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") {
    const result = await evaluateHealth(env, fetcher);
    return jsonResponse(result.httpStatus, result.body);
  }
  if (request.method === "POST" && url.pathname === "/v1/sanitize") {
    const authorization = authorizeManualTrigger(request, env.FOUNDATION_MANUAL_TRIGGER_TOKEN);
    if (authorization === "disabled") return jsonResponse(404, { error: "not found" });
    if (authorization === "denied") return jsonResponse(401, { error: "unauthorized" });
    let objectKey = "";
    try {
      const payload = (await request.json()) as { objectKey?: unknown };
      if (typeof payload?.objectKey !== "string" || payload.objectKey.length < 1) {
        return jsonResponse(400, { error: "objectKey is required" });
      }
      objectKey = payload.objectKey;
    } catch {
      return jsonResponse(400, { error: "JSON body with objectKey is required" });
    }
    try {
      const result = await sanitizeObject(env, objectKey, fetcher);
      const outcome = result.ocr.computeCredits === 0
        ? "released"
        : result.ocr.status === "failed" ? "operator_review" : "settled";
      await dispatchComputeSettlement(
        env,
        objectKey,
        outcome,
        result.ocr.computeCredits,
        result.ocr.reasonCode ?? (outcome === "settled" ? "OCR_COMPLETED" : "GPU_NOT_DISPATCHED"),
        fetcher,
      );
      return jsonResponse(200, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "sanitize failed";
      if (error instanceof PermanentReject) {
        if (!isQuarantineSourceKey(objectKey)) {
          return jsonResponse(message.includes("5 MiB") ? 413 : 400, { error: message });
        }
        try {
          await dispatchComputeSettlement(env, objectKey, "released", 0, "CDR_PERMANENT_REJECT", fetcher);
          return jsonResponse(message.includes("5 MiB") ? 413 : 400, { error: message });
        } catch {
          return jsonResponse(503, { error: "compute release failed" });
        }
      }
      return jsonResponse(503, { error: message });
    }
  }
  return jsonResponse(404, { error: "not found" });
}

/**
 * How long a redelivered message waits before the OCR endpoint is asked again.
 *
 * The GPU endpoint scales to zero and its cold start outruns a single OCR request, so the first
 * upload after an idle period times out on infrastructure rather than on the document. Attempts 1
 * and 2 give the endpoint time to boot; attempt 3 is terminal and settles for operator review
 * exactly as before, so nothing is lost. `max_retries` in wrangler.jsonc stays the outer bound.
 */
const OCR_COLD_START_RETRY_DELAYS_S = [60, 120] as const;

function coldStartRetryDelay(attempts: unknown): number | undefined {
  const attempt = Number.isInteger(attempts) && (attempts as number) > 0 ? (attempts as number) : 1;
  return OCR_COLD_START_RETRY_DELAYS_S[attempt - 1];
}

export async function handleQueue(batch: MessageBatch<unknown>, env: Env, fetcher: typeof fetch = fetch): Promise<void> {
  for (const message of batch.messages) {
    try {
      const objectKey = extractObjectKey(message.body);
      if (!objectKey || !isQuarantineSourceKey(objectKey)) {
        message.ack();
        continue;
      }
      const retryDelaySeconds = coldStartRetryDelay(message.attempts);
      const result = await sanitizeObject(env, objectKey, fetcher, undefined, undefined, {
        deferReviewOnTimeout: retryDelaySeconds !== undefined,
      });
      if (retryDelaySeconds !== undefined && result.ocr.reasonCode === "OCR_TIMEOUT_OR_NETWORK") {
        // No review record and no settlement: the reservation stays open for the next attempt,
        // which is what keeps a credit from being charged for a boot that never produced OCR.
        message.retry({ delaySeconds: retryDelaySeconds });
        continue;
      }
      const outcome = result.ocr.computeCredits === 0
        ? "released"
        : result.ocr.status === "failed" ? "operator_review" : "settled";
      await dispatchComputeSettlement(
        env,
        objectKey,
        outcome,
        result.ocr.computeCredits,
        result.ocr.reasonCode ?? (outcome === "settled" ? "OCR_COMPLETED" : "GPU_NOT_DISPATCHED"),
        fetcher,
      );
      message.ack();
    } catch (error) {
      if (error instanceof PermanentReject) {
        try {
          const objectKey = extractObjectKey(message.body);
          if (objectKey) await dispatchComputeSettlement(env, objectKey, "released", 0, "CDR_PERMANENT_REJECT", fetcher);
          message.ack();
        } catch {
          message.retry();
        }
        continue;
      }
      if (isRetryable(error)) {
        message.retry();
      } else {
        message.ack();
      }
    }
  }
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env, fetch);
  },
  queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    return handleQueue(batch, env, fetch);
  },
};
