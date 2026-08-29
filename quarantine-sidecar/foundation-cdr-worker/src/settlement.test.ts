import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dispatchComputeSettlement, isFoundationSettlementUrl } from "./settlement";

describe("compute settlement callback", () => {
  it("allows only the canonical Foundation endpoint or local tests", () => {
    assert.equal(isFoundationSettlementUrl("https://tavonel-saas-foundation.vercel.app/api/internal/billing/settle"), true);
    assert.equal(isFoundationSettlementUrl("https://evil.example/api/internal/billing/settle"), false);
    assert.equal(isFoundationSettlementUrl("https://tavonel-saas-foundation.vercel.app/api/internal/billing/settle?x=1"), false);
  });

  it("sends a body-bound signed settlement without exposing the secret", async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
      captured = { url: String(input), init: init ?? {} };
      return new Response('{"code":"SETTLEMENT_APPLIED"}', { status: 200 });
    };
    await dispatchComputeSettlement(
      {
        FOUNDATION_BILLING_SETTLEMENT_URL: "https://tavonel-saas-foundation.vercel.app/api/internal/billing/settle",
        FOUNDATION_BILLING_SETTLEMENT_HMAC: "s".repeat(40),
      },
      "quarantine/pilot-test/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/source",
      "settled",
      2,
      "OCR_COMPLETED",
      fetcher as typeof fetch,
      () => new Date("2026-08-29T12:00:00Z"),
      () => "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    );
    assert.ok(captured);
    const call = captured as { url: string; init: RequestInit };
    assert.equal(call.url, "https://tavonel-saas-foundation.vercel.app/api/internal/billing/settle");
    assert.equal(new Headers(call.init.headers).has("authorization"), false);
    assert.match(String(new Headers(call.init.headers).get("x-tavonel-billing-signature")), /^[A-Za-z0-9_-]{43}$/u);
  });
});
