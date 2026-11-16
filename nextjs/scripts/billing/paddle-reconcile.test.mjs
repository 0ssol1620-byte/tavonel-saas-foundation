import { describe, expect, it } from "vitest";

import { BILLING_OFFERS } from "../../lib/billing-catalog.ts";
import { getPaddlePrice, listPaddleAdjustments, listPaddleTransactions, readPaddleApiConfig } from "../../lib/paddle-api.ts";
import { priceBookDelta, processorDelta } from "../../lib/paddle-reconciliation.ts";
import { environmentRefusal, parseArgs, run } from "./paddle-reconcile.mjs";

const KEY = `pdl_sdbx_${"k".repeat(30)}`;
const SANDBOX = { PADDLE_SANDBOX: "true", PADDLE_API_KEY: KEY };
const TXN = `txn_${"a".repeat(26)}`;
const PRICE = `pri_${"b".repeat(26)}`;
const OBSERVER = BILLING_OFFERS.observer_access;
const ONE_OFFER = { observer_access: OBSERVER };

const deps = (over = {}) => ({
  readPaddleApiConfig,
  priceBookDelta,
  processorDelta,
  BILLING_OFFERS,
  getPaddlePrice,
  listPaddleTransactions,
  listPaddleAdjustments,
  readLedgerForReconciliation: async (since) => ({ ok: true, since, rows: [], truncated: false }),
  ...over,
});
const body = (data) => new Response(JSON.stringify({ data, meta: { pagination: { has_more: false } } }));
// Transactions come back as given; the adjustments endpoint is always empty here.
const page = (data) => async (url) => body(String(url).includes("/adjustments") ? [] : data);
const withFetch = async (handler, fn) => {
  const real = globalThis.fetch;
  globalThis.fetch = handler;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
};
const completedTxn = {
  id: TXN,
  status: "completed",
  currency_code: "USD",
  details: { totals: { total: "2900" }, line_items: [{ price_id: PRICE, quantity: 1 }] },
};

describe("paddle-reconcile", () => {
  it("with no key it exits 2 naming PADDLE_API_KEY", async () => {
    const r = await run(["prices"], { PADDLE_SANDBOX: "true" }, deps());
    expect(r.exit).toBe(2);
    expect(r.out).toContain("PADDLE_API_KEY");
  });

  it("refuses production without the confirm and without PADDLE_SANDBOX unset", async () => {
    const prod = parseArgs(["prices", "--production"]);
    expect(environmentRefusal(prod, SANDBOX)).toMatch(/PADDLE_SANDBOX unset/);
    expect(environmentRefusal(prod, {})).toMatch(/CONFIRM=READ-ONLY/);
    expect(environmentRefusal(prod, { TAVONEL_RECONCILE_PRODUCTION_CONFIRM: "READ-ONLY" })).toBeNull();
    expect(environmentRefusal(parseArgs(["prices"]), {})).toMatch(/sandbox only/);
    expect((await run(["prices"], { PADDLE_API_KEY: KEY }, deps())).exit).toBe(2);
  });

  it("rejects a bad command or --since", () => {
    expect(parseArgs(["nope"]).error).toBeTruthy();
    expect(parseArgs(["prices", "--since", "yesterday-ish"]).error).toBeTruthy();
  });

  it("transactions: a completed Paddle transaction missing from the ledger gives the exact delta and exit 1", async () => {
    const r = await withFetch(page([completedTxn]), () =>
      run(["transactions", "--since", "2026-11-01T00:00:00Z", "--json"], SANDBOX, deps()),
    );
    expect(r.exit).toBe(1);
    expect(JSON.parse(r.out)).toEqual({
      schema: "tavonel.paddle_reconcile.v1",
      command: "transactions",
      environment: "sandbox",
      since: "2026-11-01T00:00:00.000Z",
      counts: { ledgerRows: 0, transactions: 1, adjustments: 0 },
      delta: {
        window: { ledgerSince: "2026-11-01T00:00:00.000Z", processorUpdatedAfter: "2026-11-01T00:00:00.000Z", truncated: false },
        missingInLedger: [TXN],
        missingAtProcessor: [],
        creditMismatch: [],
        reversalMissing: [],
        reversalUnexpected: [],
      },
    });
    expect(r.out).not.toContain(KEY);
    expect(r.out).not.toContain("2900");
  });

  it("transactions: an empty delta exits 0; a truncated window does not claim agreement", async () => {
    const empty = await withFetch(page([]), () => run(["transactions", "--json"], SANDBOX, deps()));
    expect(empty.exit).toBe(0);
    const cut = await withFetch(page([]), () =>
      run(["transactions"], SANDBOX, deps({ readLedgerForReconciliation: async (since) => ({ ok: true, since, rows: [], truncated: true }) })),
    );
    expect(cut.exit).toBe(1);
  });

  it("transactions: an unreadable Paddle page exits 3, never 0", async () => {
    const r = await withFetch(async () => new Response("{}", { status: 500 }), () => run(["transactions"], SANDBOX, deps()));
    expect(r.exit).toBe(3);
    expect(r.out).toBe("PADDLE_READ_FAILED");
  });

  it("transactions: an unconfigured ledger store exits 2", async () => {
    const r = await run(
      ["transactions"],
      SANDBOX,
      deps({ readLedgerForReconciliation: async () => ({ ok: false, code: "BILLING_STORE_NOT_CONFIGURED" }) }),
    );
    expect(r.exit).toBe(2);
  });

  it("prices: a matching price is exit 0; an amount mismatch and an unconfigured offer are exit 1", async () => {
    const env = { ...SANDBOX, [OBSERVER.priceEnv]: PRICE };
    const price = (amount) => async () =>
      new Response(
        JSON.stringify({
          data: { id: PRICE, status: "active", unit_price: { amount, currency_code: "USD" }, billing_cycle: { interval: "month", frequency: 1 } },
        }),
      );
    const d = deps({ BILLING_OFFERS: ONE_OFFER });
    const ok = await withFetch(price(String(OBSERVER.priceUsd * 100)), () => run(["prices", "--json"], env, d));
    expect(ok.exit).toBe(0);
    const bad = await withFetch(price("1"), () => run(["prices", "--json"], env, d));
    expect(bad.exit).toBe(1);
    expect(JSON.parse(bad.out).delta).toEqual([{ offerCode: "observer_access", priceId: PRICE, problems: ["amount_mismatch"] }]);
    const none = await run(["prices", "--json"], SANDBOX, d);
    expect(JSON.parse(none.out).delta[0].problems).toEqual(["price_id_not_configured"]);
  });
});
