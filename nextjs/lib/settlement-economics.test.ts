import { describe, expect, it } from "vitest";

import type { ProcessorDelta } from "./paddle-reconciliation";
import type { EvidenceBand } from "./pilot-unit-economics";
import { buildUnitEconomicsInput, type Line, type SettlementEconomicsParams } from "./settlement-economics";

const contract = (v: number, ref: string): EvidenceBand => ({
  low: v, base: v, high: v, state: "contract", source: { kind: "public_contract", ref },
});
const line = (v: number | null, id: string): Line => ({
  contract: contract(1, `contract ${id}`),
  ...(v === null ? {} : { observed: { value: v, ref: `receipt ${id}`, observationId: id, observedAt: "2026-11-30T00:00:00Z" } }),
});
const cleanDelta: ProcessorDelta = {
  window: { ledgerSince: "2026-11-01T00:00:00Z", processorUpdatedAfter: "2026-11-01T00:00:00Z", truncated: false },
  missingInLedger: [], missingAtProcessor: [], creditMismatch: [], reversalMissing: [], reversalUnexpected: [],
};

function params(runpod: number | null = 100): SettlementEconomicsParams {
  return {
    processor: {
      delta: cleanDelta,
      netRevenueUsd: line(1_000, "paddle-net"),
      transactions: line(10, "paddle-tx"),
      paymentFeePercent: contract(0.05, "paddle fee"),
      paymentFeeFixedUsd: contract(0.5, "paddle fee"),
    },
    ledger: {
      settledUnits: [
        { workspaceId: "w1", unitId: "u1", pages: 40, settledAt: "2026-11-05T00:00:00Z" },
        { workspaceId: "w1", unitId: "u2", pages: 10, settledAt: "2026-11-06T00:00:00Z" },
        { workspaceId: "w2", unitId: "u3", pages: 50, settledAt: "2026-11-07T00:00:00Z" },
        { workspaceId: "w3", unitId: "u4", pages: 99, settledAt: "2026-12-07T00:00:00Z" },
      ],
      receipt: { ref: "ledger query", observationId: "ledger-1", observedAt: "2026-11-30T00:00:00Z" },
    },
    providerCosts: {
      supportHours: line(2, "support"),
      supportLoadedHourlyUsd: contract(50, "loaded rate"),
      inferenceGpuUsd: line(runpod, "runpod"),
      storageUsd: line(10, "supabase"),
      networkUsd: line(5, "vercel"),
      failureRetryUsd: line(10, "retry"),
      humanReviewHours: line(2, "review"),
      humanReviewLoadedHourlyUsd: contract(60, "loaded rate"),
    },
    period: { offerId: "test-offer", from: "2026-11-01T00:00:00Z", to: "2026-12-01T00:00:00Z" },
  };
}

describe("buildUnitEconomicsInput", () => {
  it("marks every receipt-backed band observed and counts only in-period active workspaces", () => {
    const r = buildUnitEconomicsInput(params());
    if (r.status !== "built") throw new Error(r.status);
    expect(r.activeWorkspaces).toBe(2);
    expect(r.input.trustedPages.base).toBe(100);
    expect(r.input.costs.inferenceGpuUsd.state).toBe("observed");
    expect(r.economics.status).toBe("ready");
    // only the rate and fee lines, which no receipt can measure, stay contract
    expect(r.contractBands.map((b) => b.path)).toEqual([
      "costs.supportLoadedHourlyUsd", "costs.humanReviewLoadedHourlyUsd", "costs.paymentFeePercent", "costs.paymentFeeFixedUsd",
    ]);
  });

  it("keeps a missing RunPod invoice as a named contract band, never zero, and the result is blocked", () => {
    const r = buildUnitEconomicsInput(params(null));
    if (r.status !== "built") throw new Error(r.status);
    expect(r.input.costs.inferenceGpuUsd).toMatchObject({ state: "contract", base: 1 });
    expect(r.contractBands).toContainEqual({ path: "costs.inferenceGpuUsd", source: "contract runpod" });
    expect(r.economics.status).toBe("blocked");
  });

  it("refuses zero active workspaces instead of dividing by zero", () => {
    const p = params();
    p.ledger.settledUnits = [{ workspaceId: "w9", unitId: "u9", pages: 5, settledAt: "2026-10-31T23:59:59Z" }];
    expect(buildUnitEconomicsInput(p)).toMatchObject({ status: "refused", code: "NO_ACTIVE_WORKSPACES" });
  });

  it("refuses a processor delta that disagrees, was truncated, or does not cover the period", () => {
    const refused = (delta: ProcessorDelta) => {
      const p = params();
      p.processor.delta = delta;
      return buildUnitEconomicsInput(p);
    };
    expect(refused({ ...cleanDelta, missingInLedger: ["txn_1"] })).toMatchObject({ code: "PROCESSOR_DELTA_NOT_CLEAN" });
    expect(refused({ ...cleanDelta, window: { ...cleanDelta.window, truncated: true } })).toMatchObject({ code: "PROCESSOR_DELTA_NOT_CLEAN" });
    expect(refused({ ...cleanDelta, window: { ...cleanDelta.window, ledgerSince: "2026-11-15T00:00:00Z" } })).toMatchObject({ code: "PROCESSOR_DELTA_NOT_CLEAN" });
  });

  it("refuses an inverted period and throws on a non-contract fallback", () => {
    const p = params();
    p.period = { offerId: "x", from: "2026-12-01T00:00:00Z", to: "2026-11-01T00:00:00Z" };
    expect(buildUnitEconomicsInput(p)).toMatchObject({ code: "INVALID_PERIOD" });
    const q = params();
    q.providerCosts.storageUsd = { contract: { ...contract(1, "x"), state: "observed" } };
    expect(() => buildUnitEconomicsInput(q)).toThrow(TypeError);
  });

  it("refuses a delta window that does not parse", () => {
    const q = params();
    q.processor.delta = { ...cleanDelta, window: { ledgerSince: "garbage", processorUpdatedAfter: "garbage", truncated: false } };
    expect(buildUnitEconomicsInput(q)).toMatchObject({ status: "refused", code: "PROCESSOR_DELTA_NOT_CLEAN" });
  });

  it("throws on a settled unit it cannot trust, never drops or double counts it", () => {
    const base = params().ledger.settledUnits;
    const bad = (u: Array<(typeof base)[number]>) => () => {
      const q = params();
      q.ledger.settledUnits = [...base, ...u];
      return buildUnitEconomicsInput(q);
    };
    expect(bad([{ workspaceId: "w3", unitId: "u9", pages: 500, settledAt: "not-a-date" }])).toThrow(TypeError);
    expect(bad([base[0]])).toThrow(TypeError);
    expect(bad([{ workspaceId: "w3", unitId: "u9", pages: -30, settledAt: "2026-11-09T00:00:00Z" }])).toThrow(TypeError);
    expect(bad([{ workspaceId: "w3", unitId: "u9", pages: 1.5, settledAt: "2026-11-09T00:00:00Z" }])).toThrow(TypeError);
  });
});
