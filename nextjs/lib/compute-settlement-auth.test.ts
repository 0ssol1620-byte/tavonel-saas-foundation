import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyComputeSettlementRequest } from "./compute-settlement-auth";

describe("compute settlement callback authentication", () => {
  it("accepts only a current body-bound HMAC", () => {
    const secret = "settlement-test-secret-that-is-at-least-32";
    const body = '{"workspaceKey":"pilot-test"}';
    const timestamp = "2026-08-29T12:00:00.000Z";
    const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const digest = `sha256:${createHash("sha256").update(body).digest("hex")}`;
    const signature = createHmac("sha256", secret).update(`${timestamp}.${requestId}.${digest}`).digest("base64url");
    const headers = new Headers({
      "x-tavonel-billing-timestamp": timestamp,
      "x-tavonel-billing-request-id": requestId,
      "x-tavonel-input-sha256": digest,
      "x-tavonel-billing-signature": signature,
    });
    expect(verifyComputeSettlementRequest(body, headers, secret, Date.parse(timestamp))).toBe(true);
    expect(verifyComputeSettlementRequest(`${body} `, headers, secret, Date.parse(timestamp))).toBe(false);
  });
});
