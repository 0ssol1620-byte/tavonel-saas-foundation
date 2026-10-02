import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClosedModelProviderCircuit } from "./model-provider-circuit";
import { runGovernedModelProviderCall } from "./model-provider-dispatch";
import {
  markModelProviderSpendDispatchStarted, markModelProviderSpendIndeterminate,
  reserveModelProviderSpend, settleModelProviderSpend,
} from "./model-provider-spend";

/*
  K20: hard process death around a paid provider call, with a FAKE provider only.

  The real spend client runs against an in-memory stand-in for the four ledger RPCs, reached
  through the real `fetch` boundary, so every receipt still passes the client's own validation.
  The stand-in mirrors the SQL rules of 20261002120000_model_provider_dispatch_start_mark.sql;
  supabase/tests/model_provider_dispatch_start_mark.sql proves those rules on Postgres itself.

  A crash is modelled as the worker making no durable write after the crash point: from then on
  every ledger request of the dead process fails before it reaches the store. The restarted
  worker replays the same request key, exactly as an at-least-once redelivery would.
*/

type Row = {
  reservationId: string; tenantId: string; requestKey: string; requestDigest: string;
  provider: string; model: string; meter: string; reservedUnits: number;
  state: "reserved" | "settled" | "released" | "expired";
  expiresAt: number | null; dispatchStartedAt: number | null; pending: boolean;
  actualUnits: number | null;
};
type Boundary = "before-reserve" | "before-mark" | "before-provider" | "after-accept"
  | "after-settle" | null;

const UNIT = 100;
let rows: Row[] = [];
let ledger: { reservationId: string; kind: string; reserved: number; spent: number }[] = [];
let reconciliations = new Map<string, { status: "pending" | "resolved"; reason: string }>();
let alive = true;
let crashAt: Boundary = null;
let accepted = 0;
let sequence = 0;

function crash(): never {
  alive = false;
  throw new Error("worker process killed");
}

function fail(message: string) {
  return new Response(JSON.stringify({ message }), { status: 400 });
}
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

function sweep(now: number) {
  for (const row of rows) {
    if (row.state !== "reserved" || row.expiresAt === null || row.expiresAt > now) continue;
    if (row.dispatchStartedAt !== null) {
      reconciliations.set(row.reservationId, { status: "pending", reason: "DISPATCH_OUTCOME_UNKNOWN" });
      row.expiresAt = null;
      row.pending = true;
    } else {
      row.state = "expired";
      ledger.push({ reservationId: row.reservationId, kind: "expire",
        reserved: -row.reservedUnits * UNIT, spent: 0 });
    }
  }
}

function reservationReceipt(row: Row, replay: boolean) {
  return {
    status: row.state, reservationId: row.reservationId, tenantId: row.tenantId,
    requestKey: row.requestKey, requestDigest: row.requestDigest, provider: row.provider,
    model: row.model, meter: row.meter, priceVersion: "synthetic-k20", unitMicrousd: UNIT,
    reservedUnits: row.reservedUnits, reservedMicrousd: row.reservedUnits * UNIT,
    expiresAt: row.expiresAt === null ? null : new Date(row.expiresAt).toISOString(),
    idempotentReplay: replay,
  };
}

type Body = {
  p_tenant_id: string; p_request_key: string; p_request_digest: string; p_provider: string;
  p_model: string; p_meter: string; p_reserved_units: number; p_reservation_seconds: number;
  p_reservation_id: string; p_outcome: "settled" | "released"; p_actual_units: number;
  p_reason_code: string;
};

