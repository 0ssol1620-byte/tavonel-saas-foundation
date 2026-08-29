import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function verifyComputeSettlementRequest(
  rawBody: string,
  headers: Headers,
  secret: string | undefined,
  now = Date.now(),
) {
  const timestamp = headers.get("x-tavonel-billing-timestamp") ?? "";
  const requestId = headers.get("x-tavonel-billing-request-id") ?? "";
  const digest = headers.get("x-tavonel-input-sha256") ?? "";
  const signature = headers.get("x-tavonel-billing-signature") ?? "";
  const timestampMs = Date.parse(timestamp);
  const computedDigest = `sha256:${createHash("sha256").update(rawBody, "utf8").digest("hex")}`;
  if (!secret || secret.length < 32 || !REQUEST_ID.test(requestId) || !Number.isFinite(timestampMs)
    || Math.abs(now - timestampMs) > 300_000 || digest !== computedDigest || !/^[A-Za-z0-9_-]{43}$/.test(signature)) {
    return false;
  }
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${requestId}.${digest}`, "utf8")
    .digest("base64url");
  const receivedBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  return receivedBytes.length === expectedBytes.length && timingSafeEqual(receivedBytes, expectedBytes);
}
