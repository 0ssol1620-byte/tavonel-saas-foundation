export const PILOT_UNIT_ECONOMICS_SCHEMA = "tavonel.pilot_unit_economics.v1" as const;

type Band = { low: number; base: number; high: number };

export type EvidenceSource = {
  kind: "public_contract" | "config_observation";
  ref: string;
  observedAt?: string;
  observationId?: string;
};

export type EvidenceBand = Band & {
  state: "contract" | "observed";
  source: EvidenceSource;
};

export type PilotUnitEconomicsInput = {
  schemaVersion: typeof PILOT_UNIT_ECONOMICS_SCHEMA;
  offerId: string;
  currency: "USD";
  taxTreatment: "excluded";
  planningRevenueUsd: EvidenceBand;
  trustedPages: EvidenceBand;
  paymentTransactions: EvidenceBand;
  costs: {
    supportHours: EvidenceBand;
    supportLoadedHourlyUsd: EvidenceBand;
    inferenceGpuUsd: EvidenceBand;
    storageUsd: EvidenceBand;
    networkUsd: EvidenceBand;
    failureRetryUsd: EvidenceBand;
    humanReviewHours: EvidenceBand;
    humanReviewLoadedHourlyUsd: EvidenceBand;
    paymentFeePercent: EvidenceBand;
    paymentFeeFixedUsd: EvidenceBand;
  };
};

export type UnitEconomicsScenario = {
  scenario: "downside" | "base" | "upside";
  planningRevenueUsd: number;
  paymentFeesUsd: number;
  supportUsd: number;
  inferenceGpuUsd: number;
  storageUsd: number;
  networkUsd: number;
  failureRetryUsd: number;
  humanReviewUsd: number;
  directCostUsd: number;
  grossProfitUsd: number;
  grossMarginPercent: number;
  trustedPages: number;
  directCostPerTrustedPageUsd: number;
};

export type PilotUnitEconomicsResult =
  | {
      status: "ready";
      schemaVersion: typeof PILOT_UNIT_ECONOMICS_SCHEMA;
      offerId: string;
      currency: "USD";
      taxTreatment: "excluded";
      decisionUse: "planning_only";
      scenarios: UnitEconomicsScenario[];
    }
  | {
      status: "blocked";
      schemaVersion: typeof PILOT_UNIT_ECONOMICS_SCHEMA;
      decisionUse: "not_decision_ready";
      blockers: string[];
    };

const OBSERVATION_PATHS = new Set([
  "trustedPages",
  "paymentTransactions",
  "costs.supportHours",
  "costs.inferenceGpuUsd",
  "costs.storageUsd",
  "costs.networkUsd",
  "costs.failureRetryUsd",
  "costs.humanReviewHours",
]);

const BAND_PATHS = [
  "planningRevenueUsd",
  "trustedPages",
  "paymentTransactions",
  "costs.supportHours",
  "costs.supportLoadedHourlyUsd",
  "costs.inferenceGpuUsd",
  "costs.storageUsd",
  "costs.networkUsd",
  "costs.failureRetryUsd",
  "costs.humanReviewHours",
  "costs.humanReviewLoadedHourlyUsd",
  "costs.paymentFeePercent",
  "costs.paymentFeeFixedUsd",
] as const;

function valueAt(root: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => {
    if (!value || typeof value !== "object") return undefined;
    return (value as Record<string, unknown>)[key];
  }, root);
}

function validateBand(path: string, value: unknown): string[] {
  if (!value || typeof value !== "object") return [`${path}: missing evidence band`];
  const band = value as Partial<EvidenceBand>;
  const errors: string[] = [];
  for (const key of ["low", "base", "high"] as const) {
    if (typeof band[key] !== "number" || !Number.isFinite(band[key]) || band[key]! < 0) {
      errors.push(`${path}.${key}: must be a finite non-negative number`);
    }
  }
  if (errors.length === 0 && !(band.low! <= band.base! && band.base! <= band.high!)) {
    errors.push(`${path}: uncertainty band must satisfy low <= base <= high`);
  }

  const requiredState = OBSERVATION_PATHS.has(path) ? "observed" : null;
  if (band.state !== "observed" && band.state !== "contract") {
    errors.push(`${path}.state: must be observed or contract; estimates and synthetic values are refused`);
  } else if (requiredState && band.state !== requiredState) {
    errors.push(`${path}.state: operational quantity requires an observed value`);
  }

  const source = band.source;
  if (!source || typeof source !== "object" || typeof source.ref !== "string" || source.ref.trim().length === 0) {
    errors.push(`${path}.source: a non-empty evidence reference is required`);
  } else if (band.state === "observed") {
    if (source.kind !== "config_observation") errors.push(`${path}.source.kind: observed values require config_observation`);
    if (!source.observationId?.trim()) errors.push(`${path}.source.observationId: required for observed values`);
    if (!source.observedAt || !Number.isFinite(Date.parse(source.observedAt))) {
      errors.push(`${path}.source.observedAt: required ISO timestamp for observed values`);
    }
  } else if (band.state === "contract" && source.kind !== "public_contract") {
    errors.push(`${path}.source.kind: contract values require public_contract`);
  }
  return errors;
}

