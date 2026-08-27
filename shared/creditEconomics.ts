export const creditCatalog = {
  observer_access: { kind: "subscription", monthlyUsd: 29, includedGpuCredits: 0 },
  studio_access: { kind: "subscription", monthlyUsd: 99, includedGpuCredits: 0 },
  credit_starter: { kind: "prepaid", priceUsd: 12, credits: 100, paddlePriceId: null },
  credit_builder: { kind: "prepaid", priceUsd: 30, credits: 300, paddlePriceId: null },
  credit_scale: { kind: "prepaid", priceUsd: 75, credits: 800, paddlePriceId: null },
} as const;

export type GpuClass = "rtx4090" | "a100" | "h100";

export const gpuCreditPolicy: Record<
  GpuClass,
  { secondsPerCredit: number; providerUsdPerSecond: number }
> = {
  rtx4090: { secondsPerCredit: 45, providerUsdPerSecond: 0.00031 },
  a100: { secondsPerCredit: 18, providerUsdPerSecond: 0.00076 },
  h100: { secondsPerCredit: 12, providerUsdPerSecond: 0.00116 },
};

export const creditGuardrails = {
  minimumJobReservationCredits: 2,
  defaultPerJobCreditCap: 10,
  defaultPerTenantDailyCreditCap: 20,
  maximumExecutionSeconds: 90,
  maximumJobTtlSeconds: 300,
  dispatchMarginFloorCostRatio: 0.3,
  liveGpuDispatchEnabled: false,
} as const;

export type CreditReservationInput = {
  requestedCredits: number;
  availableCredits: number;
  reservedTodayCredits: number;
  perJobCap?: number;
  perTenantDailyCap?: number;
  sourceHasSanitizationProof: boolean;
};

export type CreditReservationDecision =
  | { allowed: false; code: "PROCESSING_DISABLED" | "SANITIZED_PROOF_REQUIRED" | "INVALID_AMOUNT" | "JOB_CAP_EXCEEDED" | "DAILY_CAP_EXCEEDED" | "INSUFFICIENT_CREDITS" }
  | { allowed: true; code: "RESERVE"; credits: number };

export function creditsForObservedGpuSeconds(gpuClass: GpuClass, observedSeconds: number) {
  if (!Number.isFinite(observedSeconds) || observedSeconds <= 0) return 0;
  return Math.ceil(observedSeconds / gpuCreditPolicy[gpuClass].secondsPerCredit);
}

export function evaluateCreditBudget(input: Omit<CreditReservationInput, "sourceHasSanitizationProof">): CreditReservationDecision {
  const requested = input.requestedCredits;
  const jobCap = input.perJobCap ?? creditGuardrails.defaultPerJobCreditCap;
  const dailyCap = input.perTenantDailyCap ?? creditGuardrails.defaultPerTenantDailyCreditCap;
  if (!Number.isSafeInteger(requested) || requested < creditGuardrails.minimumJobReservationCredits) {
    return { allowed: false, code: "INVALID_AMOUNT" };
  }
  if (requested > jobCap) return { allowed: false, code: "JOB_CAP_EXCEEDED" };
  if (input.reservedTodayCredits + requested > dailyCap) return { allowed: false, code: "DAILY_CAP_EXCEEDED" };
  if (requested > input.availableCredits) return { allowed: false, code: "INSUFFICIENT_CREDITS" };
  return { allowed: true, code: "RESERVE", credits: requested };
}

export function evaluateGpuReservation(input: CreditReservationInput): CreditReservationDecision {
  if (!creditGuardrails.liveGpuDispatchEnabled) return { allowed: false, code: "PROCESSING_DISABLED" };
  if (!input.sourceHasSanitizationProof) return { allowed: false, code: "SANITIZED_PROOF_REQUIRED" };
  return evaluateCreditBudget(input);
}

export function marginFloorBreached({
  recognizedCreditRevenueUsd,
  observedAllInCostUsd,
}: {
  recognizedCreditRevenueUsd: number;
  observedAllInCostUsd: number;
}) {
  if (recognizedCreditRevenueUsd <= 0 || observedAllInCostUsd < 0) return true;
  return observedAllInCostUsd / recognizedCreditRevenueUsd > creditGuardrails.dispatchMarginFloorCostRatio;
}
