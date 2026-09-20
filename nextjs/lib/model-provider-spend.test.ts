import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  markModelProviderSpendIndeterminate, reconcileModelProviderSpend,
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

  it("rejects a mismatched reservation receipt", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: "reserved", reservationId, tenantId: "other-tenant",
    }), { status: 200 })));
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
