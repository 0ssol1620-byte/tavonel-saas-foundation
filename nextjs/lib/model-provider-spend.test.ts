import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  markModelProviderSpendDispatchStarted, markModelProviderSpendIndeterminate,
  reconcileModelProviderSpend,
  reserveModelProviderSpend, runReservedModelProviderCall, settleModelProviderSpend,
} from "./model-provider-spend";

const base = {
  tenantId: "pilot-tenant-a", requestKey: "request-0001",
  requestDigest: `sha256:${"a".repeat(64)}`, provider: "runpod",
  model: "BAAI/bge-m3", meter: "gpu_second", reservedUnits: 30,
};
const reservationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function configure() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", `sb_secret_${"s".repeat(31)}`);
}

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("model-provider spend RPC client", () => {
  it.each([
    ["model_provider_price_unavailable", "MODEL_PROVIDER_PRICE_UNAVAILABLE"],
    ["model_provider_accounting_unavailable", "MODEL_PROVIDER_ACCOUNTING_UNAVAILABLE"],
    ["model_provider_global_spend_breaker_open", "MODEL_PROVIDER_GLOBAL_SPEND_BREAKER_OPEN"],
    ["model_provider_tenant_spend_breaker_open", "MODEL_PROVIDER_TENANT_SPEND_BREAKER_OPEN"],
  ])("fails closed on %s", async (message, code) => {
    configure();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message }), { status: 400 })));
    await expect(reserveModelProviderSpend(base)).resolves.toEqual({ ok: false, code });
  });

  it("allows dispatch only for a receipt bound to the exact request and price", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: "reserved", reservationId, tenantId: base.tenantId,
      requestKey: base.requestKey, requestDigest: base.requestDigest,
      provider: base.provider, model: base.model, meter: base.meter,
      priceVersion: "runpod-2026-09", unitMicrousd: 500,
      reservedUnits: 30, reservedMicrousd: 15000,
      expiresAt: new Date(Date.now() + 120_000).toISOString(), idempotentReplay: false,
    }), { status: 200 })));
    await expect(reserveModelProviderSpend(base)).resolves.toMatchObject({ ok: true, dispatchAllowed: true });
  });

  it("keeps a fair-queue receipt from authorizing provider dispatch", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: "queued", reservationId, tenantId: base.tenantId,
      requestKey: base.requestKey, requestDigest: base.requestDigest,
      provider: base.provider, model: base.model, meter: base.meter,
      priceVersion: "runpod-2026-09", unitMicrousd: 500,
      reservedUnits: 30, reservedMicrousd: 15000, expiresAt: null, idempotentReplay: false,
    }), { status: 200 })));
    await expect(reserveModelProviderSpend(base)).resolves.toMatchObject({ ok: true, dispatchAllowed: false });
  });

  it("fails closed and preserves the receipt when a queued replay trips a breaker", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: "rejected", reservationId, code: "MODEL_PROVIDER_TENANT_SPEND_BREAKER_OPEN",
      tenantId: base.tenantId, requestKey: base.requestKey, requestDigest: base.requestDigest,
    }), { status: 200 })));
    await expect(reserveModelProviderSpend(base)).resolves.toMatchObject({
      ok: false, code: "MODEL_PROVIDER_TENANT_SPEND_BREAKER_OPEN",
    });
  });

  it("never invokes a paid callback while the fair queue withholds admission", async () => {
    const call = vi.fn();
    const ledger = {
      reserve: vi.fn().mockResolvedValue({ ok: true, dispatchAllowed: false, receipt: { status: "queued" } }),
      settle: vi.fn(),
      markIndeterminate: vi.fn(),
    };
    await expect(runReservedModelProviderCall(base, call, ledger as never)).resolves.toMatchObject({
      ok: false, code: "MODEL_PROVIDER_QUEUED",
    });
    expect(call).not.toHaveBeenCalled();
    expect(ledger.settle).not.toHaveBeenCalled();
  });

  it("preserves a reservation for reconciliation when the provider outcome is unknown", async () => {
    const ledger = {
      reserve: vi.fn().mockResolvedValue({ ok: true, dispatchAllowed: true,
        receipt: { reservationId } }),
      settle: vi.fn(),
      markIndeterminate: vi.fn().mockResolvedValue({ ok: true,
        receipt: { status: "pending_reconciliation", reservationId } }),
      markDispatchStarted: vi.fn().mockResolvedValue({ ok: true,
        receipt: { status: "dispatch_started", reservationId } }),
    };
    await expect(runReservedModelProviderCall(base, async () => { throw new Error("offline"); }, ledger as never))
      .resolves.toMatchObject({ ok: false, code: "MODEL_PROVIDER_CALL_INDETERMINATE" });
    expect(ledger.settle).not.toHaveBeenCalled();
    expect(ledger.markIndeterminate).toHaveBeenCalledWith(expect.objectContaining({
      reservationId, reasonCode: "PROVIDER_CALL_FAILED",
    }));
  });

  it("preserves the hold when returned usage is not trustworthy", async () => {
    const ledger = {
      reserve: vi.fn().mockResolvedValue({ ok: true, dispatchAllowed: true,
        receipt: { reservationId } }),
      settle: vi.fn(),
      markIndeterminate: vi.fn().mockResolvedValue({ ok: true,
        receipt: { status: "pending_reconciliation", reservationId } }),
      markDispatchStarted: vi.fn().mockResolvedValue({ ok: true,
        receipt: { status: "dispatch_started", reservationId } }),
    };
    await expect(runReservedModelProviderCall(base, async () => ({
      value: "unsafe", actualUnits: base.reservedUnits + 1, reasonCode: "PROVIDER_COMPLETED",
    }), ledger as never)).resolves.toMatchObject({
      ok: false, code: "MODEL_PROVIDER_RESULT_INDETERMINATE",
    });
    expect(ledger.settle).not.toHaveBeenCalled();
    expect(ledger.markIndeterminate).toHaveBeenCalledWith(expect.objectContaining({
      reservationId, reasonCode: "PROVIDER_RESULT_INVALID",
    }));
  });

  it.each([
    ["MODEL_PROVIDER_DISPATCH_ALREADY_STARTED", "MODEL_PROVIDER_DISPATCH_ALREADY_STARTED"],
    ["MODEL_PROVIDER_LEDGER_FAILED", "MODEL_PROVIDER_DISPATCH_MARK_FAILED"],
  ])("never calls the provider or releases when the dispatch mark returns %s", async (markCode, code) => {
    const call = vi.fn();
    const ledger = {
      reserve: vi.fn().mockResolvedValue({ ok: true, dispatchAllowed: true, receipt: { reservationId } }),
      settle: vi.fn(),
      markIndeterminate: vi.fn(),
      markDispatchStarted: vi.fn().mockResolvedValue({ ok: false, code: markCode }),
    };
    await expect(runReservedModelProviderCall(base, call, ledger as never))
      .resolves.toEqual({ ok: false, code });
    expect(call).not.toHaveBeenCalled();
    expect(ledger.settle).not.toHaveBeenCalled();
    expect(ledger.markIndeterminate).not.toHaveBeenCalled();
  });

  it("accepts only a fresh dispatch-start receipt bound to the reservation and tenant", async () => {
    configure();
    const fresh = { status: "dispatch_started", reservationId, tenantId: base.tenantId,
      dispatchStartedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() };
    const reply = (body: unknown) => vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify(body), { status: 200 }));
    vi.stubGlobal("fetch", reply(fresh));
    await expect(markModelProviderSpendDispatchStarted({ tenantId: base.tenantId, reservationId }))
      .resolves.toEqual({ ok: true, receipt: fresh });
    for (const patch of [{ status: "duplicate" }, { reservationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
      { tenantId: "other-tenant" }]) {
      vi.stubGlobal("fetch", reply({ ...fresh, ...patch }));
      await expect(markModelProviderSpendDispatchStarted({ tenantId: base.tenantId, reservationId }))
        .resolves.toEqual({ ok: false, code: "MODEL_PROVIDER_DISPATCH_MARK_RECEIPT_INVALID" });
    }
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      message: "model_provider_dispatch_already_started" }), { status: 400 })));
    await expect(markModelProviderSpendDispatchStarted({ tenantId: base.tenantId, reservationId }))
      .resolves.toEqual({ ok: false, code: "MODEL_PROVIDER_DISPATCH_ALREADY_STARTED" });
    await expect(markModelProviderSpendDispatchStarted({ tenantId: base.tenantId, reservationId: "x" }))
      .resolves.toEqual({ ok: false, code: "MODEL_PROVIDER_RESERVATION_INVALID" });
  });

  it("rejects a mismatched reservation receipt", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: "reserved", reservationId, tenantId: "other-tenant",
    }), { status: 200 })));
    await expect(reserveModelProviderSpend(base)).resolves.toEqual({
      ok: false, code: "MODEL_PROVIDER_RESERVATION_RECEIPT_INVALID",
    });
  });

  // A queued request that the sweep expired before admission replays as a terminal receipt.
  const expiredReplay = {
    status: "expired", reservationId, tenantId: base.tenantId,
    requestKey: base.requestKey, requestDigest: base.requestDigest,
    provider: base.provider, model: base.model, meter: base.meter,
    priceVersion: "runpod-2026-09", unitMicrousd: 500,
    reservedUnits: 30, reservedMicrousd: 15000, expiresAt: null, idempotentReplay: true,
  };
  const replyWith = (body: unknown) => vi.fn().mockImplementation(async () =>
    new Response(JSON.stringify(body), { status: 200 }));

  it("returns a stable terminal code for an expired queued replay and never dispatches", async () => {
    configure();
    const fetch = replyWith(expiredReplay);
    vi.stubGlobal("fetch", fetch);
    const expected = { ok: false, code: "MODEL_PROVIDER_RESERVATION_EXPIRED", receipt: expiredReplay };
    await expect(reserveModelProviderSpend(base)).resolves.toEqual(expected);
    await expect(reserveModelProviderSpend(base)).resolves.toEqual(expected);
    const call = vi.fn();
    await expect(runReservedModelProviderCall(base, call)).resolves.toEqual(expected);
    expect(call).not.toHaveBeenCalled();
    // Three reserve RPCs and nothing else: no settlement or reconciliation mark follows.
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  const malformedExpiredReplays: [string, Record<string, unknown>][] = [
    ["a malformed reservation id", { reservationId: "not-a-uuid" }],
    ["another tenant", { tenantId: "other-tenant" }],
    ["another request key", { requestKey: "request-0002" }],
    ["another request digest", { requestDigest: `sha256:${"b".repeat(64)}` }],
    ["another provider", { provider: "other-provider" }],
    ["another model", { model: "other/model" }],
    ["another meter", { meter: "token" }],
    ["a non-positive unit price", { unitMicrousd: 0 }],
    ["other reserved units", { reservedUnits: 31 }],
    ["an inconsistent reserved cost", { reservedMicrousd: 15001 }],
    ["no price version", { priceVersion: undefined }],
    ["an expiry", { expiresAt: new Date(Date.now() + 120_000).toISOString() }],
    ["a first-attempt flag", { idempotentReplay: false }],
    ["a non-boolean replay flag", { idempotentReplay: "true" }],
    ["no replay flag", { idempotentReplay: undefined }],
  ];
  it.each(malformedExpiredReplays)("rejects an expired replay carrying %s", async (_label, patch) => {
    configure();
    vi.stubGlobal("fetch", replyWith({ ...expiredReplay, ...patch }));
    await expect(reserveModelProviderSpend(base)).resolves.toEqual({
      ok: false, code: "MODEL_PROVIDER_RESERVATION_RECEIPT_INVALID",
    });
  });

  it("accepts an idempotent settlement and its measured cost", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: "duplicate", reservationId, state: "settled", actualUnits: 8, actualMicrousd: 4000,
    }), { status: 200 })));
    await expect(settleModelProviderSpend({ tenantId: base.tenantId, reservationId,
      outcome: "settled", actualUnits: 8, reasonCode: "PROVIDER_COMPLETED" }))
      .resolves.toMatchObject({ ok: true });
  });

  it("accepts an idempotent durable pending-reconciliation receipt", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: "duplicate", reservationId, state: "reserved", reconciliationStatus: "pending",
      reservedUnits: base.reservedUnits, reservedMicrousd: 15000,
    }), { status: 200 })));
    await expect(markModelProviderSpendIndeterminate({ tenantId: base.tenantId, reservationId,
      reasonCode: "PROVIDER_CALL_FAILED" })).resolves.toMatchObject({ ok: true });
  });

  it("accepts an idempotent reconciliation receipt bound to outcome and usage", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: "duplicate", reservationId, state: "settled", actualUnits: 8,
      actualMicrousd: 4000, reconciliationStatus: "resolved",
    }), { status: 200 })));
    await expect(reconcileModelProviderSpend({ tenantId: base.tenantId, reservationId,
      outcome: "settled", actualUnits: 8, reasonCode: "PROVIDER_EVIDENCE_CONFIRMED" }))
      .resolves.toMatchObject({ ok: true });
  });

  // Every one of these used to collapse into MODEL_PROVIDER_LEDGER_FAILED, so an operator
  // reconciling a typo'd or already-settled reservation could not tell their own mistake from
  // the ledger being down.
  it.each([
    ["model_provider_reservation_not_found", "MODEL_PROVIDER_RESERVATION_NOT_FOUND"],
    ["model_provider_reservation_not_active", "MODEL_PROVIDER_RESERVATION_NOT_ACTIVE"],
    ["model_provider_reconciliation_not_found", "MODEL_PROVIDER_RECONCILIATION_NOT_FOUND"],
    ["model_provider_reconciliation_conflict", "MODEL_PROVIDER_RECONCILIATION_CONFLICT"],
    ["model_provider_reserved_cost_exceeded", "MODEL_PROVIDER_RESERVED_COST_EXCEEDED"],
  ])("names %s instead of reporting a generic ledger failure", async (message, code) => {
    configure();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message }), { status: 400 })));
    await expect(reconcileModelProviderSpend({ tenantId: base.tenantId, reservationId,
      outcome: "settled", actualUnits: 8, reasonCode: "PROVIDER_EVIDENCE_CONFIRMED" }))
      .resolves.toEqual({ ok: false, code });
  });

  it("still reports an unrecognised ledger message as a ledger failure", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "connection reset" }), { status: 500 })));
    await expect(reconcileModelProviderSpend({ tenantId: base.tenantId, reservationId,
      outcome: "settled", actualUnits: 8, reasonCode: "PROVIDER_EVIDENCE_CONFIRMED" }))
      .resolves.toEqual({ ok: false, code: "MODEL_PROVIDER_LEDGER_FAILED" });
  });
});

