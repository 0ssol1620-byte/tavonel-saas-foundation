import { describe, expect, it } from "vitest";
import type { PaddleAdjustment, PaddlePrice, PaddleTransaction } from "./paddle-api";
import { priceBookDelta, processorDelta, type LedgerRow } from "./paddle-reconciliation";

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
