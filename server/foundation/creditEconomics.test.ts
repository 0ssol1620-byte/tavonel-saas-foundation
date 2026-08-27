import { describe, expect, it } from "vitest";
import {
  creditGuardrails,
  creditsForObservedGpuSeconds,
  evaluateCreditBudget,
  evaluateGpuReservation,
  marginFloorBreached,
} from "../../shared/creditEconomics";

describe("credit-first GPU guardrails", () => {
  it("calculates observed GPU credit use conservatively", () => {
    expect(creditsForObservedGpuSeconds("rtx4090", 1)).toBe(1);
    expect(creditsForObservedGpuSeconds("rtx4090", 46)).toBe(2);
    expect(creditsForObservedGpuSeconds("a100", 36)).toBe(2);
    expect(creditsForObservedGpuSeconds("h100", 0)).toBe(0);
  });

  it("enforces hard reservation and margin caps before a dispatch", () => {
    expect(evaluateCreditBudget({ requestedCredits: 1, availableCredits: 100, reservedTodayCredits: 0 })).toMatchObject({ allowed: false, code: "INVALID_AMOUNT" });
    expect(evaluateCreditBudget({ requestedCredits: 11, availableCredits: 100, reservedTodayCredits: 0 })).toMatchObject({ allowed: false, code: "JOB_CAP_EXCEEDED" });
    expect(evaluateCreditBudget({ requestedCredits: 5, availableCredits: 100, reservedTodayCredits: 16 })).toMatchObject({ allowed: false, code: "DAILY_CAP_EXCEEDED" });
    expect(evaluateCreditBudget({ requestedCredits: 5, availableCredits: 4, reservedTodayCredits: 0 })).toMatchObject({ allowed: false, code: "INSUFFICIENT_CREDITS" });
    expect(evaluateCreditBudget({ requestedCredits: 5, availableCredits: 5, reservedTodayCredits: 0 })).toMatchObject({ allowed: true, code: "RESERVE", credits: 5 });
  });

  it("keeps GPU execution denied even for a funded, sanitized request", () => {
    expect(creditGuardrails.liveGpuDispatchEnabled).toBe(false);
    expect(evaluateGpuReservation({ requestedCredits: 2, availableCredits: 2, reservedTodayCredits: 0, sourceHasSanitizationProof: true })).toEqual({ allowed: false, code: "PROCESSING_DISABLED" });
  });

  it("trips the margin circuit breaker for zero revenue or cost above 30 percent", () => {
    expect(marginFloorBreached({ recognizedCreditRevenueUsd: 0, observedAllInCostUsd: 0 })).toBe(true);
    expect(marginFloorBreached({ recognizedCreditRevenueUsd: 1, observedAllInCostUsd: 0.3 })).toBe(false);
    expect(marginFloorBreached({ recognizedCreditRevenueUsd: 1, observedAllInCostUsd: 0.301 })).toBe(true);
  });
});
