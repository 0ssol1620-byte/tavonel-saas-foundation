import { describe, expect, it } from "vitest";
import { aggregateEnterpriseMetrics } from "./enterprise-dashboard";

describe("enterprise operating dashboard", () => {
  it("aggregates exact micro-dollar ledgers without inventing missing volume", () => {
    const result = aggregateEnterpriseMetrics([
      { date: "2026-08-29", activeUsers: 4, documentsProcessed: 10, gpuSeconds: 120, gpuCostMicros: 2_000_000, revenueMicros: 10_000_000, creditsConsumed: 80, jobFailures: 1 },
      { date: "2026-08-30", activeUsers: 7, documentsProcessed: 30, gpuSeconds: 300, gpuCostMicros: 4_000_000, revenueMicros: 20_000_000, creditsConsumed: 180, jobFailures: 2 },
    ]);
    expect(result.activeUsers).toBe(7);
    expect(result.documentsProcessed).toBe(40);
    expect(result.gpuCostUsd).toBe(6);
    expect(result.revenueUsd).toBe(30);
    expect(result.grossMarginUsd).toBe(24);
    expect(result.failureRate).toBe(0.075);
    expect(result.gpuCostPerDocumentUsd).toBe(0.15);
  });

  it("returns zero rates for an empty ledger", () => {
    expect(aggregateEnterpriseMetrics([])).toMatchObject({ documentsProcessed: 0, failureRate: 0, gpuCostPerDocumentUsd: 0 });
  });
});