const rpc: Record<string, (body: Body, now: number) => Response> = {
  reserve_model_provider_spend_v1(body, now) {
    sweep(now);
    const existing = rows.find((row) => row.tenantId === body.p_tenant_id
      && row.requestKey === body.p_request_key);
    if (existing) return ok(reservationReceipt(existing, true));
    const row: Row = {
      reservationId: `bbbbbbbb-bbbb-4bbb-8bbb-${String(++sequence).padStart(12, "0")}`,
      tenantId: body.p_tenant_id, requestKey: body.p_request_key,
      requestDigest: body.p_request_digest, provider: body.p_provider, model: body.p_model,
      meter: body.p_meter, reservedUnits: body.p_reserved_units, state: "reserved",
      expiresAt: now + body.p_reservation_seconds * 1000, dispatchStartedAt: null,
      pending: false, actualUnits: null,
    };
    rows.push(row);
    ledger.push({ reservationId: row.reservationId, kind: "reserve",
      reserved: row.reservedUnits * UNIT, spent: 0 });
    return ok(reservationReceipt(row, false));
  },
  mark_model_provider_spend_dispatch_started_v1(body, now) {
    const row = rows.find((r) => r.reservationId === body.p_reservation_id
      && r.tenantId === body.p_tenant_id);
    if (!row) return fail("model_provider_reservation_not_found");
    if (row.dispatchStartedAt !== null) return fail("model_provider_dispatch_already_started");
    if (row.state !== "reserved" || row.pending || row.expiresAt === null || row.expiresAt <= now) {
      return fail("model_provider_reservation_not_active");
    }
    row.dispatchStartedAt = now;
    return ok({ status: "dispatch_started", reservationId: row.reservationId,
      tenantId: row.tenantId, dispatchStartedAt: new Date(now).toISOString(),
      expiresAt: new Date(row.expiresAt).toISOString() });
  },
  settle_model_provider_spend_v1(body, now) {
    const row = rows.find((r) => r.reservationId === body.p_reservation_id
      && r.tenantId === body.p_tenant_id);
    if (!row) return fail("model_provider_reservation_not_found");
    if (row.state === "settled" || row.state === "released") {
      if (row.state === body.p_outcome && row.actualUnits === body.p_actual_units) {
        return ok({ status: "duplicate", reservationId: row.reservationId, state: row.state,
          actualUnits: row.actualUnits, actualMicrousd: row.actualUnits * UNIT });
      }
      return fail("model_provider_settlement_conflict");
    }
    if (row.state !== "reserved") return fail("model_provider_reservation_not_active");
    if (body.p_outcome === "released" && row.dispatchStartedAt !== null) {
      return fail("model_provider_dispatch_already_started");
    }
    if (row.expiresAt !== null && row.expiresAt <= now && row.dispatchStartedAt === null) {
      row.state = "expired";
      ledger.push({ reservationId: row.reservationId, kind: "expire",
        reserved: -row.reservedUnits * UNIT, spent: 0 });
      return ok({ status: "expired", reservationId: row.reservationId, state: "expired",
        actualUnits: 0, actualMicrousd: 0 });
    }
    if (row.pending) return fail("model_provider_reconciliation_required");
    row.state = body.p_outcome;
    row.actualUnits = body.p_actual_units;
    ledger.push({ reservationId: row.reservationId,
      kind: body.p_outcome === "settled" ? "settle" : "release",
      reserved: -row.reservedUnits * UNIT, spent: body.p_actual_units * UNIT });
    return ok({ status: "processed", reservationId: row.reservationId, state: row.state,
      actualUnits: row.actualUnits, actualMicrousd: row.actualUnits * UNIT });
  },
  mark_model_provider_spend_indeterminate_v1(body) {
    const row = rows.find((r) => r.reservationId === body.p_reservation_id
      && r.tenantId === body.p_tenant_id);
    if (!row) return fail("model_provider_reservation_not_found");
    const existing = reconciliations.get(row.reservationId);
    const receipt = { reservationId: row.reservationId, state: "reserved",
      reconciliationStatus: "pending" };
    if (existing?.status === "pending") return ok({ status: "duplicate", ...receipt });
    if (existing) return fail("model_provider_reconciliation_conflict");
    if (row.state === "expired") {
      ledger.push({ reservationId: row.reservationId, kind: "reserve",
        reserved: row.reservedUnits * UNIT, spent: 0 });
    } else if (row.state !== "reserved") {
      return fail("model_provider_reservation_not_active");
    }
    reconciliations.set(row.reservationId, { status: "pending", reason: body.p_reason_code });
    Object.assign(row, { state: "reserved", expiresAt: null, pending: true });
    return ok({ status: "pending_reconciliation", ...receipt });
  },
};

async function fakeLedgerFetch(resource: string | URL | Request, init?: RequestInit) {
  if (!alive) throw new Error("dead process: no durable write");
  const name = String(resource).split("/rest/v1/rpc/")[1] ?? "";
  const handler = rpc[name];
  if (!handler) throw new Error(`unexpected request ${String(resource)}`);
  const body = JSON.parse(String(init?.body ?? "{}")) as Body;
  if ((crashAt === "before-reserve" && name === "reserve_model_provider_spend_v1")
    || (crashAt === "before-mark" && name === "mark_model_provider_spend_dispatch_started_v1")) {
    crash();
  }
  const response = handler(body, Date.now());
  // The settlement commits, then the process dies before it can use the response.
  if (crashAt === "after-settle" && name === "settle_model_provider_spend_v1") crash();
  return response;
}

