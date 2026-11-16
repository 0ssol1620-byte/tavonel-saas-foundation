import { describe, expect, it } from "vitest";
import {
  assertEmptyLedgerDatabase, assertLoopbackDsn, checkInvariants, diffOutcome, diffValues, generateOps, hashOps, LedgerOracle, opSql, replayOps,
  type ActualSnapshot, type EventOp, type Op, type Outcome, type PsqlSession,
} from "./billing-ledger-replay";

// Pinned: a change to the generator or the weights is a change to what "1,000 events" means,
// and must be made on purpose (recompute with `hashOps(generateOps(seed, 1000))`).
const PINNED: Record<number, string> = {
  1: "7f79f234e8a04716c96a2752afcb857ae8abe1d34b06ae8787a7131c446dcc8a",
  2: "deb7b4d46f5f89128e9978c215738917dc93c560cbfe7b997b8dfacf3f42e2ec",
  3: "95a0a397690f152b2cc3adfb2266b9a2b30ed358069de2fe15b0c01c91cbaad7",
};

describe("generator", () => {
  it("is a pure function of the seed: same seed, same 1,000 ops, pinned hash", () => {
    for (const seed of [1, 2, 3]) {
      const ops = generateOps(seed, 1000);
      expect(ops).toHaveLength(1000);
      expect(hashOps(ops)).toBe(PINNED[seed]);
      expect(hashOps(generateOps(seed, 1000))).toBe(PINNED[seed]);
    }
    expect(hashOps(generateOps(4, 1000))).not.toBe(PINNED[1]);
  });

  it("meets the mix the work order asks for: >= 30% retries and duplicates, >= 5% reversals", () => {
    for (const seed of [1, 2, 3]) {
      const ops = generateOps(seed, 1000);
      expect(ops.filter((o) => o.retry).length / ops.length).toBeGreaterThanOrEqual(0.3);
      expect(ops.filter((o) => o.k === "event" && o.action === "reversal").length / ops.length).toBeGreaterThanOrEqual(0.05);
    }
  });

  it("reaches every branch the replay claims to cover, according to the oracle", () => {
    const seen = new Set<string>();
    for (const seed of [1, 2, 3]) {
      const oracle = new LedgerOracle();
      for (const op of generateOps(seed, 1000)) {
        const out = oracle.apply(op);
        seen.add(out.error ?? String(out.ok?.reason ?? out.ok?.status ?? out.ok?.state));
      }
    }
    for (const name of [
      "allowance_granted", "duplicate", "duplicate_transaction", "reversal_applied", "pending_original_transaction", "processed",
      "stale_or_mismatched_subscription", "checkout_intent_missing", "checkout_intent_expired",
      "checkout_price_not_allowed", "checkout_subscription_reuse_conflict", "checkout_binding_reuse_conflict",
      "checkout_subscription_binding_required", "checkout_binding_bootstrap_event_invalid", "foundation_billing_event_id_conflict",
      "billing_allowance_contract_invalid", "billing_purchase_contract_invalid", "billing_reversal_contract_invalid",
      "reserved", "foundation_credits_required", "foundation_billing_hold", "foundation_subscription_required",
      "foundation_compute_idempotency_conflict", "foundation_compute_reservation_invalid", "foundation_compute_reservation_not_found",
      "foundation_compute_settlement_conflict", "foundation_compute_settlement_expired", "foundation_compute_settlement_invalid",
      "foundation_compute_maximum_charge_exceeded", "foundation_compute_overage_not_enabled", "sqlstate:23505",
    ]) expect(seen, name).toContain(name);
  });
});

// ---------------------------------------------------------------------------------------------
// Oracle unit cases. The first block mirrors supabase/tests/billing_reconciliation.sql lines
// 36-200 with the same expected numbers; the grant arrives through v6 here, v4 there.
// ---------------------------------------------------------------------------------------------

const NONCE = "11110000-0000-4000-8000-000000000001";
const PRICE = "pri_00000000000000000000000001";
const SUB = "sub_00000000000000000000000001";
const intent = { k: "intent", retry: false, tag: "t", nonce: NONCE, offer: "observer_access", price: PRICE, credit: 2000 } as const;
const ev = (o: Partial<EventOp> & Pick<EventOp, "action" | "eventType" | "eventId">): EventOp => ({
  k: "event", retry: false, tag: "t", t: 10, sha: `sha256:${o.eventId}`, offer: "observer_access", txn: null, sub: SUB, status: null,
  adjustment: null, nonce: NONCE, price: PRICE, configured: null, ...o,
});
const grant = (eventId: string, txn: string) => ev({ action: "allowance", eventType: "transaction.completed", eventId, txn });
const subscribe = ev({ action: "subscription", eventType: "subscription.created", eventId: "evt_sub", status: "active" });
const reserve = (doc: string, reserved: number, max: number): Op => ({ k: "reserve", retry: false, tag: "t", doc, reserved, max });
const settle = (doc: string, outcome: string, actual: number, reason = "OCR_COMPLETED"): Op => ({ k: "settle", retry: false, tag: "t", doc, outcome, actual, reason });
const balance = (o: LedgerOracle, op: Op) => o.snapshot(op).account?.balance;