describe("model-provider spend migration contract", () => {
  const sql = readFileSync(resolve(import.meta.dirname,
    "../../supabase/migrations/20260920131000_model_provider_spend_control.sql"), "utf8");

  it("requires exactly one current price and both accounting scopes", () => {
    expect(sql).toContain("if v_price_count <> 1");
    expect(sql).toContain("model_provider_price_unavailable");
    expect(sql).toContain("if v_global_count <> 1 or v_tenant_count <> 1");
    expect(sql).toContain("model_provider_accounting_unavailable");
  });

  it("serializes global and tenant admission before measuring breakers", () => {
    const globalLock = sql.indexOf("model_provider_spend:global");
    const tenantLock = sql.indexOf("model_provider_spend:tenant:");
    const spendRead = sql.indexOf("into v_global_committed");
    expect(globalLock).toBeGreaterThan(0);
    expect(tenantLock).toBeGreaterThan(globalLock);
    expect(spendRead).toBeGreaterThan(tenantLock);
    expect(sql).toContain("model_provider_global_spend_breaker_open");
    expect(sql).toContain("model_provider_tenant_spend_breaker_open");
  });

  it("pins a price snapshot and refunds every unused reservation", () => {
    expect(sql).toContain("price_version");
    expect(sql).toContain("unit_microusd");
    expect(sql).toContain("-v_reservation.reserved_microusd");
    expect(sql).toContain("'refundedMicrousd', v_reservation.reserved_microusd - v_actual_cost");
    expect(sql).toContain("model_provider_spend_ledger_immutable");
    expect(sql).toContain("where admitted_at >= v_global.period_start");
  });

  it("uses tenant-head round robin rather than a global FIFO dominated by one tenant", () => {
    expect(sql).toContain("distinct on (r.tenant_id)");
    expect(sql).toContain("t.last_admitted_at nulls first");
    expect(sql).toContain("v_tenant_running >= v_tenant.concurrency_limit");
    expect(sql).toContain("v_global_running >= v_global.concurrency_limit");
    expect(sql).toContain("A queued replay must re-enter admission");
    expect(sql).toContain("set state = 'rejected'");
  });

  it("keeps tables private and RPCs service-role only", () => {
    expect(sql).toMatch(/revoke all on public\.model_provider_prices[\s\S]*from public, anon, authenticated/i);
    expect(sql).toMatch(/grant execute on function public\.reserve_model_provider_spend_v1[\s\S]*to service_role/i);
    expect(sql).not.toMatch(/grant execute on function public\.reserve_model_provider_spend_v1[\s\S]*to (anon|authenticated)/i);
  });
});