function deps() {
  const initial = createClosedModelProviderCircuit("synthetic-provider", new Date());
  return {
    readCircuit: vi.fn().mockResolvedValue({ ok: true, state: initial }),
    commitAdmission: vi.fn().mockImplementation(async (proposal) => ({ ok: true,
      committedRevision: proposal.nextState.revision, eventId: proposal.event.eventId })),
    commitOutcome: vi.fn().mockResolvedValue({ ok: true }),
    reserve: reserveModelProviderSpend,
    settle: settleModelProviderSpend,
    markIndeterminate: markModelProviderSpendIndeterminate,
    markDispatchStarted: markModelProviderSpendDispatchStarted,
  };
}

const input = {
  tenantId: "synthetic-k20-a",
  requestKey: "synthetic-k20-request-0001",
  requestDigest: `sha256:${"a".repeat(64)}`,
  provider: "synthetic-provider",
  model: "synthetic/model-k20",
  meter: "gpu_second",
  reservedUnits: 10,
  reservationSeconds: 60,
  admissionId: "synthetic-k20-admission-0001",
};

// The fake provider. `accepted` counts requests the provider accepted, i.e. would bill.
async function fakeProvider() {
  if (crashAt === "before-provider") crash();
  accepted += 1;
  if (crashAt === "after-accept") crash();
  return { value: "provider-output", actualUnits: 4, reasonCode: "PROVIDER_RESULT_ACCEPTED",
    circuitOutcome: { kind: "success" as const } };
}

async function runWorker(boundary: Boundary) {
  alive = true;
  crashAt = boundary;
  return runGovernedModelProviderCall(input, fakeProvider, deps() as never)
    .catch((error: unknown) => ({ ok: false as const, code: String(error), providerDispatched: true }));
}

// Another tenant's ordinary reserve drives the same global sweep the database runs.
async function sweepViaAnotherTenant(label: string) {
  alive = true;
  crashAt = null;
  return reserveModelProviderSpend({ ...input, tenantId: "synthetic-k20-b",
    requestKey: `synthetic-k20-sweep-${label}`, reservationSeconds: 60 });
}

const target = () => rows.find((row) => row.tenantId === input.tenantId);
const targetLedger = () => ledger.filter((entry) => entry.reservationId === target()?.reservationId)
  .map((entry) => entry.kind);
const snapshot = () => JSON.stringify({ row: target(), ledger: targetLedger(),
  reconciliation: reconciliations.get(target()?.reservationId ?? "") });