function fundedOracle(): LedgerOracle {
  const o = new LedgerOracle();
  expect(o.apply(intent).ok?.status).toBe("issued");
  expect(o.apply(subscribe).ok?.status).toBe("processed");
  return o;
}

describe("oracle, mirroring billing_reconciliation.sql", () => {
  it("grants once, answers a redelivery as a duplicate and a second event id for the same transaction as duplicate_transaction", () => {
    const o = fundedOracle();
    const first = grant("evt_a", "txn_1");
    expect(o.apply(first).ok).toMatchObject({ status: "allowance_granted", expiredIncludedUnits: 0 });
    expect(balance(o, first)).toBe(2000);
    expect(o.apply(first).ok?.status).toBe("duplicate");
    expect(balance(o, first)).toBe(2000);
    const again = grant("evt_b", "txn_1");
    expect(o.apply(again).ok?.status).toBe("duplicate_transaction");
    expect(balance(o, again)).toBe(2000);
    expect(o.snapshot(again).ledger.filter((r) => r.kind === "allowance")).toHaveLength(1);
    expect(o.apply({ ...first, sha: "sha256:other" })).toEqual({ error: "foundation_billing_event_id_conflict" });
    expect(o.snapshot(first).counts.events).toBe(3); // the subscription event and the two distinct allowance events
  });

  it("holds, replays, releases, refuses a charge after a release, and refuses a reservation above the balance", () => {
    const o = fundedOracle();
    o.apply(grant("evt_a", "txn_1"));
    const hold = reserve("doc-a", 12, 18);
    expect(o.apply(hold).ok).toMatchObject({ state: "reserved", idempotentReplay: false });
    expect(balance(o, hold)).toBe(1988);
    expect(o.apply(hold).ok).toMatchObject({ idempotentReplay: true });
    expect(balance(o, hold)).toBe(1988);
    const release = settle("doc-a", "released", 0, "UPLOAD_TRANSFER_FAILED");
    expect(o.apply(release).ok).toMatchObject({ status: "processed", releasedCredits: 12 });
    expect(balance(o, release)).toBe(2000);
    expect(o.apply(release).ok?.status).toBe("duplicate");
    expect(o.apply(settle("doc-a", "settled", 12))).toEqual({ error: "foundation_compute_settlement_conflict" });
    expect(balance(o, release)).toBe(2000);
    const big = reserve("doc-b", 60000, 60000);
    expect(o.apply(big)).toEqual({ error: "foundation_credits_required" });
    expect(balance(o, big)).toBe(2000);
    expect(o.snapshot(big).counts.reservations).toBe(1);
  });

  it("refuses a settlement after the expiry sweep and leaves the ledger at the 2000 granted less the 4 still held", () => {
    const o = fundedOracle();
    o.apply(grant("evt_a", "txn_1"));
    o.apply(reserve("doc-c", 12, 18));
    expect(o.apply({ k: "expire", retry: false, tag: "t", doc: "doc-c" }).ok).toEqual({ updated: 1 });
    const sweep = reserve("doc-d", 4, 4);
    expect(o.apply(sweep).ok?.state).toBe("reserved");
    expect(o.snapshot({ k: "settle", retry: false, tag: "t", doc: "doc-c", outcome: "released", actual: 0, reason: "X_Y_Z" }).reservation?.state).toBe("expired");
    expect(balance(o, sweep)).toBe(1996);
    expect(o.apply(settle("doc-c", "settled", 12))).toEqual({ error: "foundation_compute_settlement_expired" });
    expect(balance(o, sweep)).toBe(1996);
  });
});