export function validatePilotUnitEconomicsInput(input: unknown): string[] {
  if (!input || typeof input !== "object") return ["input: expected an object"];
  const value = input as Partial<PilotUnitEconomicsInput>;
  const errors: string[] = [];
  if (value.schemaVersion !== PILOT_UNIT_ECONOMICS_SCHEMA) errors.push("schemaVersion: unsupported or missing");
  if (typeof value.offerId !== "string" || !/^[a-z0-9][a-z0-9_-]{2,63}$/.test(value.offerId)) {
    errors.push("offerId: must be a stable lowercase identifier");
  }
  if (value.currency !== "USD") errors.push("currency: only USD is supported by the current contracts");
  if (value.taxTreatment !== "excluded") errors.push("taxTreatment: must explicitly be excluded");
  for (const path of BAND_PATHS) errors.push(...validateBand(path, valueAt(input, path)));

  const fee = valueAt(input, "costs.paymentFeePercent") as EvidenceBand | undefined;
  if (fee && typeof fee.high === "number" && fee.high > 1) {
    errors.push("costs.paymentFeePercent: use a decimal fraction between 0 and 1");
  }
  for (const path of ["planningRevenueUsd", "trustedPages", "paymentTransactions"] as const) {
    const band = valueAt(input, path) as EvidenceBand | undefined;
    if (band && typeof band.low === "number" && band.low <= 0) errors.push(`${path}: must remain greater than zero`);
  }
  return [...new Set(errors)].sort();
}

type ScenarioKey = "low" | "base" | "high";

function scenario(
  input: PilotUnitEconomicsInput,
  name: UnitEconomicsScenario["scenario"],
  revenueKey: ScenarioKey,
  costKey: ScenarioKey,
): UnitEconomicsScenario {
  const revenue = input.planningRevenueUsd[revenueKey];
  const trustedPages = input.trustedPages[revenueKey];
  const transactions = input.paymentTransactions[costKey];
  const paymentFees = revenue * input.costs.paymentFeePercent[costKey]
    + transactions * input.costs.paymentFeeFixedUsd[costKey];
  const support = input.costs.supportHours[costKey] * input.costs.supportLoadedHourlyUsd[costKey];
  const humanReview = input.costs.humanReviewHours[costKey] * input.costs.humanReviewLoadedHourlyUsd[costKey];
  const directCost = paymentFees
    + support
    + input.costs.inferenceGpuUsd[costKey]
    + input.costs.storageUsd[costKey]
    + input.costs.networkUsd[costKey]
    + input.costs.failureRetryUsd[costKey]
    + humanReview;
  const grossProfit = revenue - directCost;
  return {
    scenario: name,
    planningRevenueUsd: revenue,
    paymentFeesUsd: paymentFees,
    supportUsd: support,
    inferenceGpuUsd: input.costs.inferenceGpuUsd[costKey],
    storageUsd: input.costs.storageUsd[costKey],
    networkUsd: input.costs.networkUsd[costKey],
    failureRetryUsd: input.costs.failureRetryUsd[costKey],
    humanReviewUsd: humanReview,
    directCostUsd: directCost,
    grossProfitUsd: grossProfit,
    grossMarginPercent: (grossProfit / revenue) * 100,
    trustedPages,
    directCostPerTrustedPageUsd: directCost / trustedPages,
  };
}

export function calculatePilotUnitEconomics(input: unknown): PilotUnitEconomicsResult {
  const blockers = validatePilotUnitEconomicsInput(input);
  if (blockers.length > 0) {
    return {
      status: "blocked",
      schemaVersion: PILOT_UNIT_ECONOMICS_SCHEMA,
      decisionUse: "not_decision_ready",
      blockers,
    };
  }
  const value = input as PilotUnitEconomicsInput;
  return {
    status: "ready",
    schemaVersion: PILOT_UNIT_ECONOMICS_SCHEMA,
    offerId: value.offerId,
    currency: value.currency,
    taxTreatment: value.taxTreatment,
    decisionUse: "planning_only",
    scenarios: [
      scenario(value, "downside", "low", "high"),
      scenario(value, "base", "base", "base"),
      scenario(value, "upside", "high", "low"),
    ],
  };
}
