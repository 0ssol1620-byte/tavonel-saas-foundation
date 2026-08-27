import { describe, expect, it } from "vitest";
import { decideGpuDispatch, defaultServerGpuPolicy, settleGpuReservation } from "./gpuDispatchService";

const healthyRequest = {
  workspaceId: "workspace-a",
  idempotencyKey: "idem-a",
  sourceHasSanitizationProof: true,
  requestedCredits: 5,
  availableCredits: 10,
  reservedTodayCredits: 0,
  recognizedCreditRevenueUsd: 10,
  observedAllInCostUsd: 1,
  gpuClass: "rtx4090" as const,
  executionTimeoutSeconds: 90,
  ttlSeconds: 300,
};
const syntheticEnabledPolicy = { ...defaultServerGpuPolicy, liveGpuDispatchEnabled: true };

describe("GPU dispatch admission service", () => {
  it("is globally fail-closed under the deployed server policy", () => {
    expect(decideGpuDispatch(healthyRequest)).toEqual({ admitted: false, code: "PROCESSING_DISABLED" });
  });

  it("pauses a dispatch before reservation if the margin floor is breached", () => {
    expect(decideGpuDispatch({ ...healthyRequest, observedAllInCostUsd: 3.01 }, syntheticEnabledPolicy)).toEqual({ admitted: false, code: "MARGIN_FLOOR_PAUSED" });
  });

  it("creates a bounded reservation, deduplicates retries, and settles unused credits", () => {
    expect(decideGpuDispatch(healthyRequest, syntheticEnabledPolicy)).toMatchObject({ admitted: true, code: "RESERVE", reservation: { credits: 5, executionTimeoutSeconds: 90, ttlSeconds: 300 } });
    expect(decideGpuDispatch({ ...healthyRequest, existingReservation: { idempotencyKey: "idem-a", reservationId: "reservation-a" } }, syntheticEnabledPolicy)).toEqual({ admitted: false, code: "IDEMPOTENT_REPLAY", reservationId: "reservation-a" });
    expect(settleGpuReservation({ reservedCredits: 5, gpuClass: "rtx4090", observedGpuSeconds: 46, workerCompleted: true })).toEqual({ state: "settled", settledCredits: 2, releasedCredits: 3 });
  });

  it("leaves ambiguous or over-reserved worker outcomes for operator review", () => {
    expect(settleGpuReservation({ reservedCredits: 2, gpuClass: "a100", observedGpuSeconds: 60, workerCompleted: true }).state).toBe("operator_review");
    expect(settleGpuReservation({ reservedCredits: 2, gpuClass: "a100", observedGpuSeconds: 10, workerCompleted: false }).state).toBe("operator_review");
  });
});