describe("model-provider spend reconciliation migration contract", () => {
  const sql = readFileSync(resolve(import.meta.dirname,
    "../../supabase/migrations/20260920131100_model_provider_spend_reconciliation.sql"), "utf8");

  it("keeps an indeterminate dispatch charged until explicit reconciliation", () => {
    expect(sql).toContain("model_provider_spend_reconciliations");
    expect(sql).toContain("expires_at = null, reconciliation_pending = true");
    expect(sql).toContain("state = 'reserved' and expires_at is null and reconciliation_pending");
    expect(sql).toContain("'pending_reconciliation'");
    expect(sql).toContain("model_provider_reconciliation_required");
    expect(sql).not.toContain("PROVIDER_CALL_FAILED', 0");
  });

  it("makes reconciliation atomic and idempotent", () => {
    expect(sql).toContain("if v_reconciliation.status = 'resolved'");
    expect(sql).toContain("'status', 'duplicate'");
    expect(sql).toContain("perform set_config('app.model_provider_reconciliation'");
    expect(sql).toContain("set status = 'resolved'");
    expect(sql).toContain("-v_reservation.reserved_microusd");
  });

  it("keeps both reconciliation RPCs service-role only", () => {
    expect(sql).toMatch(/revoke all on function public\.mark_model_provider_spend_indeterminate_v1[\s\S]*from public, anon, authenticated/i);
    expect(sql).toMatch(/grant execute on function public\.reconcile_model_provider_spend_v1[\s\S]*to service_role/i);
    expect(sql).not.toMatch(/grant execute on function public\.reconcile_model_provider_spend_v1[\s\S]*to (anon|authenticated)/i);
  });
});