describe("oracle, interleavings the SQL files do not cover", () => {
  it("resolves a reversal that arrives before its transaction when the transaction lands", () => {
    const o = fundedOracle();
    const reversal = ev({ action: "reversal", eventType: "adjustment.updated", eventId: "evt_r", txn: "txn_9", adjustment: "adj_9" });
    expect(o.apply(reversal).ok?.status).toBe("pending_original_transaction");
    expect(o.snapshot(reversal).counts.pending).toBe(1);
    const late = grant("evt_late", "txn_9");
    expect(o.apply(late).ok?.status).toBe("allowance_granted");
    const after = o.snapshot(late);
    expect(after.counts.pending).toBe(0);
    expect(after.account).toMatchObject({ balance: 0, hold: true, lifetimeReversed: 2000, overageEnabled: false });
    expect(after.events).toEqual([
      { eventId: "evt_late", result: "allowance_granted" },
      { eventId: "evt_r", result: "reversal_applied" },
    ]);
    expect(o.apply(reserve("doc-x", 1, 1))).toEqual({ error: "foundation_billing_hold" });
    expect(o.apply({ k: "clear_hold", retry: false, tag: "t" }).ok).toEqual({ updated: 1 });
    expect(o.apply(reserve("doc-x", 1, 1))).toEqual({ error: "foundation_credits_required" });
  });

  it("reverses a grant once however many reversal events arrive, and clamps the balance at zero", () => {
    const o = fundedOracle();
    o.apply(grant("evt_a", "txn_1"));
    o.apply(reserve("doc-a", 100, 100));
    const first = ev({ action: "reversal", eventType: "adjustment.updated", eventId: "evt_r1", txn: "txn_1", adjustment: "adj_1" });
    const second = ev({ action: "reversal", eventType: "adjustment.updated", eventId: "evt_r2", txn: "txn_1", adjustment: "adj_2" });
    expect(o.apply(first).ok?.status).toBe("reversal_applied");
    expect(o.snapshot(first).account).toMatchObject({ balance: 0, lifetimeReversed: 2000 });
    expect(o.apply(second).ok?.status).toBe("reversal_applied");
    expect(o.snapshot(second).ledger.filter((r) => r.kind === "reversed")).toHaveLength(1);
    expect(o.snapshot(second).account?.lifetimeReversed).toBe(2000);
    expect(o.apply(first).ok?.status).toBe("duplicate");
  });

  it("replaces the unused part of the last period when the next allowance lands", () => {
    const o = fundedOracle();
    o.apply(grant("evt_a", "txn_1"));
    o.apply(reserve("doc-a", 500, 500));
    const renewal = grant("evt_b", "txn_2");
    expect(o.apply(renewal).ok).toMatchObject({ status: "allowance_granted", expiredIncludedUnits: 1500 });
    expect(balance(o, renewal)).toBe(2000);
  });

  // Characterization of what the replay observed on the real functions, not a statement that it is
  // desired: the allowance expiry looks at the balance AFTER holds, so a hold taken before a renewal
  // and released after it lifts the new period above its allowance.
  it("returns a pre-renewal hold on top of the renewed allowance when it is released", () => {
    const o = fundedOracle();
    o.apply(grant("evt_a", "txn_1"));
    o.apply(reserve("doc-a", 500, 500));
    o.apply(grant("evt_b", "txn_2"));
    const release = settle("doc-a", "released", 0, "UPLOAD_TRANSFER_FAILED");
    expect(o.apply(release).ok).toMatchObject({ releasedCredits: 500 });
    expect(balance(o, release)).toBe(2500);
  });

  it("rolls the whole call back when a function raises", () => {
    const o = fundedOracle();
    const before = o.snapshot(grant("evt_x", "txn_x")).counts;
    expect(o.apply(ev({ action: "allowance", eventType: "transaction.updated", eventId: "evt_x", txn: "txn_x" })))
      .toEqual({ error: "billing_allowance_contract_invalid" });
    expect(o.snapshot(grant("evt_x", "txn_x")).counts).toEqual(before); // not even the nonce consumption survives
  });
});

// ---------------------------------------------------------------------------------------------
// The comparer must notice a wrong database. These are the failure paths.
// ---------------------------------------------------------------------------------------------

