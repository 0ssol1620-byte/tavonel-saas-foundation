import { createHash, createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
  Billing integrity (HMAC-ROTATION-PLAN-20261109). One reader for the two billing HMACs, used by
  every signer and every verifier, that refuses a value with surrounding whitespace instead of
  trimming it on one side. Each call site is driven here with a clean key and with the same key
  plus a pasted newline; the trial readers and checkout are covered beside their own suites
  (self-service-trial-device-rotation, trial-source-risk, checkout-customer-data-gate).
*/

const { enforcement } = vi.hoisted(() => ({ enforcement: vi.fn() }));
vi.mock("@/lib/billing-gate-enforcement", () => ({
  createSupabaseGateEnforcementStore: () => ({}),
  runBillingGateEnforcement: enforcement,
}));

import { GET as legacyStatus } from "../app/api/status/route";
import { POST as gateEnforce } from "../app/api/internal/billing/gate-enforce/route";
import { POST as settle } from "../app/api/internal/billing/settle/route";
import { POST as creditRelease } from "../app/api/operations/p0/credits/release/route";
import { POST as webhook } from "../app/api/paddle/webhook/route";
import { createCheckoutBinding, previousBillingHmac } from "./billing-binding";
import { billingSecret, readBillingSecret } from "./billing-secrets";
import { readPublicOperations } from "./operations";
import { parsePaddleBillingAction } from "./paddle-billing-event";

const KEY = "billing-test-secret-that-is-at-least-32-characters";
const PASTED = [`${KEY}\n`, `${KEY}\r\n`, ` ${KEY}`, `${KEY}\t`] as const;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("readBillingSecret", () => {
  it("returns a clean key exactly as stored", () => {
    expect(readBillingSecret("FOUNDATION_BILLING_HMAC", { FOUNDATION_BILLING_HMAC: KEY })).toEqual({ ok: true, value: KEY });
  });

  it.each(PASTED)("refuses %j rather than trimming it", (value) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(readBillingSecret("FOUNDATION_BILLING_SETTLEMENT_HMAC", { FOUNDATION_BILLING_SETTLEMENT_HMAC: value }))
      .toEqual({ ok: false, code: "BILLING_SECRET_WHITESPACE" });
    expect(billingSecret("FOUNDATION_BILLING_SETTLEMENT_HMAC", { FOUNDATION_BILLING_SETTLEMENT_HMAC: value })).toBeUndefined();
    // The refusal names the variable and the code, never the value.
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(KEY);
  });

  it("names a missing and a short key separately", () => {
    expect(readBillingSecret("FOUNDATION_BILLING_HMAC", {})).toEqual({ ok: false, code: "BILLING_SECRET_MISSING" });
    expect(readBillingSecret("FOUNDATION_BILLING_HMAC", { FOUNDATION_BILLING_HMAC: "short" })).toEqual({ ok: false, code: "BILLING_SECRET_TOO_SHORT" });
  });
});

describe("previousBillingHmac", () => {
  it("returns a clean previous key and refuses a pasted one", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(previousBillingHmac({ FOUNDATION_BILLING_HMAC_PREVIOUS: KEY })).toBe(KEY);
    expect(previousBillingHmac({ FOUNDATION_BILLING_HMAC_PREVIOUS: `${KEY}\n` })).toBeUndefined();
  });
});

const PRICE = `pri_${"o".repeat(26)}`;
function transactionBody() {
  const binding = createCheckoutBinding(
    { userId: "969dc192-daa2-4119-969d-c192daa24119", workspaceId: "pilot-969dc192daa24119", offerCode: "observer_access" },
    KEY,
  );
  return JSON.stringify({
    event_id: `evt_${"e".repeat(26)}`,
    event_type: "transaction.completed",
    occurred_at: new Date().toISOString(),
    data: {
      id: `txn_${"t".repeat(26)}`,
      customer_id: `ctm_${"c".repeat(26)}`,
      subscription_id: `sub_${"s".repeat(26)}`,
      custom_data: binding,
      items: [{ quantity: 1, price: { id: PRICE } }],
    },
  });
}

describe("webhook binding verification", () => {
  it("authenticates the binding with the clean key, and never with a trimmed copy of a pasted one", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const body = transactionBody();
    expect(parsePaddleBillingAction(body, { FOUNDATION_BILLING_HMAC: KEY, PADDLE_PRICE_OBSERVER_ACCESS: PRICE }))
      .toMatchObject({ action: "allowance", offerCode: "observer_access" });
    expect(parsePaddleBillingAction(body, { FOUNDATION_BILLING_HMAC: `${KEY}\n`, PADDLE_PRICE_OBSERVER_ACCESS: PRICE }))
      .toMatchObject({ action: "ignored", reason: "binding_invalid" });
  });

  const WEBHOOK_SECRET = "paddle-webhook-secret-that-is-at-least-32-chars";
  function signed(body: string) {
    const ts = Math.floor(Date.now() / 1000);
    const h1 = createHmac("sha256", WEBHOOK_SECRET).update(`${ts}:${body}`, "utf8").digest("hex");
    return new Request("https://tavonel.test/api/paddle/webhook", {
      method: "POST",
      headers: { "paddle-signature": `ts=${ts};h1=${h1}`, "content-length": String(Buffer.byteLength(body)) },
      body,
    });
  }

  it("answers 503 for a pasted binding key, so Paddle redelivers instead of the event being quarantined", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubEnv("PADDLE_WEBHOOK_SECRET", WEBHOOK_SECRET);
    vi.stubEnv("FOUNDATION_BILLING_HMAC", `${KEY}\n`);
    const response = await webhook(signed(transactionBody()));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ code: "BILLING_NOT_CONFIGURED", reason: "BILLING_SECRET_WHITESPACE" });
  });

  it("passes a clean binding key through to event parsing", async () => {
    vi.stubEnv("PADDLE_WEBHOOK_SECRET", WEBHOOK_SECRET);
    vi.stubEnv("FOUNDATION_BILLING_HMAC", KEY);
    // An envelope with no event: past the key check, refused by the parser, nothing stored.
    const response = await webhook(signed("{}"));
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ code: "EVENT_ENVELOPE_INVALID" });
  });
});

