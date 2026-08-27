import {
  creditGuardrails,
  creditsForObservedGpuSeconds,
  evaluateCreditBudget,
  marginFloorBreached,
  type GpuClass,
} from "../../shared/creditEconomics";

export type ServerGpuPolicy = {
  liveGpuDispatchEnabled: boolean;
  maximumExecutionSeconds: number;
  maximumJobTtlSeconds: number;
};

export const defaultServerGpuPolicy: ServerGpuPolicy = {
  liveGpuDispatchEnabled: creditGuardrails.liveGpuDispatchEnabled,
  maximumExecutionSeconds: creditGuardrails.maximumExecutionSeconds,
  maximumJobTtlSeconds: creditGuardrails.maximumJobTtlSeconds,
};

export type GpuDispatchRequest = {
  workspaceId: string;
  idempotencyKey: string;
  sourceHasSanitizationProof: boolean;
  requestedCredits: number;
  availableCredits: number;
  reservedTodayCredits: number;
  recognizedCreditRevenueUsd: number;
  observedAllInCostUsd: number;
  gpuClass: GpuClass;
  executionTimeoutSeconds: number;
  ttlSeconds: number;
  existingReservation?: { idempotencyKey: string; reservationId: string } | null;
};

export type GpuDispatchDecision =
  | { admitted: false; code: "PROCESSING_DISABLED" | "SANITIZED_PROOF_REQUIRED" | "MARGIN_FLOOR_PAUSED" | "INVALID_TIMEOUT" | "INVALID_TTL" | "INVALID_AMOUNT" | "JOB_CAP_EXCEEDED" | "DAILY_CAP_EXCEEDED" | "INSUFFICIENT_CREDITS" }
  | { admitted: false; code: "IDEMPOTENT_REPLAY"; reservationId: string }
  | { admitted: true; code: "RESERVE"; reservation: { workspaceId: string; idempotencyKey: string; credits: number; gpuClass: GpuClass; executionTimeoutSeconds: number; ttlSeconds: number } };

export function decideGpuDispatch(
  request: GpuDispatchRequest,
  policy: ServerGpuPolicy = defaultServerGpuPolicy,
): GpuDispatchDecision {
  if (request.existingReservation?.idempotencyKey === request.idempotencyKey) {
    return { admitted: false, code: "IDEMPOTENT_REPLAY", reservationId: request.existingReservation.reservationId };
  }
  if (!policy.liveGpuDispatchEnabled) return { admitted: false, code: "PROCESSING_DISABLED" };
  if (!request.sourceHasSanitizationProof) return { admitted: false, code: "SANITIZED_PROOF_REQUIRED" };
  if (marginFloorBreached({ recognizedCreditRevenueUsd: request.recognizedCreditRevenueUsd, observedAllInCostUsd: request.observedAllInCostUsd })) {
    return { admitted: false, code: "MARGIN_FLOOR_PAUSED" };
  }
  if (!Number.isSafeInteger(request.executionTimeoutSeconds) || request.executionTimeoutSeconds < 5 || request.executionTimeoutSeconds > policy.maximumExecutionSeconds) {
    return { admitted: false, code: "INVALID_TIMEOUT" };
  }
  if (!Number.isSafeInteger(request.ttlSeconds) || request.ttlSeconds < request.executionTimeoutSeconds || request.ttlSeconds > policy.maximumJobTtlSeconds) {
    return { admitted: false, code: "INVALID_TTL" };
  }
  const budget = evaluateCreditBudget(request);
  if (!budget.allowed) return { admitted: false, code: budget.code };
  return {
    admitted: true,
    code: "RESERVE",
    reservation: {
      workspaceId: request.workspaceId,
      idempotencyKey: request.idempotencyKey,
      credits: budget.credits,
      gpuClass: request.gpuClass,
      executionTimeoutSeconds: request.executionTimeoutSeconds,
      ttlSeconds: request.ttlSeconds,
    },
  };
}

export function settleGpuReservation({
  reservedCredits,
  gpuClass,
  observedGpuSeconds,
  workerCompleted,
}: {
  reservedCredits: number;
  gpuClass: GpuClass;
  observedGpuSeconds: number;
  workerCompleted: boolean;
}) {
  if (!workerCompleted || !Number.isFinite(observedGpuSeconds) || observedGpuSeconds < 0) {
    return { state: "operator_review" as const, settledCredits: 0, releasedCredits: 0 };
  }
  const meteredCredits = creditsForObservedGpuSeconds(gpuClass, observedGpuSeconds);
  if (meteredCredits > reservedCredits) {
    return { state: "operator_review" as const, settledCredits: reservedCredits, releasedCredits: 0 };
  }
  return {
    state: "settled" as const,
    settledCredits: meteredCredits,
    releasedCredits: reservedCredits - meteredCredits,
  };
}