describe("comparison", () => {
  it("reports a deliberately corrupted database row", () => {
    const o = fundedOracle();
    const op = grant("evt_a", "txn_1");
    o.apply(op);
    const expected = o.snapshot(op);
    const corrupted = structuredClone(expected);
    (corrupted.account as Record<string, unknown>).balance = 1999;
    corrupted.ledger[0] = { ...corrupted.ledger[0], delta: 2001 };
    expect(diffValues(expected, expected)).toEqual([]);
    expect(diffValues(expected, corrupted)).toEqual([
      "account.balance: expected 2000, got 1999",
      "ledger[0].delta: expected 2000, got 2001",
    ]);
  });

  it("reports an outcome that differs in kind, name or value", () => {
    const ok: Outcome = { ok: { status: "duplicate" } };
    expect(diffOutcome(ok, { ok: { status: "duplicate", eventId: "x" } })).toEqual([]);
    expect(diffOutcome(ok, { ok: { status: "allowance_granted" } })).toHaveLength(1);
    expect(diffOutcome(ok, { error: "boom" })).toHaveLength(1);
    expect(diffOutcome({ error: "a" }, { error: "b" })).toHaveLength(1);
  });

  it("flags a broken ledger invariant", () => {
    const sound = { maxAllowancePerTxn: 1, maxReversalPerTxn: 1, balance: 1988, overageUnits: 0, lifetimeReversed: 0, ledgerSum: 2000, liveHolds: 12, charged: 0, overageCharged: 0 };
    expect(checkInvariants(sound)).toEqual([]);
    expect(checkInvariants({ ...sound, maxAllowancePerTxn: 2 })).toHaveLength(1);
    expect(checkInvariants({ ...sound, maxReversalPerTxn: 2 })).toHaveLength(1);
    expect(checkInvariants({ ...sound, balance: -1 }).length).toBeGreaterThan(0);
    expect(checkInvariants({ ...sound, balance: 1900 })).toEqual([expect.stringContaining("balance identity")]); // credit went missing
    expect(checkInvariants({ ...sound, balance: 1990 })).toEqual([expect.stringContaining("slack 2")]); // credit appeared with no reversal
    expect(checkInvariants({ ...sound, balance: 1990, lifetimeReversed: 5 })).toEqual([]); // clamp slack is allowed after a reversal
    expect(checkInvariants({ ...sound, overageUnits: 3 })).toEqual([expect.stringContaining("overage_units")]);
  });
});

describe("database access", () => {
  it("refuses a DSN that is not loopback", () => {
    expect(() => assertLoopbackDsn("postgres://postgres@127.0.0.1:55439/tavonel_local")).not.toThrow();
    expect(() => assertLoopbackDsn("postgres://postgres@localhost/x")).not.toThrow();
    expect(() => assertLoopbackDsn("postgres://postgres:pw@db.example.com:5432/postgres")).toThrow(/loopback/);
    expect(() => assertLoopbackDsn("postgres://postgres@10.0.0.5/x")).toThrow(/loopback/);
    expect(() => assertLoopbackDsn("not a url")).toThrow(/loopback/);
  });

  it("refuses to replay into a database that already holds billing rows", async () => {
    const answering = (counts: Record<string, number>): PsqlSession => ({ async close() {}, async query() { return [JSON.stringify(counts)]; } });
    await expect(assertEmptyLedgerDatabase(answering({ foundation_billing_accounts: 0, foundation_credit_ledger: 0 }))).resolves.toBeUndefined();
    await expect(assertEmptyLedgerDatabase(answering({ foundation_billing_accounts: 1, foundation_credit_ledger: 0 })))
      .rejects.toThrow(/foundation_billing_accounts=1/);
  });

  it("sends each op to the runtime function the route calls", () => {
    const ops = generateOps(1, 1000);
    const names = (k: Op["k"], fn: string) => ops.filter((o) => o.k === k).every((o) => opSql(o).includes(fn));
    expect(names("event", "apply_foundation_billing_event_v6")).toBe(true);
    expect(names("reserve", "reserve_foundation_compute_v3")).toBe(true);
    expect(names("settle", "settle_foundation_compute_v3")).toBe(true);
    expect(names("intent", "issue_foundation_checkout_intent")).toBe(true);
    expect(ops.some((o) => o.k === "expire")).toBe(true);
  });
});

// replayOps against a session that answers from a second oracle: proves the runner's wiring (the
// statement it sends, the lines it reads, the report it builds) without a database.
function sessionAnsweringFrom(ops: readonly Op[], corruptAt: number): PsqlSession {
  const oracle = new LedgerOracle();
  let i = 0;
  return {
    async close() {},
    async query(sql) {
      if (!sql.includes("pg_temp.try($q$")) return [];
      const op = ops[i];
      const outcome = oracle.apply(op);
      const actual = { ...structuredClone(oracle.snapshot(op)), invariants: { maxAllowancePerTxn: 0, maxReversalPerTxn: 0, balance: null } } as ActualSnapshot;
      if (i === corruptAt && actual.account) actual.account.balance = (actual.account.balance as number) + 1;
      i++;
      return [JSON.stringify(outcome.error ? { error: outcome.error, state: "P0001" } : { ok: outcome.ok }), JSON.stringify(actual)];
    },
  };
}

describe("replayOps", () => {
  const ops = generateOps(7, 60);
  it("returns null when the database agrees throughout", async () => {
    expect(await replayOps(sessionAnsweringFrom(ops, -1), 7, ops)).toBeNull();
  });
  it("names the seed, the op index and the differing field when one database row is wrong", async () => {
    const failure = await replayOps(sessionAnsweringFrom(ops, 30), 7, ops);
    expect(failure).toMatchObject({ seed: 7, index: 30 });
    expect(failure?.problems).toEqual([expect.stringMatching(/^account\.balance: expected \d+, got \d+$/)]);
  });
});
