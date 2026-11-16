import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BILLING_OFFERS } from "./billing-catalog";
import type { PaddleAdjustment, PaddlePrice, PaddleTransaction } from "./paddle-api";
import { priceBookDelta, processorDelta, readLedgerForReconciliation, type LedgerRow } from "./paddle-reconciliation";

const txn = (c: string) => `txn_${c.repeat(26)}`;
const tx = (id: string, status = "completed"): PaddleTransaction =>
  ({ id, status, currency: "USD", total: "2900", lineItems: [] });
const grant = (id: string, credits = 2_000, offerCode: string | null = "observer_access"): LedgerRow => ({
  eventId: `evt_${id}`, kind: "purchased", transactionId: id, reversalOfTransactionId: null, creditDelta: credits, offerCode,
});
const reversal = (id: string): LedgerRow => ({
  eventId: `evt_r${id}`, kind: "reversed", transactionId: null, reversalOfTransactionId: id, creditDelta: -2_000, offerCode: null,
});
const refund = (transactionId: string, status = "approved"): PaddleAdjustment =>
  ({ id: `adj_${"a".repeat(26)}`, transactionId, action: "refund", status, currency: "USD", total: "2900" });

describe("processorDelta", () => {
  it("reports each bucket exactly, keyed by transaction id", () => {
    const [a, b, c, d, e] = ["a", "b", "c", "d", "e"].map(txn);
    const delta = processorDelta(
      [grant(b), grant(c, 1_999), grant(d), grant(e), reversal(e)],
      [tx(a), tx(c), tx(d), tx(e), tx(txn("f"), "draft")],
      [refund(d), refund(e, "pending_approval")],
    );
    expect(delta).toEqual({
      missingInLedger: [a],
      missingAtProcessor: [b],
      creditMismatch: [c],
      reversalMissing: [d],
      reversalUnexpected: [e],
    });
  });

  it("ignores allowance_expired rows, counts chargeback_warning, and does not expect billed to be granted", () => {
    const [a, b, c] = ["a", "b", "c"].map(txn);
    const expired: LedgerRow = { ...grant(a, -500), kind: "allowance_expired", eventId: "evt_x" };
    const warn: PaddleAdjustment = { ...refund(b), action: "chargeback_warning" };
    const delta = processorDelta(
      [{ ...grant(a), kind: "allowance" }, expired, grant(b), reversal(b)],
      [tx(a), tx(b), tx(c, "billed")],
      [warn],
    );
    expect(delta).toEqual({
      missingInLedger: [], missingAtProcessor: [], creditMismatch: [], reversalMissing: [], reversalUnexpected: [],
    });
  });

  it("is empty when ledger and processor agree", () => {
    const a = txn("a");
    const delta = processorDelta([grant(a), reversal(a)], [tx(a)], [refund(a)]);
    expect(Object.values(delta).every((v) => v.length === 0)).toBe(true);
  });

  it("reports an approved refund without a reversal row even when its grant is outside the ledger window", () => {
    const a = txn("a");
    expect(processorDelta([], [], [refund(a)]).reversalMissing).toEqual([a]);
  });

  it("makes a grant it cannot check against the catalog a credit mismatch, never a skip", () => {
    const [a, b, c, d] = ["a", "b", "c", "d"].map(txn);
    const delta = processorDelta(
      [grant(a, 99, "retired_offer"), grant(b, 99, null), grant(c, 2_000, "toString"),
        grant(d), { ...grant(d), kind: "allowance", eventId: "evt_dup" }],
      [tx(a), tx(b), tx(c), tx(d)],
      [],
    );
    expect(delta.creditMismatch).toEqual([a, b, c, d]);
  });

  it("counts a grant whose processor transaction is not completed as missing at the processor", () => {
    const a = txn("a");
    expect(processorDelta([grant(a)], [tx(a, "billed")], []).missingAtProcessor).toEqual([a]);
  });

  /*
    Mutation property: a world the webhook would write reconciles to an empty delta, and every single
    corruption of it surfaces the corrupted transaction in its bucket. Any branch that treats an input
    it cannot match as agreement (a window gate, an unknown offer, a collapsed duplicate) fails here.
  */
  it("surfaces every single corruption of a consistent world, for random worlds", () => {
    let seed = 0x5eed;
    const rand = () => ((seed = (seed * 1_103_515_245 + 12_345) >>> 0) / 2 ** 32);
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
    const offers = Object.keys(BILLING_OFFERS) as Array<keyof typeof BILLING_OFFERS>;
    const corruptions = [
      "drop_grant", "drop_processor", "wrong_credits", "unknown_offer", "duplicate_grant",
      "drop_reversal", "out_of_window_refund", "spurious_reversal", "not_completed",
    ] as const;
    for (let world = 0; world < 200; world++) {
      const ids = Array.from({ length: 1 + Math.floor(rand() * 6) }, (_, i) => `txn_${String(world * 10 + i).padStart(26, "0")}`);
      const ledger: LedgerRow[] = [];
      const adjustments: PaddleAdjustment[] = [];
      for (const id of ids) {
        const code = pick(offers);
        ledger.push({ ...grant(id, BILLING_OFFERS[code].credits, code), kind: pick(["purchased", "allowance"]) });
        if (rand() < 0.4) {
          adjustments.push({ ...refund(id), action: pick(["refund", "credit", "chargeback", "chargeback_warning"]) });
          ledger.push(reversal(id));
        } else if (rand() < 0.2) adjustments.push(refund(id, pick(["pending_approval", "rejected"])));
      }
      const transactions = ids.map((id) => tx(id));
      const empty = { missingInLedger: [], missingAtProcessor: [], creditMismatch: [], reversalMissing: [], reversalUnexpected: [] };
      expect(processorDelta(ledger, transactions, adjustments)).toEqual(empty);

      const target = pick(ids);
      const corruption = pick(corruptions);
      const others = (rows: LedgerRow[]) => rows.filter((r) => r.transactionId !== target && r.reversalOfTransactionId !== target);
      const own = ledger.find((r) => r.transactionId === target)!;
      let input: Parameters<typeof processorDelta> = [ledger, transactions, adjustments];
      let bucket: keyof typeof empty;
      switch (corruption) {
        case "drop_grant": input = [ledger.filter((r) => r !== own), transactions, adjustments]; bucket = "missingInLedger"; break;
        case "drop_processor": input = [ledger, transactions.filter((t) => t.id !== target), adjustments]; bucket = "missingAtProcessor"; break;
        case "wrong_credits": input = [ledger.map((r) => (r === own ? { ...r, creditDelta: r.creditDelta + 1 } : r)), transactions, adjustments]; bucket = "creditMismatch"; break;
        case "unknown_offer": input = [ledger.map((r) => (r === own ? { ...r, offerCode: pick([null, "retired_offer", "constructor"]) } : r)), transactions, adjustments]; bucket = "creditMismatch"; break;
        case "duplicate_grant": input = [[...ledger, { ...own, eventId: "evt_dup" }], transactions, adjustments]; bucket = "creditMismatch"; break;
        case "drop_reversal":
          input = [ledger.filter((r) => r.reversalOfTransactionId !== target), transactions, [...adjustments.filter((a) => a.transactionId !== target), refund(target)]];
          bucket = "reversalMissing"; break;
        case "out_of_window_refund":
          input = [others(ledger), transactions.filter((t) => t.id !== target), [...adjustments.filter((a) => a.transactionId !== target), refund(target)]];
          bucket = "reversalMissing"; break;
        case "spurious_reversal": input = [[...ledger.filter((r) => r.reversalOfTransactionId !== target), reversal(target)], transactions, adjustments.filter((a) => a.transactionId !== target)]; bucket = "reversalUnexpected"; break;
        case "not_completed": input = [ledger, transactions.map((t) => (t.id === target ? tx(target, pick(["billed", "paid", "past_due"])) : t)), adjustments]; bucket = "missingAtProcessor"; break;
      }
      expect(processorDelta(...input)[bucket], `${corruption} in world ${world}`).toContain(target);
    }
  });
});

