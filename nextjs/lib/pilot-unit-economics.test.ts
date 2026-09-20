import { describe, expect, it } from "vitest";

import { calculatePilotUnitEconomics, type EvidenceBand, type PilotUnitEconomicsInput } from "./pilot-unit-economics";

const observed = (low: number, base: number, high: number, id: string): EvidenceBand => ({
  low,
  base,
  high,
  state: "observed",
  source: {
    kind: "config_observation",
    ref: `test receipt ${id}`,
    observationId: id,
    observedAt: "2026-09-20T00:00:00Z",
  },
});

const contract = (low: number, base: number, high: number, ref: string): EvidenceBand => ({
  low,
  base,
  high,
  state: "contract",
  source: { kind: "public_contract", ref },
});

function completeInput(): PilotUnitEconomicsInput {
  return {
    schemaVersion: "tavonel.pilot_unit_economics.v1",
    offerId: "test-pilot",
    currency: "USD",
    taxTreatment: "excluded",
    planningRevenueUsd: contract(900, 1_000, 1_100, "approved test-only planning input"),
    trustedPages: observed(900, 1_000, 1_100, "pages-1"),
    paymentTransactions: observed(1, 1, 1, "payments-1"),
    costs: {
      supportHours: observed(1, 2, 3, "support-1"),
      supportLoadedHourlyUsd: contract(40, 50, 60, "approved test-only loaded rate"),
      inferenceGpuUsd: observed(80, 100, 130, "gpu-1"),
      storageUsd: observed(8, 10, 14, "storage-1"),
      networkUsd: observed(4, 5, 8, "network-1"),
      failureRetryUsd: observed(5, 10, 20, "retry-1"),
      humanReviewHours: observed(1, 2, 4, "review-1"),
      humanReviewLoadedHourlyUsd: contract(50, 60, 75, "approved test-only loaded rate"),
      paymentFeePercent: contract(0.05, 0.05, 0.05, "public payment fee"),
      paymentFeeFixedUsd: contract(0.5, 0.5, 0.5, "public payment fee"),
    },
  };
}

describe("pilot unit economics", () => {
  it("calculates downside, base and upside from explicit uncertainty bands", () => {
    const result = calculatePilotUnitEconomics(completeInput());
    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("expected ready result");
    expect(result.taxTreatment).toBe("excluded");
    expect(result.decisionUse).toBe("planning_only");
    expect(result.scenarios.map((entry) => entry.scenario)).toEqual(["downside", "base", "upside"]);
    expect(result.scenarios[1]).toMatchObject({
      planningRevenueUsd: 1_000,
      paymentFeesUsd: 50.5,
      supportUsd: 100,
      humanReviewUsd: 120,
      directCostUsd: 395.5,
      grossProfitUsd: 604.5,
      grossMarginPercent: 60.45,
      directCostPerTrustedPageUsd: 0.3955,
    });
    expect(result.scenarios[0].grossMarginPercent).toBeLessThan(result.scenarios[1].grossMarginPercent);
    expect(result.scenarios[2].grossMarginPercent).toBeGreaterThan(result.scenarios[1].grossMarginPercent);
  });

  it("fails closed when an operational observation is missing", () => {
    const input = completeInput() as unknown as Record<string, unknown>;
    delete (input.costs as Record<string, unknown>).networkUsd;
    const result = calculatePilotUnitEconomics(input);
    expect(result).toMatchObject({ status: "blocked", decisionUse: "not_decision_ready" });
    if (result.status !== "blocked") throw new Error("expected blocked result");
    expect(result.blockers).toContain("costs.networkUsd: missing evidence band");
  });

  it("refuses synthetic, estimated, or untraceable values", () => {
    const input = completeInput() as unknown as Record<string, unknown>;
    (input.costs as Record<string, Record<string, unknown>>).failureRetryUsd = {
      low: 0,
      base: 0,
      high: 0,
      state: "synthetic",
      source: { kind: "config_observation", ref: "guess" },
    };
    const result = calculatePilotUnitEconomics(input);
    expect(result.status).toBe("blocked");
    if (result.status !== "blocked") throw new Error("expected blocked result");
    expect(result.blockers).toContain(
      "costs.failureRetryUsd.state: must be observed or contract; estimates and synthetic values are refused",
    );
  });

  it("requires taxes to be explicitly excluded and fee percent to be a decimal", () => {
    const input = completeInput() as unknown as Record<string, unknown>;
    input.taxTreatment = "included";
    ((input.costs as Record<string, unknown>).paymentFeePercent as Record<string, unknown>).high = 5;
    const result = calculatePilotUnitEconomics(input);
    expect(result.status).toBe("blocked");
    if (result.status !== "blocked") throw new Error("expected blocked result");
    expect(result.blockers).toContain("taxTreatment: must explicitly be excluded");
    expect(result.blockers).toContain("costs.paymentFeePercent: use a decimal fraction between 0 and 1");
  });

  it("refuses inverted uncertainty bands and zero trusted-page denominators", () => {
    const input = completeInput();
    input.trustedPages = observed(0, 1_000, 900, "pages-bad");
    const result = calculatePilotUnitEconomics(input);
    expect(result.status).toBe("blocked");
    if (result.status !== "blocked") throw new Error("expected blocked result");
    expect(result.blockers).toContain("trustedPages: uncertainty band must satisfy low <= base <= high");
    expect(result.blockers).toContain("trustedPages: must remain greater than zero");
  });
});
