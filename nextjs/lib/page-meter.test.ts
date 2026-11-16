/**
 * Page meter, application half (Foundation migration 20261117120000).
 *
 * The ledger decides each charge; this file pins what the application sends and which answers it
 * will accept. `supabase/tests/foundation_page_meter.sql` is the half that cannot be mocked:
 * whether the database moves the balance the way these receipts say.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { settleFoundationMeteredCompute, type MeteredSettlement } from "./compute-reservation";
import { creditsForMeteredPages, MAX_UNITS_PER_PAGE, STANDARD_UNITS_PER_PAGE } from "./usage-pricing";
import {
  generateOps, hashOps, LedgerOracle, mulberry32, opSql, shadowCompare, type CompileOp, type Op, type SettleOp,
} from "./billing-ledger-replay";

const reservationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const sent: MeteredSettlement = {
  workspaceKey: "pilot-4444444444444444",
  documentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  outcome: "settled",
  pages: 3,
  complexPages: null,
  sourceSha256: `sha256:${"a".repeat(64)}`,
  reasonCode: "OCR_COMPLETED",
};

function receipt(overrides: Record<string, unknown> = {}) {
  return {
    status: "processed", reservationId, state: "settled", settledCredits: 12, billingSource: "paid",
    meteredPages: 3, meteredComplexPages: null, chargeBasis: "pages", chargeBasisReservationId: null,
    ...overrides,
  };
}

function ledgerAnswers(body: unknown, status = 200) {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", `sb_secret_${"s".repeat(31)}`);
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("credits for metered pages", () => {
  it("charges a standard page 4 and a complex page 6, the quote's own constants", () => {
    expect(creditsForMeteredPages(3, null)).toBe(3 * STANDARD_UNITS_PER_PAGE);
    expect(creditsForMeteredPages(3, 0)).toBe(12);
    expect(creditsForMeteredPages(3, 1)).toBe(2 * STANDARD_UNITS_PER_PAGE + MAX_UNITS_PER_PAGE);
    expect(creditsForMeteredPages(3, 1)).toBe(14);
  });

  it("is the same sum the ledger computes", () => {
    const sql = readFileSync(resolve(import.meta.dirname, "../../supabase/migrations/20261117120000_page_meter_settlement.sql"), "utf8");
    expect(sql).toContain(
      `v_metered := (p_pages - v_complex) * ${STANDARD_UNITS_PER_PAGE} + v_complex * ${MAX_UNITS_PER_PAGE};`);
  });
});

describe("metered settlement", () => {
  it("sends the pages, the worker's digest and nothing priced", async () => {
    const fetcher = ledgerAnswers(receipt());
    await expect(settleFoundationMeteredCompute(sent)).resolves.toMatchObject({ ok: true });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toContain("/rest/v1/rpc/settle_foundation_compute_v4");
    expect(JSON.parse(String(init.body))).toEqual({
      p_workspace_key: sent.workspaceKey, p_document_id: sent.documentId, p_outcome: "settled",
      p_pages: 3, p_complex_pages: null, p_source_sha256: sent.sourceSha256, p_reason_code: "OCR_COMPLETED",
    });
  });

  it("refuses a settled read with no page count before calling the ledger", async () => {
    const fetcher = ledgerAnswers(receipt());
    await expect(settleFoundationMeteredCompute({ ...sent, pages: null })).resolves
      .toEqual({ ok: false, code: "COMPUTE_PAGE_COUNT_REQUIRED" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ["zero pages", { pages: 0 }], ["a fraction", { pages: 2.5 }], ["NaN", { pages: Number.NaN }],
    ["more complex than pages", { complexPages: 4 }], ["complex without pages", { outcome: "operator_review", pages: null, complexPages: 0 }],
    ["a digest that is not one", { sourceSha256: "sha256:abc" }], ["a release", { outcome: "released" }],
  ])("refuses %s as invalid", async (_label, change) => {
    const fetcher = ledgerAnswers(receipt());
    await expect(settleFoundationMeteredCompute({ ...sent, ...change } as MeteredSettlement)).resolves
      .toEqual({ ok: false, code: "COMPUTE_SETTLEMENT_INVALID" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("maps the ledger's page-count refusal to its own code", async () => {
    ledgerAnswers({ message: "foundation_compute_page_count_required" }, 400);
    await expect(settleFoundationMeteredCompute(sent)).resolves.toEqual({ ok: false, code: "COMPUTE_PAGE_COUNT_REQUIRED" });
  });

  it.each([
    ["processed", receipt()],
    ["duplicate, for a retried settlement", receipt({ status: "duplicate" })],
    ["free for an unchanged source", receipt({ settledCredits: 0, chargeBasis: "unchanged_source", chargeBasisReservationId: reservationId })],
    ["capped at the approval", receipt({ settledCredits: 4, chargeBasis: "pages_capped" })],
  ])("accepts a receipt that is %s", async (_label, body) => {
    ledgerAnswers(body);
    await expect(settleFoundationMeteredCompute(sent)).resolves.toMatchObject({ ok: true, result: body });
  });

  it("accepts a failed read only at zero", async () => {
    ledgerAnswers(receipt({ state: "operator_review", meteredPages: null, settledCredits: 0, chargeBasis: "no_usable_output" }));
    await expect(settleFoundationMeteredCompute({ ...sent, outcome: "operator_review", pages: null, reasonCode: "PAGE_COUNT_UNKNOWN" }))
      .resolves.toMatchObject({ ok: true });
  });

  it.each([
    ["a charge that is not the pages", receipt({ settledCredits: 8 })],
    ["the per-document constant", receipt({ settledCredits: 2, chargeBasis: null })],
    ["another page count", receipt({ meteredPages: 4 })],
    ["a free source with no match", receipt({ settledCredits: 0, chargeBasis: "unchanged_source" })],
    ["a free source that charged", receipt({ settledCredits: 12, chargeBasis: "unchanged_source", chargeBasisReservationId: reservationId })],
    ["a cap above the pages", receipt({ settledCredits: 16, chargeBasis: "pages_capped" })],
    ["a different outcome", receipt({ state: "operator_review" })],
    ["no reservation", receipt({ reservationId: "nope" })],
  ])("refuses a receipt with %s", async (_label, body) => {
    ledgerAnswers(body);
    await expect(settleFoundationMeteredCompute(sent)).resolves.toEqual({ ok: false, code: "COMPUTE_SETTLEMENT_RECEIPT_INVALID" });
  });

  it("refuses a charged failed read", async () => {
    ledgerAnswers(receipt({ state: "operator_review", meteredPages: null, settledCredits: 2, chargeBasis: "no_usable_output" }));
    await expect(settleFoundationMeteredCompute({ ...sent, outcome: "operator_review", pages: null }))
      .resolves.toEqual({ ok: false, code: "COMPUTE_SETTLEMENT_RECEIPT_INVALID" });
  });
});

// ---------------------------------------------------------------------------------------------
// WO-D27-4 ladder, local half. Compatibility: v3 stays the callee of everything the meter does not
// change. Shadow: the v3 and v4 oracles run the same metered stream from the same state and every
// difference must be one the page-meter rules name. OC-3: a refunded read is charged again on the
// first later `ready` compile. The database half is billing-ledger-replay.db.test.ts.
// ---------------------------------------------------------------------------------------------

const METERED_PINNED: Record<number, string> = {
  1: "c2d0e9cbb190a108ab1640f72086d86d660e3264b77cd24770777117b1168cf2",
  2: "0da28edb1f6203966b1b5a98d59557f70485660c808dd1b6e57f4123e3029f77",
  3: "9b1cda73626101457117fd92d5974770c6ba3bc05b1871e5a436b04c8e31b74f",
};

describe("metered replay stream", () => {
  it("is a pure function of the seed, pinned, and leaves the pre-meter stream exactly as it was", () => {
    for (const seed of [1, 2, 3]) {
      const ops = generateOps(seed, 1000, { meter: true });
      expect(ops).toHaveLength(1000);
      expect({ seed, hash: hashOps(ops) }).toEqual({ seed, hash: METERED_PINNED[seed] });
      expect(hashOps(generateOps(seed, 1000, { meter: true }))).toBe(METERED_PINNED[seed]);
      const plain = generateOps(seed, 1000);
      expect(hashOps(plain)).toBe(hashOps(generateOps(seed, 1000, { meter: false })));
      expect(plain.some((o) => o.k === "compile" || (o.k === "settle" && "pages" in o))).toBe(false);
    }
  }, 60_000);

  it("carries page facts on every settle and compiles that fail, succeed, stop and wait for review", () => {
    for (const seed of [1, 2, 3]) {
      const ops = generateOps(seed, 1000, { meter: true });
      expect(ops.filter((o) => o.k === "settle").every((o) => o.k === "settle" && "pages" in o)).toBe(true);
      const states = new Set(ops.flatMap((o) => (o.k === "compile" ? [o.state] : [])));
      expect([...states].sort()).toEqual(["cancelled", "failed", "ready", "review_required"]);
      expect(ops.filter((o) => o.retry).length / ops.length).toBeGreaterThanOrEqual(0.3);
    }
  }, 60_000);

  it("sends finished and failed reads to v4 and keeps every release, and every v3 run, on v3", () => {
    const ops = generateOps(1, 1000, { meter: true });
    for (const op of ops.filter((o): o is SettleOp => o.k === "settle")) {
      expect(opSql(op, "v3")).toContain("settle_foundation_compute_v3(");
      expect(opSql(op, "v4")).toContain(op.outcome === "released" ? "settle_foundation_compute_v3(" : "settle_foundation_compute_v4(");
    }
    expect(ops.filter((o) => o.k === "compile").every((o) => opSql(o, "v4").startsWith("select pg_temp.compile("))).toBe(true);
  }, 60_000);
});

describe("shadow: v3 and v4 on the same stream", () => {
  it("differs only where a page-meter rule says, over 3 x 1,000 ops, and reaches every rule", () => {
    const seen = new Set<string>();
    for (const seed of [1, 2, 3]) {
      const { rules, unexplained } = shadowCompare(generateOps(seed, 1000, { meter: true }));
      expect(unexplained, `seed ${seed}: ${JSON.stringify(unexplained.slice(0, 3))}`).toEqual([]);
      Object.keys(rules).forEach((r) => seen.add(r));
    }
    for (const rule of [
      "identical", "pages_rate", "pages_capped", "unchanged_source", "no_usable_output", "page_count_required",
      "page_facts_invalid", "idempotent_on_page_facts", "failed_compile_reversal", "ready_recharge",
    ]) expect(seen, rule).toContain(rule);
  }, 120_000);

  it("reports a v4 charge no rule explains, and a difference on an op the meter does not touch", () => {
    const ops = generateOps(2, 1000, { meter: true });
    const v4 = new LedgerOracle("v4");
    let charged = false;
    let untouched = false;
    for (const op of ops) {
      const pre = v4.fork();
      const v3 = v4.fork("v3");
      const o3 = v3.apply(op);
      const o4 = v4.apply(op);
      if (!charged && op.k === "settle" && o4.ok?.status === "processed" && o4.ok.chargeBasis === "pages") {
        const tampered = { ok: { ...o4.ok, settledCredits: (o4.ok.settledCredits as number) + 1 } };
        expect(LedgerOracle.explainShadow(op, pre, v3, o3, v4, tampered).rule).toBeNull();
        charged = true;
      }
      if (!untouched && op.k === "reserve" && o4.ok?.idempotentReplay === false) {
        const drifted = v4.fork();
        drifted.apply({ k: "clear_hold", retry: false, tag: "t" });
        drifted.apply({ k: "reserve", retry: false, tag: "t", doc: "drift", reserved: 1, max: 1 });
        expect(LedgerOracle.explainShadow(op, pre, v3, o3, drifted, o4).rule).toBeNull();
        untouched = true;
      }
    }
    expect(charged && untouched).toBe(true);
  }, 60_000);
});

describe("OC-3: refunded, then used, is charged again", () => {
  const SRC = `sha256:${"c".repeat(64)}`;
  const NONCE = "11110000-0000-4000-8000-000000000001";
  const funded = () => {
    const o = new LedgerOracle("v4");
    o.apply({ k: "intent", retry: false, tag: "t", nonce: NONCE, offer: "observer_access", price: "pri_1", credit: 2000 });
    const base = { k: "event", retry: false, tag: "t", t: 10, offer: "observer_access", sub: "sub_1", adjustment: null, nonce: NONCE, price: "pri_1", configured: null } as const;
    o.apply({ ...base, action: "subscription", eventType: "subscription.created", eventId: "evt_s", sha: "sha256:s", txn: null, status: "active" });
    o.apply({ ...base, action: "allowance", eventType: "transaction.completed", eventId: "evt_a", sha: "sha256:a", txn: "txn_1", status: null });
    return o;
  };
  const read = (doc: string, reserved: number, max: number, pages: number): [Op, Op] => [
    { k: "reserve", retry: false, tag: "t", doc, reserved, max },
    { k: "settle", retry: false, tag: "t", doc, outcome: "settled", actual: 2, reason: "OCR_COMPLETED", pages, complex: null, src: SRC },
  ];
  const compile = (job: string, docs: string[], state: CompileOp["state"]): CompileOp => ({ k: "compile", retry: false, tag: "t", job, docs, state });
  const account = (o: LedgerOracle) => o.snapshot({ k: "clear_hold", retry: false, tag: "t" }).account;
  const row = (o: LedgerOracle, doc: string) => o.snapshot({ k: "expire", retry: false, tag: "t", doc }).reservation;

  it("refunds on a failed compile, charges again on the first later ready, once, and never refunds a used read", () => {
    const o = funded();
    read("doc-a", 4, 12, 3).forEach((op) => o.apply(op)); // 12 against a hold of 4: 4 from the balance, 8 overage
    expect(account(o)).toMatchObject({ balance: 1996, overageUnits: 8 });
    expect(o.apply(compile("j1", ["doc-a"], "failed")).ok).toEqual({ reversed: 1, recharged: 0 });
    expect(account(o)).toMatchObject({ balance: 2000, overageUnits: 0, lifetimeOverage: 0 });
    expect(o.apply(compile("j2", ["doc-a"], "review_required")).ok).toEqual({ reversed: 0, recharged: 0 });
    expect(o.apply(compile("j3", ["doc-a"], "ready")).ok).toEqual({ reversed: 0, recharged: 1 });
    expect(row(o, "doc-a")).toMatchObject({ reversed: 12, recharged: 12, rechargedBalance: 4 });
    expect(account(o)).toMatchObject({ balance: 1996, overageUnits: 8, lifetimeOverage: 8 });
    expect(o.apply(compile("j4", ["doc-a"], "ready")).ok).toEqual({ reversed: 0, recharged: 0 });
    expect(o.apply(compile("j5", ["doc-a"], "failed")).ok).toEqual({ reversed: 0, recharged: 0 });
    expect(account(o)).toMatchObject({ balance: 1996, overageUnits: 8 });
  });

  it("books what a spent balance cannot pay as overage, so the whole refund is charged again", () => {
    const o = funded();
    read("doc-a", 12, 18, 3).forEach((op) => o.apply(op));
    o.apply(compile("j1", ["doc-a"], "failed"));
    o.apply({ k: "reserve", retry: false, tag: "t", doc: "doc-b", reserved: 1995, max: 1995 }); // spends down to 5
    expect(account(o)?.balance).toBe(5);
    expect(o.apply(compile("j2", ["doc-a"], "ready")).ok).toEqual({ reversed: 0, recharged: 1 });
    expect(account(o)).toMatchObject({ balance: 0, overageUnits: 7 });
    expect(row(o, "doc-a")).toMatchObject({ recharged: 12, rechargedBalance: 5 });
  });

  it("treats a read charged again as paid for: the same source read later is free", () => {
    const o = funded();
    read("doc-a", 12, 18, 3).forEach((op) => o.apply(op));
    o.apply(compile("j1", ["doc-a"], "failed"));
    const [hold, settle] = read("doc-b", 12, 18, 3);
    const before = o.fork();
    before.apply(hold);
    expect(before.apply(settle).ok?.chargeBasis).toBe("pages"); // refunded: not a paid source
    o.apply(compile("j2", ["doc-a"], "ready"));
    o.apply(hold);
    expect(o.apply(settle).ok?.chargeBasis).toBe("unchanged_source"); // charged again: paid
  });
});

describe("application and ledger refuse the same page facts", () => {
  // Property: for any page facts, the application's pre-check refuses exactly what the ledger's own
  // validation (ported from the SQL into the replay oracle) refuses, so a read never loops on a 503
  // the ledger would have accepted, and the application never forwards what the ledger rejects.
  it("agrees on 2,000 random inputs, including non-integers and the edges", async () => {
    const rnd = mulberry32(2027);
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
    const numbers = [null, -1, 0, 1, 2, 3, 1.5, 9999, 10000, 10001, Number.NaN, Number.MAX_SAFE_INTEGER + 2] as const;
    const sources = [null, `sha256:${"a".repeat(64)}`, `sha256:${"A".repeat(64)}`, "sha256:xyz", `sha256:${"a".repeat(63)}`] as const;
    for (let i = 0; i < 2000; i++) {
      const facts = { outcome: pick(["settled", "operator_review"] as const), pages: pick(numbers), complexPages: pick(numbers), sourceSha256: pick(sources) };
      // The ledger answers "no such reservation" to anything that reaches it: a refusal before it is the application's.
      const fetcher = ledgerAnswers({ message: "foundation_compute_reservation_not_found" }, 400);
      const app = await settleFoundationMeteredCompute({ ...sent, ...facts });
      const ledger = new LedgerOracle("v4").apply({
        k: "settle", retry: false, tag: "t", doc: "none", outcome: facts.outcome, actual: 0, reason: "OCR_COMPLETED",
        pages: facts.pages, complex: facts.complexPages, src: facts.sourceSha256,
      });
      const appAnswer = fetcher.mock.calls.length > 0 ? "reached the ledger" : app.ok ? "accepted without the ledger" : app.code;
      const ledgerAnswer = ledger.error === "foundation_compute_settlement_invalid" ? "COMPUTE_SETTLEMENT_INVALID"
        : ledger.error === "foundation_compute_page_count_required" ? "COMPUTE_PAGE_COUNT_REQUIRED" : "reached the ledger";
      // A non-integer never reaches the ledger's integer columns: the application refuses it as invalid.
      const integral = [facts.pages, facts.complexPages].every((n) => n === null || Number.isSafeInteger(n));
      expect(appAnswer, JSON.stringify(facts)).toBe(integral ? ledgerAnswer : "COMPUTE_SETTLEMENT_INVALID");
    }
  });
});
