import { PermanentReject, isRetryable } from "./errors";
import { evaluateHealth } from "./guards";
import { extractObjectKey, isQuarantineSourceKey } from "./keys";
import { asSourceRefusal, sanitizeObject, writeCdrRejectReceipt, type SanitizeResult } from "./sanitize";
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

/**
 * Refuse durably, or do not refuse at all.
 *
 * The old order was: throw, release the billing reservation, acknowledge the message. Nothing was
 * written, so a refused document was indistinguishable from one still being prepared -- for the
 * customer, for support, and for anyone trying to count how often this happens.
 *
 * The order is now receipt first, settlement second, acknowledgement last, and any of the three
 * failing leaves the message on the queue. A refusal with no class produces no receipt (see
 * `writeCdrRejectReceipt`) and therefore no acknowledgement either: it retries and dead-letters
 * rather than being recorded under a guessed reason.
 */
async function settleRefusal(
  env: Env,
  objectKey: string,
  error: PermanentReject,
  fetcher: typeof fetch,
): Promise<"recorded" | "retry"> {
  const refusal = asSourceRefusal(error);
  if (!refusal) return "retry";
  const receipt = await writeCdrRejectReceipt(env, objectKey, refusal);
  if (!receipt) return "retry";
  try {
    await dispatchComputeSettlement(env, objectKey, "released", 0, "CDR_PERMANENT_REJECT", fetcher, undefined, undefined, {
      terminalReason: refusal.message,
      failureClass: refusal.failureClass,
    });
  } catch {
    return "retry";
  }
  return "recorded";
}

async function settleSanitized(env: Env, objectKey: string, result: SanitizeResult, fetcher: typeof fetch) {
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
    undefined,
    undefined,
    // The digest over the bytes this worker read. The application server never reads them, so
    // this is the only place a source digest can come from without re-downloading the object.
    { sourceSha256: result.inputSha256 },
  );
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
      await settleSanitized(env, objectKey, result, fetcher);
      return jsonResponse(200, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "sanitize failed";
      if (error instanceof PermanentReject) {
        const status = message.includes("5 MiB") ? 413 : 400;
        if (!isQuarantineSourceKey(objectKey)) return jsonResponse(status, { error: message });
        return await settleRefusal(env, objectKey, error, fetcher) === "recorded"
          ? jsonResponse(status, { error: message })
          : jsonResponse(503, { error: "refusal could not be recorded" });
      }
      return jsonResponse(503, { error: message });
    }
  }
  return jsonResponse(404, { error: "not found" });
}

export async function handleQueue(batch: MessageBatch<unknown>, env: Env, fetcher: typeof fetch = fetch): Promise<void> {
  for (const message of batch.messages) {
    try {
      const objectKey = extractObjectKey(message.body);
      if (!objectKey || !isQuarantineSourceKey(objectKey)) {
        message.ack();
        continue;
      }
      const result = await sanitizeObject(env, objectKey, fetcher);
      await settleSanitized(env, objectKey, result, fetcher);
      message.ack();
    } catch (error) {
      if (error instanceof PermanentReject) {
        const objectKey = extractObjectKey(message.body);
        if (!objectKey || !isQuarantineSourceKey(objectKey)) {
          // Not a customer source object at all; there is nothing to refuse and nobody to tell.
          message.ack();
          continue;
        }
        if (await settleRefusal(env, objectKey, error, fetcher) === "recorded") message.ack();
        else message.retry();
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