describe("model-provider queued-expiry recovery migration contract", () => {
  const read = (path: string) => readFileSync(resolve(import.meta.dirname, "../../supabase", path), "utf8");
  const recovery = read("migrations/20261002110000_model_provider_queue_expiry_recovery.sql");
  const control = read("migrations/20260920131000_model_provider_spend_control.sql");
  const reconciliation = read("migrations/20260920131100_model_provider_spend_reconciliation.sql");
  const pgtap = read("tests/model_provider_spend_recovery.sql");
  // The lifecycle_v2 branches, verbatim. lifecycle_v3 must carry every one of them.
  const v2Branches = [
    "(state in ('queued', 'rejected') and admitted_at is null and expires_at is null",
    "(state not in ('queued', 'rejected') and admitted_at is not null and",
    "((expires_at is not null and not reconciliation_pending) or",
    "(state = 'reserved' and expires_at is null and reconciliation_pending)))",
  ];

  it("keeps every lifecycle_v2 branch and adds only a never-admitted queue expiry", () => {
    for (const branch of v2Branches) {
      expect(reconciliation).toContain(branch);
      expect(recovery).toContain(branch);
    }
    expect(recovery).toContain("(state = 'expired' and reason_code is not distinct from 'QUEUE_EXPIRED'");
    expect(recovery).toContain("and admitted_at is null and expires_at is null and not reconciliation_pending) or");
    expect(recovery.match(/state = 'expired'/g)).toHaveLength(1);
  });

  it("replaces the constraint additively and can be rerun", () => {
    const dropV3 = recovery.indexOf("drop constraint if exists model_provider_spend_reservation_lifecycle_v3");
    const addV3 = recovery.indexOf("add constraint model_provider_spend_reservation_lifecycle_v3 check (");
    const dropV2 = recovery.indexOf("drop constraint if exists model_provider_spend_reservation_lifecycle_v2");
    expect(dropV3).toBeGreaterThan(0);
    expect(addV3).toBeGreaterThan(dropV3);
    expect(dropV2).toBeGreaterThan(addV3);
    expect(recovery).not.toMatch(/create (or replace )?function|insert into|model_provider_spend_ledger/i);
  });

  it("needs no change to either historical migration", () => {
    // The sweep already expires stale queued rows without a ledger entry; only the constraint
    // rejected the resulting row, so recovery lives entirely in the new migration.
    expect(control).toContain("set state = 'expired', reason_code = 'QUEUE_EXPIRED', settled_at = v_now");
    expect(control).toContain("where state = 'queued' and requested_at <= v_now - interval '15 minutes';");
    const sweep = control.indexOf("reason_code = 'QUEUE_EXPIRED'");
    expect(control.slice(sweep, control.indexOf("select * into v_existing"))).not.toContain("model_provider_spend_ledger");
    expect(reconciliation).toContain("add constraint model_provider_spend_reservation_lifecycle_v2 check (");
    expect(reconciliation).not.toContain("QUEUE_EXPIRED");
    for (const historical of [control, reconciliation]) expect(historical).not.toContain("lifecycle_v3");
  });

  it("proves recovery against the real RPCs in a rollback-only pgTAP run", () => {
    expect(pgtap).toMatch(/^begin;\r?$/m);
    expect(pgtap.trimEnd().endsWith("rollback;")).toBe(true);
    expect(pgtap).not.toMatch(/^\s*commit\s*;/im);
    expect(pgtap).toContain("public.reserve_model_provider_spend_v1(");
    expect(pgtap).toContain("public.settle_model_provider_spend_v1(");
    expect(pgtap).toContain("interval '16 minutes'");
  });
});

