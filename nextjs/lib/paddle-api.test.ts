import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPaddlePortalSession, getPaddlePrice, getPaddleSubscription, listPaddleAdjustments, listPaddleTransactions,
  pausePaddleSubscriptionImmediately, readPaddleApiConfig,
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

describe("Paddle read-only reconciliation reads", () => {
  const env = { PADDLE_SANDBOX: "true", PADDLE_API_KEY: `pdl_sdbx_${"k".repeat(24)}` };
  const id = (p: string, n: number) => `${p}_${String(n).padStart(26, "0")}`;
  const txnRow = (n: number) => ({
    id: id("txn", n), status: "completed", currency_code: "USD",
    details: { totals: { total: "2900" }, line_items: [{ price_id: id("pri", 1), quantity: 1 }] },
  });
  const page = (data: unknown[], hasMore: boolean) =>
    new Response(JSON.stringify({ data, meta: { pagination: { has_more: hasMore } } }), { status: 200 });
  afterEach(() => vi.unstubAllGlobals());

  it("follows the cursor across pages, GET only", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(page([txnRow(1)], true))
      .mockResolvedValueOnce(page([txnRow(2)], false));
    vi.stubGlobal("fetch", fetchMock);
    const result = await listPaddleTransactions({ updatedAfter: "2026-11-01T00:00:00Z" }, env);
    expect(result).toMatchObject({ ok: true, truncated: false, items: [{ id: id("txn", 1), total: "2900" }, { id: id("txn", 2) }] });
    expect(String(fetchMock.mock.calls[1][0])).toContain(`after=${id("txn", 1)}`);
    expect(fetchMock.mock.calls.every((c) => c[1].method === "GET")).toBe(true);
  });

  it("stops at the page cap and says it is truncated", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => page([txnRow(1)], true));
    vi.stubGlobal("fetch", fetchMock);
    const result = await listPaddleTransactions({ updatedAfter: "2026-11-01T00:00:00Z" }, env);
    expect(result).toMatchObject({ ok: true, truncated: true, next: id("txn", 1) });
    expect(fetchMock).toHaveBeenCalledTimes(20);
  });

  it("answers a non-2xx or malformed page with a typed failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 500 })));
    await expect(listPaddleAdjustments({ updatedAfter: "x" }, env)).resolves.toEqual({ ok: false, code: "PADDLE_READ_FAILED" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(page([{ id: "bogus" }], false)));
    await expect(listPaddleTransactions({ updatedAfter: "x" }, env)).resolves.toEqual({ ok: false, code: "PADDLE_READ_INVALID" });
  });

  it("is not configured when a sandbox key meets the production flag, and makes no request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const wrong = { PADDLE_SANDBOX: "false", PADDLE_API_KEY: env.PADDLE_API_KEY };
    await expect(listPaddleTransactions({ updatedAfter: "x" }, wrong)).resolves.toEqual({ ok: false, code: "PADDLE_API_NOT_CONFIGURED" });
    await expect(getPaddlePrice(id("pri", 1), wrong)).resolves.toEqual({ ok: false, code: "PADDLE_API_NOT_CONFIGURED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads one price, and types 404 and bad ids", async () => {
    const row = { id: id("pri", 1), status: "active", unit_price: { amount: "2900", currency_code: "USD" }, billing_cycle: { interval: "month", frequency: 1 } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: row }), { status: 200 })));
    await expect(getPaddlePrice(id("pri", 1), env)).resolves.toEqual({
      ok: true, price: { id: id("pri", 1), status: "active", amount: "2900", currency: "USD", interval: "month", frequency: 1 },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 404 })));
    await expect(getPaddlePrice(id("pri", 1), env)).resolves.toEqual({ ok: false, code: "PADDLE_PRICE_NOT_FOUND" });
    await expect(getPaddlePrice("nope", env)).resolves.toEqual({ ok: false, code: "PADDLE_PRICE_ID_INVALID" });
  });

  it("answers a null row or a null line item with a typed failure, not a throw", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => page([null], false)));
    await expect(listPaddleAdjustments({ updatedAfter: "x" }, env)).resolves.toEqual({ ok: false, code: "PADDLE_READ_INVALID" });
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => page([{ ...txnRow(1), details: { totals: { total: "1" }, line_items: [null] } }], false)));
    await expect(listPaddleTransactions({ updatedAfter: "x" }, env)).resolves.toEqual({ ok: false, code: "PADDLE_READ_INVALID" });
  });

  // Fuzz: whatever JSON Paddle sends, a read resolves to valid items or a typed code. It never throws.
  it("never throws and never returns an item that fails its own contract, for random bodies", async () => {
    let seed = 0xbadc0de;
    const rand = () => ((seed = (seed * 1_103_515_245 + 12_345) >>> 0) / 2 ** 32);
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
    const keys = ["id", "status", "currency_code", "details", "totals", "total", "line_items", "items", "price_id", "price",
      "quantity", "transaction_id", "action", "unit_price", "amount", "billing_cycle", "interval", "frequency", "data", "meta"];
    const leaf = () => pick<unknown>([null, undefined, 0, 1, -1, "", "x", "2900", true, id("txn", 1), id("adj", 1), id("pri", 1), "completed", "USD", "month"]);
    const value = (depth: number): unknown => {
      const r = rand();
      if (depth <= 0 || r < 0.4) return leaf();
      if (r < 0.6) return Array.from({ length: Math.floor(rand() * 3) }, () => value(depth - 1));
      return Object.fromEntries(Array.from({ length: Math.floor(rand() * 6) }, () => [pick(keys), value(depth - 1)]));
    };
    const adjRow = { id: id("adj", 1), transaction_id: id("txn", 1), action: "refund", status: "approved", currency_code: "USD", totals: { total: "1" } };
    const priceRow = { id: id("pri", 1), status: "active", unit_price: { amount: "2900", currency_code: "USD" }, billing_cycle: { interval: "month", frequency: 1 } };
    const codes = ["PADDLE_READ_FAILED", "PADDLE_READ_INVALID", "PADDLE_PRICE_NOT_FOUND"];
    for (let i = 0; i < 1000; i++) {
      const base = pick<Record<string, unknown>>([txnRow(1), adjRow, priceRow]);
      const nested = pick(["details", "totals", "unit_price", "billing_cycle"]);
      const mutated = pick([
        () => ({ ...base, [pick(keys)]: value(3) }),
        () => ({ ...base, [nested]: { ...(base[nested] as object | undefined), [pick(keys)]: value(2) } }),
        () => ({ ...base, details: { totals: { total: "1" }, line_items: [pick([null, value(2), { price_id: id("pri", 1), quantity: value(1) }])] } }),
        () => value(4),
      ])();
      const body = rand() < 0.8 ? { data: rand() < 0.7 ? [mutated, ...(rand() < 0.2 ? [null] : [])] : mutated, meta: { pagination: { has_more: rand() < 0.3 } } } : value(4);
      vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(JSON.stringify(body) ?? "", { status: 200 })));
      for (const result of [
        await listPaddleTransactions({ updatedAfter: "x" }, env), await listPaddleAdjustments({ updatedAfter: "x" }, env),
      ]) {
        if (result.ok) expect(result.items.every((t) => /^(txn|adj)_[a-z0-9]{26}$/.test(t.id) && typeof t.status === "string")).toBe(true);
        else expect(codes).toContain(result.code);
      }
      const price = await getPaddlePrice(id("pri", 1), env);
      if (price.ok) expect(price.price.id).toBe(id("pri", 1));
      else expect(codes).toContain(price.code);
    }
  });
});
