import type { ProcessorDelta } from "./paddle-reconciliation";
import {
  calculatePilotUnitEconomics,
  PILOT_UNIT_ECONOMICS_SCHEMA,
  type EvidenceBand,
  type PilotUnitEconomicsInput,
  type PilotUnitEconomicsResult,
} from "./pilot-unit-economics";

/** One figure read from a receipt (invoice, Paddle report, ledger query). `ref` names the receipt. */
export type Measured = { value: number; ref: string; observationId: string; observedAt: string };
/** A measured value when a receipt is supplied; otherwise the named contract band, never zero. */
export type Line = { observed?: Measured; contract: EvidenceBand };

export type SettledUnit = { workspaceId: string; unitId: string; pages: number; settledAt: string };

export type SettlementEconomicsParams = {
  processor: {
    delta: ProcessorDelta;
    netRevenueUsd: Line;
    transactions: Line;
    paymentFeePercent: EvidenceBand;
    paymentFeeFixedUsd: EvidenceBand;
  };
  ledger: { settledUnits: readonly SettledUnit[]; receipt: Omit<Measured, "value"> };
  providerCosts: {
    supportHours: Line;
    supportLoadedHourlyUsd: EvidenceBand;
    inferenceGpuUsd: Line;
    storageUsd: Line;
    networkUsd: Line;
    failureRetryUsd: Line;
    humanReviewHours: Line;
    humanReviewLoadedHourlyUsd: EvidenceBand;
  };
  period: { offerId: string; from: string; to: string };
};

export type SettlementEconomicsResult =
  | { status: "refused"; code: "INVALID_PERIOD" | "PROCESSOR_DELTA_NOT_CLEAN" | "NO_ACTIVE_WORKSPACES"; detail: string }
  | {
      status: "built";
      activeWorkspaces: number;
      input: PilotUnitEconomicsInput;
      /** Band paths still in the contract state, with the contract source each one names. */
      contractBands: Array<{ path: string; source: string }>;
      economics: PilotUnitEconomicsResult;
    };

const refuse = (code: Extract<SettlementEconomicsResult, { status: "refused" }>["code"], detail: string) =>
  ({ status: "refused", code, detail }) as const;

function measured(path: string, m: Measured): EvidenceBand {
  if (!Number.isFinite(m.value) || m.value < 0) throw new TypeError(`${path}: measured value must be finite and non-negative`);
  return {
    low: m.value, base: m.value, high: m.value, state: "observed",
    source: { kind: "config_observation", ref: m.ref, observationId: m.observationId, observedAt: m.observedAt },
  };
}

function band(path: string, line: Line): EvidenceBand {
  if (line.contract.state !== "contract") throw new TypeError(`${path}: the fallback must be a contract band`);
  return line.observed ? measured(path, line.observed) : line.contract;
}

export function buildUnitEconomicsInput(p: SettlementEconomicsParams): SettlementEconomicsResult {
  const from = Date.parse(p.period.from);
  const to = Date.parse(p.period.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) return refuse("INVALID_PERIOD", "period.from must precede period.to");

  const { delta } = p.processor;
  const dirty = (["missingInLedger", "missingAtProcessor", "creditMismatch", "reversalMissing", "reversalUnexpected"] as const)
    .filter((k) => delta[k].length > 0);
  if (!delta.window || delta.window.truncated || dirty.length > 0) {
    return refuse("PROCESSOR_DELTA_NOT_CLEAN", delta.window?.truncated ? "processor/ledger read was truncated" : `processor and ledger disagree: ${dirty.join(", ") || "no window"}`);
  }
  if (Date.parse(delta.window.ledgerSince) > from || Date.parse(delta.window.processorUpdatedAfter) > from) {
    return refuse("PROCESSOR_DELTA_NOT_CLEAN", "the delta window does not cover the period");
  }

  const units = p.ledger.settledUnits.filter((u) => Date.parse(u.settledAt) >= from && Date.parse(u.settledAt) < to);
  const activeWorkspaces = new Set(units.map((u) => u.workspaceId)).size;
  if (activeWorkspaces === 0) return refuse("NO_ACTIVE_WORKSPACES", "no workspace has a settled accepted unit in the period");

  const pages = units.reduce((n, u) => n + u.pages, 0);
  const c = p.providerCosts;
  const input: PilotUnitEconomicsInput = {
    schemaVersion: PILOT_UNIT_ECONOMICS_SCHEMA,
    offerId: p.period.offerId,
    currency: "USD",
    taxTreatment: "excluded",
    planningRevenueUsd: band("planningRevenueUsd", p.processor.netRevenueUsd),
    trustedPages: measured("trustedPages", { ...p.ledger.receipt, value: pages }),
    paymentTransactions: band("paymentTransactions", p.processor.transactions),
    costs: {
      supportHours: band("costs.supportHours", c.supportHours),
      supportLoadedHourlyUsd: c.supportLoadedHourlyUsd,
      inferenceGpuUsd: band("costs.inferenceGpuUsd", c.inferenceGpuUsd),
      storageUsd: band("costs.storageUsd", c.storageUsd),
      networkUsd: band("costs.networkUsd", c.networkUsd),
      failureRetryUsd: band("costs.failureRetryUsd", c.failureRetryUsd),
      humanReviewHours: band("costs.humanReviewHours", c.humanReviewHours),
      humanReviewLoadedHourlyUsd: c.humanReviewLoadedHourlyUsd,
      paymentFeePercent: p.processor.paymentFeePercent,
      paymentFeeFixedUsd: p.processor.paymentFeeFixedUsd,
    },
  };

  const contractBands = ([
    ["planningRevenueUsd", input.planningRevenueUsd],
    ["trustedPages", input.trustedPages],
    ["paymentTransactions", input.paymentTransactions],
    ...Object.entries(input.costs).map(([k, b]) => [`costs.${k}`, b]),
  ] as Array<[string, EvidenceBand]>).flatMap(([path, b]) => (b.state === "contract" ? [{ path, source: b.source.ref }] : []));

  return { status: "built", activeWorkspaces, input, contractBands, economics: calculatePilotUnitEconomics(input) };
}