describe("readLedgerForReconciliation", () => {
  const ok = (rows: unknown) => new Response(JSON.stringify(rows), { status: 200 });
  const valid = { event_id: "evt_a", kind: "purchased", transaction_id: txn("a"), reversal_of_transaction_id: null, credit_delta: 2_000, offer_code: "observer_access" };
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "k".repeat(40));
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("reads typed rows and says when the page cap truncated it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok([valid])));
    await expect(readLedgerForReconciliation("2026-11-01T00:00:00Z")).resolves.toEqual({ ok: true, truncated: false, rows: [{
      eventId: "evt_a", kind: "purchased", transactionId: txn("a"), reversalOfTransactionId: null, creditDelta: 2_000, offerCode: "observer_access",
    }] });
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => ok(Array.from({ length: 1000 }, () => valid))));
    await expect(readLedgerForReconciliation("x")).resolves.toMatchObject({ ok: true, truncated: true });
  });

  it("fails typed when not configured, unreachable, non-2xx or not an array", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    await expect(readLedgerForReconciliation("x")).resolves.toEqual({ ok: false, code: "BILLING_STORE_NOT_CONFIGURED" });
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "k".repeat(40));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    await expect(readLedgerForReconciliation("x")).resolves.toEqual({ ok: false, code: "BILLING_STORE_READ_FAILED" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("[]", { status: 503 })));
    await expect(readLedgerForReconciliation("x")).resolves.toEqual({ ok: false, code: "BILLING_STORE_READ_FAILED" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok({ rows: [] })));
    await expect(readLedgerForReconciliation("x")).resolves.toEqual({ ok: false, code: "BILLING_STORE_READ_FAILED" });
  });

  it("refuses a malformed row instead of coercing it", async () => {
    for (const bad of [
      null, 7, { ...valid, event_id: undefined }, { ...valid, kind: "consumed" }, { ...valid, credit_delta: null },
      { ...valid, credit_delta: "2000" }, { ...valid, credit_delta: 1.5 }, { ...valid, transaction_id: null },
      { ...valid, kind: "reversed", transaction_id: null, reversal_of_transaction_id: null }, { ...valid, offer_code: 3 },
    ]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok([valid, bad])));
      await expect(readLedgerForReconciliation("x"), JSON.stringify(bad) ?? "undefined").resolves.toEqual({ ok: false, code: "BILLING_STORE_READ_INVALID" });
    }
  });
});

