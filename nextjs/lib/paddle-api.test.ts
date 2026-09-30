import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPaddlePortalSession, getPaddleSubscription, pausePaddleSubscriptionImmediately, readPaddleApiConfig,
} from "./paddle-api";

describe("Paddle server API", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fails closed when an API key does not match the configured environment", () => {
    expect(readPaddleApiConfig({ PADDLE_SANDBOX: "true", PADDLE_API_KEY: "pdl_live_wrong" })).toBeNull();
    expect(readPaddleApiConfig({ PADDLE_SANDBOX: "false", PADDLE_API_KEY: "pdl_sdbx_wrong" })).toBeNull();
  });

  it("accepts only a Paddle-hosted HTTPS portal session URL", async () => {
    vi.stubEnv("PADDLE_SANDBOX", "true");
    vi.stubEnv("PADDLE_API_KEY", `pdl_sdbx_${"k".repeat(24)}`);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { urls: { general: { overview: "https://sandbox-customer-portal.paddle.com/cpl_test?action=overview" } } },
    }), { status: 201 })));
    await expect(createPaddlePortalSession({ customerId: `ctm_${"c".repeat(26)}` })).resolves.toMatchObject({ ok: true });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { urls: { general: { overview: "https://attacker.invalid/cpl_test" } } },
    }), { status: 201 })));
    await expect(createPaddlePortalSession({ customerId: `ctm_${"c".repeat(26)}` })).resolves.toMatchObject({
      ok: false,
      code: "PADDLE_PORTAL_URL_INVALID",
    });
  });
});

describe("Paddle subscription read and immediate pause", () => {
  const SUB = `sub_${"a".repeat(26)}`;
  const env = { PADDLE_SANDBOX: "false", PADDLE_API_KEY: `pdl_live_${"k".repeat(24)}` };
  const entity = (overrides: Record<string, unknown> = {}) => ({ data: {
    id: SUB, status: "active", customer_id: `ctm_${"c".repeat(26)}`, custom_data: { tavonel_nonce: "x" },
    next_billed_at: "2026-10-30T00:00:00Z", first_billed_at: "2026-09-30T00:00:00Z", paused_at: null,
    current_billing_period: { starts_at: "2026-09-30T00:00:00Z", ends_at: "2026-10-30T00:00:00Z" },
    scheduled_change: null, ...overrides,
  } });

  afterEach(() => vi.unstubAllGlobals());

  it("reads the live subscription and reports its environment", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(entity()), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await getPaddleSubscription(SUB, env);
    expect(result).toMatchObject({ ok: true, environment: "production",
      subscription: { id: SUB, status: "active", nextBilledAt: "2026-10-30T00:00:00Z", scheduledChange: null } });
    expect(fetchMock.mock.calls[0][0]).toBe(`https://api.paddle.com/subscriptions/${SUB}`);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "GET" });
  });

  it("answers an ID this environment does not know as not found, without retrying elsewhere", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(getPaddleSubscription(SUB, env)).resolves.toEqual({ ok: false, code: "PADDLE_SUBSCRIPTION_NOT_FOUND" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses a malformed ID or an entity for a different subscription", async () => {
    await expect(getPaddleSubscription("sub_bad", env)).resolves.toMatchObject({ code: "PADDLE_SUBSCRIPTION_ID_INVALID" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(entity({ id: `sub_${"b".repeat(26)}` })))));
    await expect(getPaddleSubscription(SUB, env)).resolves.toMatchObject({ code: "PADDLE_SUBSCRIPTION_INVALID" });
  });

  it("pauses immediately and succeeds only when Paddle answers paused", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(entity({
      status: "paused", paused_at: "2026-10-01T00:00:00Z", next_billed_at: null,
    }))));
    vi.stubGlobal("fetch", fetchMock);
    await expect(pausePaddleSubscriptionImmediately(SUB, env)).resolves.toMatchObject({
      ok: true, subscription: { status: "paused", pausedAt: "2026-10-01T00:00:00Z" } });
    expect(fetchMock.mock.calls[0][0]).toBe(`https://api.paddle.com/subscriptions/${SUB}/pause`);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST", body: JSON.stringify({ effective_from: "immediately" }) });

    // A scheduled pause (status still active) is not the immediate pause that was asked for.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(entity()))));
    await expect(pausePaddleSubscriptionImmediately(SUB, env)).resolves.toEqual({ ok: false, code: "PADDLE_SUBSCRIPTION_PAUSE_FAILED" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 404 })));
    await expect(pausePaddleSubscriptionImmediately(SUB, env)).resolves.toEqual({ ok: false, code: "PADDLE_SUBSCRIPTION_PAUSE_FAILED" });
  });
});