describe("model-provider dispatch-start mark migration contract (K20)", () => {
  const read = (path: string) => readFileSync(resolve(import.meta.dirname, "../../supabase", path), "utf8");
  const mark = read("migrations/20261002120000_model_provider_dispatch_start_mark.sql")
    .replace(/\r\n/g, "\n");
  const pgtap = read("tests/model_provider_dispatch_start_mark.sql");

  it("parks a marked expired hold before the refund sweep can select it", () => {
    const park = mark.indexOf("'pending', 'DISPATCH_OUTCOME_UNKNOWN', expires_at");
    const refund = mark.indexOf("set state = 'expired', reason_code = 'RESERVATION_EXPIRED', settled_at = v_now");
    expect(park).toBeGreaterThan(0);
    expect(refund).toBeGreaterThan(park);
    expect(mark).toContain("where state = 'reserved' and expires_at <= v_now and dispatch_started_at is null");
    expect(mark).toContain("if v_reservation.expires_at <= v_now and v_reservation.dispatch_started_at is null then");
    expect(mark).toContain("if p_outcome = 'released' and v_reservation.dispatch_started_at is not null then");
  });

  it("is rerunnable and keeps every RPC service-role only", () => {
    expect(mark).toContain("add column if not exists dispatch_started_at");
    expect(mark).toContain("drop constraint if exists model_provider_spend_dispatch_mark_admitted");
    expect(mark).not.toMatch(/^create function/m);
    for (const fn of ["mark_model_provider_spend_dispatch_started_v1(text, uuid)",
      "reserve_model_provider_spend_v1(text, text, text, text, text, text, bigint, integer)",
      "settle_model_provider_spend_v1(text, uuid, text, bigint, text)"]) {
      expect(mark).toContain(`revoke all on function public.${fn}\n  from public, anon, authenticated;`);
      expect(mark).toContain(`grant execute on function public.${fn}\n  to service_role;`);
    }
  });

  it("proves the crash boundaries against the real RPCs in a rollback-only pgTAP run", () => {
    expect(pgtap).toMatch(/^begin;\r?$/m);
    expect(pgtap.trimEnd().endsWith("rollback;")).toBe(true);
    expect(pgtap).not.toMatch(/^\s*commit\s*;/im);
    const planned = Number(/select plan\((\d+)\);/.exec(pgtap)?.[1]);
    const assertions = pgtap.match(/^select (ok|is|throws_ok|has_column)\(/gm) ?? [];
    expect(assertions.length).toBe(planned);
  });
});
