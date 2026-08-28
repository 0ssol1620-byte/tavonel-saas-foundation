import { PermanentReject, isRetryable } from "./errors";
import { evaluateHealth } from "./guards";
import { extractObjectKey, isQuarantineSourceKey } from "./keys";
import { sanitizeObject } from "./sanitize";

export interface Env {
  FOUNDATION_QUARANTINE: R2Bucket;
  TAVONEL_CDR_URL: string;
  TAVONEL_CDR_HEALTH_URL: string;
  TAVONEL_CDR_PROVIDER: string;
  FOUNDATION_R2_BUCKET: string;
  TAVONEL_CDR_HMAC: string;
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
      return jsonResponse(200, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "sanitize failed";
      if (error instanceof PermanentReject) {
        return jsonResponse(message.includes("5 MiB") ? 413 : 400, { error: message });
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
      await sanitizeObject(env, objectKey, fetcher);
      message.ack();
    } catch (error) {
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