describe("priceBookDelta", () => {
  const price = (amount: string, over: Partial<PaddlePrice> = {}): PaddlePrice =>
    ({ id: `pri_${"a".repeat(26)}`, status: "active", amount, currency: "USD", interval: "month", frequency: 1, ...over });
  const pid = `pri_${"a".repeat(26)}`;
  const offer = (priceUsd: number, priceId: string | null = pid) => [{ code: "observer_access", priceId, priceUsd }];

  it("treats 2900 USD monthly as equal to a 29 catalog price", () => {
    expect(priceBookDelta(offer(29), new Map([[pid, price("2900")]]))).toEqual([]);
  });
  it("flags 2900 against a 99 catalog price", () => {
    expect(priceBookDelta(offer(99), new Map([[pid, price("2900")]]))[0].problems).toEqual(["amount_mismatch"]);
  });
  it("flags currency and interval", () => {
    const d = priceBookDelta(offer(29), new Map([[pid, price("2900", { currency: "EUR", interval: "year" })]]));
    expect(d[0].problems).toEqual(["currency_mismatch", "interval_mismatch"]);
  });
  it("makes an unreadable or unconfigured price a delta, never a skip", () => {
    expect(priceBookDelta(offer(29), new Map([[pid, null]]))[0].problems).toEqual(["price_unreadable"]);
    expect(priceBookDelta(offer(29), new Map())[0].problems).toEqual(["price_unreadable"]);
    expect(priceBookDelta(offer(29, null), new Map())[0].problems).toEqual(["price_id_not_configured"]);
  });
});
