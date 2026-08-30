export type EnterpriseDailyMetric = {
  date: string;
  activeUsers: number;
  documentsProcessed: number;
  gpuSeconds: number;
  gpuCostMicros: number;
  revenueMicros: number;
  creditsConsumed: number;
  jobFailures: number;
};

export function aggregateEnterpriseMetrics(metrics: readonly EnterpriseDailyMetric[]) {
  const totals = metrics.reduce((sum, row) => ({
    activeUsers: Math.max(sum.activeUsers, row.activeUsers),
    documentsProcessed: sum.documentsProcessed + row.documentsProcessed,
    gpuSeconds: sum.gpuSeconds + row.gpuSeconds,
    gpuCostMicros: sum.gpuCostMicros + row.gpuCostMicros,
    revenueMicros: sum.revenueMicros + row.revenueMicros,
    creditsConsumed: sum.creditsConsumed + row.creditsConsumed,
    jobFailures: sum.jobFailures + row.jobFailures,
  }), { activeUsers: 0, documentsProcessed: 0, gpuSeconds: 0, gpuCostMicros: 0, revenueMicros: 0, creditsConsumed: 0, jobFailures: 0 });
  return {
    ...totals,
    gpuCostUsd: totals.gpuCostMicros / 1_000_000,
    revenueUsd: totals.revenueMicros / 1_000_000,
    grossMarginUsd: (totals.revenueMicros - totals.gpuCostMicros) / 1_000_000,
    failureRate: totals.documentsProcessed > 0 ? totals.jobFailures / totals.documentsProcessed : 0,
    gpuCostPerDocumentUsd: totals.documentsProcessed > 0 ? totals.gpuCostMicros / 1_000_000 / totals.documentsProcessed : 0,
  };
}