function settlementRequest(url: string, secret: string, body = "1") {
  const timestamp = new Date().toISOString();
  const requestId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const digest = `sha256:${createHash("sha256").update(body, "utf8").digest("hex")}`;
  const signature = createHmac("sha256", secret).update(`${timestamp}.${requestId}.${digest}`, "utf8").digest("base64url");
  return new Request(url, {
    method: "POST",
    headers: {
      "content-length": String(Buffer.byteLength(body)),
      "x-tavonel-billing-timestamp": timestamp,
      "x-tavonel-billing-request-id": requestId,
      "x-tavonel-input-sha256": digest,
      "x-tavonel-billing-signature": signature,
    },
    body,
  });
}

describe("settlement verifiers", () => {
  it.each([
    ["settle", settle, "https://tavonel.test/api/internal/billing/settle", "SETTLEMENT_BODY_INVALID"],
    ["credit release", creditRelease, "https://tavonel.test/api/operations/p0/credits/release", "CREDIT_RELEASE_BODY_INVALID"],
  ] as const)("%s: a clean key verifies; a pasted key is 503 BILLING_NOT_CONFIGURED, not 401", async (_name, route, url, pastAuth) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubEnv("FOUNDATION_BILLING_SETTLEMENT_HMAC", KEY);
    const clean = await route(settlementRequest(url, KEY));
    expect(clean.status).toBe(400);
    await expect(clean.json()).resolves.toEqual({ code: pastAuth });

    // The Worker signs with the exact value it holds; Foundation refuses the pasted one before verifying.
    vi.stubEnv("FOUNDATION_BILLING_SETTLEMENT_HMAC", `${KEY}\n`);
    const pasted = await route(settlementRequest(url, `${KEY}\n`));
    expect(pasted.status).toBe(503);
    await expect(pasted.json()).resolves.toEqual({ code: "BILLING_NOT_CONFIGURED" });
  });
});

describe("gate enforcement", () => {
  const CRON = "c".repeat(40);
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", CRON);
    vi.stubEnv("PADDLE_API_KEY", `pdl_live_${"a".repeat(30)}`);
    vi.stubEnv("PADDLE_SANDBOX", "false");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://tenant.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "a".repeat(32));
    enforcement.mockReset();
    enforcement.mockResolvedValue({ ok: true, counts: {} });
  });
  const run = () => gateEnforce(new Request("https://tavonel.test/api/internal/billing/gate-enforce", {
    method: "POST", headers: { authorization: `Bearer ${CRON}` },
  }));

  it("verifies stored bindings with the clean key", async () => {
    vi.stubEnv("FOUNDATION_BILLING_HMAC", KEY);
    expect((await run()).status).toBe(200);
    expect(enforcement).toHaveBeenCalledWith(expect.objectContaining({ bindingSecret: KEY }));
  });

  it("does not run, and so pauses nobody, on a pasted key", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubEnv("FOUNDATION_BILLING_HMAC", `${KEY}\n`);
    const response = await run();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ code: "BILLING_GATE_ENFORCEMENT_NOT_CONFIGURED" });
    expect(enforcement).not.toHaveBeenCalled();
  });
});

describe("status reports a pasted key as billing not configured", () => {
  beforeEach(() => {
    for (const [name, value] of Object.entries({
      COMMERCIAL_MODE: "live",
      PADDLE_SANDBOX: "false",
      TAVONEL_BILLING_LAUNCH_APPROVED: "true",
      ACCESS_MODE: "self_service",
      NEXT_PUBLIC_SUPABASE_URL: "https://tenant.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-anon-key",
      VERCEL_ENV: "production",
      PADDLE_WEBHOOK_SECRET: "configured-webhook-secret",
      NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: `live_${"a".repeat(30)}`,
      PADDLE_API_KEY: `pdl_live_${"a".repeat(30)}`,
      SUPABASE_SERVICE_ROLE_KEY: "a".repeat(32),
      FOUNDATION_BILLING_HMAC: KEY,
      FOUNDATION_BILLING_SETTLEMENT_HMAC: KEY,
      PADDLE_PRICE_OBSERVER_ACCESS: `pri_${"a".repeat(26)}`,
      PADDLE_PRICE_STUDIO_ACCESS: `pri_${"b".repeat(26)}`,
    })) vi.stubEnv(name, value);
  });

  it.each(["FOUNDATION_BILLING_HMAC", "FOUNDATION_BILLING_SETTLEMENT_HMAC"])("%s", async (name) => {
    const clean = await legacyStatus().json() as { billing: string };
    expect(clean.billing).toBe("live_checkout_ready");
    const cleanOperations = readPublicOperations().components.billing.state;

    vi.stubEnv(name, `${KEY}\n`);
    const pasted = await legacyStatus().json() as { billing: string };
    expect(pasted.billing).toBe("live_incomplete");
    expect(readPublicOperations().components.billing.state).not.toBe(cleanOperations);
  });
});