beforeEach(() => {
  rows = []; ledger = []; reconciliations = new Map();
  alive = true; crashAt = null; accepted = 0; sequence = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-02T00:00:00Z"));
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", `sb_secret_${"s".repeat(31)}`);
  vi.stubGlobal("fetch", vi.fn(fakeLedgerFetch));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("K20 hard process death around a paid provider call (fake provider)", () => {
  it("crash before reserve: nothing durable exists, and the restart dispatches exactly once", async () => {
    expect(await runWorker("before-reserve")).toMatchObject({ ok: false });
    expect(rows).toHaveLength(0);
    expect(await runWorker(null)).toMatchObject({ ok: true, actualUnits: 4 });
    expect(accepted).toBe(1);
    expect(targetLedger()).toEqual(["reserve", "settle"]);
  });

  it("crash after reserve, before the mark: a timely restart dispatches the same reservation once", async () => {
    await runWorker("before-mark");
    expect(accepted).toBe(0);
    expect(target()).toMatchObject({ state: "reserved", dispatchStartedAt: null });
    const restarted = await runWorker(null);
    expect(restarted).toMatchObject({ ok: true, reservationId: target()?.reservationId });
    expect(accepted).toBe(1);
    expect(rows).toHaveLength(1);
    expect(targetLedger()).toEqual(["reserve", "settle"]);
  });

  it("crash after reserve, before the mark: after expiry the unused hold is refunded and never dispatched", async () => {
    await runWorker("before-mark");
    vi.setSystemTime(Date.now() + 61_000);
    expect(await runWorker(null)).toMatchObject({ ok: false,
      code: "MODEL_PROVIDER_RESERVATION_RECEIPT_INVALID", providerDispatched: false });
    expect(accepted).toBe(0);
    // Refunding is correct here: no mark was ever committed, so no provider call was possible.
    expect(target()).toMatchObject({ state: "expired", dispatchStartedAt: null });
    expect(targetLedger()).toEqual(["reserve", "expire"]);
  });

  for (const boundary of ["before-provider", "after-accept"] as const) {
    it(`crash ${boundary === "before-provider" ? "after the mark, before the provider"
      : "after the provider accepted, before markIndeterminate"}: no second dispatch, no refund, parked once`, async () => {
      await runWorker(boundary);
      const providerCalls = boundary === "after-accept" ? 1 : 0;
      expect(accepted).toBe(providerCalls);
      expect(target()).toMatchObject({ state: "reserved", pending: false });
      expect(target()?.dispatchStartedAt).not.toBeNull();

      // (a) The restarted worker replays the same request and is refused before the provider.
      const restarted = await runWorker(null);
      expect(restarted).toMatchObject({ ok: false, code: "MODEL_PROVIDER_DISPATCH_ALREADY_STARTED",
        providerDispatched: false, reservationId: target()?.reservationId });
      expect(accepted).toBe(providerCalls);
      expect(targetLedger()).toEqual(["reserve"]);

      // (b) Past expiry, the sweep parks the hold as pending reconciliation: still charged, never
      // refunded, and no longer occupying a running slot.
      vi.setSystemTime(Date.now() + 61_000);
      expect(await sweepViaAnotherTenant("1")).toMatchObject({ ok: true, dispatchAllowed: true });
      expect(target()).toMatchObject({ state: "reserved", expiresAt: null, pending: true });
      expect(reconciliations.get(target()!.reservationId))
        .toEqual({ status: "pending", reason: "DISPATCH_OUTCOME_UNKNOWN" });
      expect(targetLedger()).toEqual(["reserve"]);

      // (c) Replaying the sweep, the restart and the late indeterminate mark changes nothing.
      const parked = snapshot();
      await sweepViaAnotherTenant("2");
      expect(await runWorker(null)).toMatchObject({ ok: false,
        code: "MODEL_PROVIDER_RESERVATION_RECEIPT_INVALID", providerDispatched: false });
      alive = true;
      expect(await markModelProviderSpendIndeterminate({ tenantId: input.tenantId,
        reservationId: target()!.reservationId, reasonCode: "PROVIDER_CALL_FAILED" }))
        .toMatchObject({ ok: true, receipt: { status: "duplicate" } });
      expect(await settleModelProviderSpend({ tenantId: input.tenantId,
        reservationId: target()!.reservationId, outcome: "released", actualUnits: 0,
        reasonCode: "PROVIDER_NOT_CALLED" }))
        .toEqual({ ok: false, code: "MODEL_PROVIDER_DISPATCH_ALREADY_STARTED" });
      expect(snapshot()).toBe(parked);
      expect(accepted).toBe(providerCalls);
    });
  }

  it("crash after settle: the restart sees a terminal receipt and never dispatches again", async () => {
    await runWorker("after-settle");
    expect(accepted).toBe(1);
    expect(target()).toMatchObject({ state: "settled", actualUnits: 4 });
    const settled = snapshot();
    expect(await runWorker(null)).toMatchObject({ ok: false,
      code: "MODEL_PROVIDER_RESERVATION_RECEIPT_INVALID", providerDispatched: false });
    vi.setSystemTime(Date.now() + 61_000);
    await sweepViaAnotherTenant("1");
    await sweepViaAnotherTenant("2");
    expect(accepted).toBe(1);
    expect(snapshot()).toBe(settled);
    expect(targetLedger()).toEqual(["reserve", "settle"]);
  });

  it("a live worker that outlives its hold is settled as measured, not refunded", async () => {
    alive = true;
    const result = await runGovernedModelProviderCall(input, async () => {
      accepted += 1;
      vi.setSystemTime(Date.now() + 61_000);
      return { value: "late", actualUnits: 7, reasonCode: "PROVIDER_RESULT_ACCEPTED",
        circuitOutcome: { kind: "success" as const } };
    }, deps() as never);
    expect(result).toMatchObject({ ok: true, actualUnits: 7 });
    expect(target()).toMatchObject({ state: "settled", actualUnits: 7 });
    expect(targetLedger()).toEqual(["reserve", "settle"]);
  });
});
