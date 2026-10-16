// Operational liveness of the foundation_jobs queue. This is intentionally a
// separate signal from dependency health: it answers "is queued work moving?",
// reports only bounded aggregates, and never echoes row values.

export const OPERATIONAL_JOB_LIVENESS_KIND = "operational_job_liveness";
export const OPERATIONAL_JOB_ACTIVE_STATES = ["queued", "leased"] as const;
export const MAX_OBSERVED_ACTIVE_JOBS = 500;
export const MAX_REPORTED_AGE_SECONDS = 7 * 24 * 60 * 60;
// complete_foundation_job_batch (0029_foundation_job_quota_deferral.sql) never
// schedules available_at more than 86,400 s past the database's now().
export const MAX_SCHEDULE_AHEAD_MS = 86_400 * 1000;
// Caller-supplied thresholds are bounded so a huge value cannot stretch a
// window until stuck work reads as healthy.
export const MAX_AGE_THRESHOLD_MS = 24 * 60 * 60_000;
export const MAX_CLOCK_SKEW_TOLERANCE_MS = 5 * 60_000;
const POSTGRES_INTEGER_MAX = 2_147_483_647;

export type OperationalJobLivenessThresholds = {
  overdueAfterMs: number;
  stalledAfterMs: number;
  clockSkewToleranceMs: number;
};

export const DEFAULT_OPERATIONAL_JOB_LIVENESS_THRESHOLDS: OperationalJobLivenessThresholds =
  {
    overdueAfterMs: 5 * 60_000,
    stalledAfterMs: 15 * 60_000,
    clockSkewToleranceMs: 30_000,
  };

// Values are untrusted until evaluated; the store only copies these columns of
// public.foundation_jobs (0024_foundation_jobs.sql).
export type OperationalJobRow = {
  state: unknown;
  available_at: unknown;
  lease_expires_at: unknown;
  updated_at: unknown;
  items_seen: unknown;
  items_done: unknown;
};

export type OperationalJobStoreFailure =
  | "store_not_configured"
  | "store_request_failed"
  | "store_http_error"
  | "store_invalid_response"
  | "store_response_too_large"
  | "store_clock_unavailable";

export type OperationalJobObservation =
  | {
      ok: true;
      observedAt: string;
      rows: readonly OperationalJobRow[];
      truncated: boolean;
    }
  | { ok: false; failure: OperationalJobStoreFailure };

export type OperationalJobProcessingGate = "open" | "closed" | "unknown";

export type OperationalJobLivenessState =
  | "idle"
  | "healthy"
  | "degraded"
  | "paused"
  | "unknown";

export type OperationalJobLivenessReason =
  | "queue_idle"
  | "queue_active"
  | "queued_overdue"
  | "lease_expired"
  | "progress_stalled"
  | "processing_gate_closed"
  | "processing_gate_unknown"
  | "store_unavailable"
  | "observed_time_untrusted"
  | "clock_skew"
  | "row_untrusted"
  | "workload_capped"
  | "thresholds_invalid";

export type OperationalJobLivenessCounts = {
  eligible: number;
  deferred: number;
  overdue: number;
  leased: number;
  expiredLease: number;
  stalled: number;
};

export type OperationalJobLiveness = {
  kind: typeof OPERATIONAL_JOB_LIVENESS_KIND;
  state: OperationalJobLivenessState;
  healthy: boolean;
  reasons: OperationalJobLivenessReason[];
  counts: OperationalJobLivenessCounts | null;
  oldestOverdueSeconds: number | null;
  oldestExpiredLeaseSeconds: number | null;
  oldestStalledSeconds: number | null;
};

type RowVerdict =
  | { bucket: keyof OperationalJobLivenessCounts; ageMs: number }
  | "row_untrusted"
  | "clock_skew";

const TIMESTAMPTZ =
  /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}(?::?\d{2})?)$/i;

// Accepts PostgREST ISO output and Postgres text output ("+00" offsets,
// microseconds). A value without an explicit offset is not timestamptz and is
// rejected rather than guessed; so are 'infinity' and anything unparsable.
export function parseTimestamptz(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = TIMESTAMPTZ.exec(value.trim());
  if (!match) return null;
  const [, date, time, fraction, zone] = match;
  const millis = fraction ? fraction.slice(1, 4).padEnd(3, "0") : "000";
  const offset =
    zone.toUpperCase() === "Z"
      ? "Z"
      : `${zone.slice(0, 3)}:${zone.length === 3 ? "00" : zone.slice(-2)}`;
  const parsed = Date.parse(`${date}T${time}.${millis}${offset}`);
  return Number.isFinite(parsed) ? parsed : null;
}

export function evaluateOperationalJobLiveness(
  observation: OperationalJobObservation,
  processingGate: OperationalJobProcessingGate,
  thresholds: OperationalJobLivenessThresholds = DEFAULT_OPERATIONAL_JOB_LIVENESS_THRESHOLDS,
): OperationalJobLiveness {
  if (processingGate !== "open" && processingGate !== "closed") {
    return unknownResult("processing_gate_unknown");
  }
  const observed = observeQueue(observation, thresholds);
  if (processingGate === "open") return observed;
  // A closed gate is an intentional pause: keep the observed counts visible,
  // but never claim the queue is healthy while nothing is allowed to run.
  return {
    ...observed,
    state: "paused",
    healthy: false,
    reasons: ["processing_gate_closed", ...observed.reasons],
  };
}

function observeQueue(
  observation: OperationalJobObservation,
  thresholds: OperationalJobLivenessThresholds,
): OperationalJobLiveness {
  if (!thresholdsValid(thresholds)) return unknownResult("thresholds_invalid");
  if (!observation || observation.ok !== true) {
    return unknownResult("store_unavailable");
  }
  const now = parseTimestamptz(observation.observedAt);
  if (now === null) return unknownResult("observed_time_untrusted");
  const rows = observation.rows;
  if (!Array.isArray(rows)) return unknownResult("row_untrusted");
  if (observation.truncated !== false || rows.length > MAX_OBSERVED_ACTIVE_JOBS) {
    return unknownResult("workload_capped");
  }

  const counts: OperationalJobLivenessCounts = {
    eligible: 0,
    deferred: 0,
    overdue: 0,
    leased: 0,
    expiredLease: 0,
    stalled: 0,
  };
  const oldestMs = { overdue: 0, expiredLease: 0, stalled: 0 };
  for (const row of rows) {
    const verdict = classifyRow(row, now, thresholds);
    if (typeof verdict === "string") return unknownResult(verdict);
    counts[verdict.bucket] += 1;
    if (
      verdict.bucket === "overdue" ||
      verdict.bucket === "expiredLease" ||
      verdict.bucket === "stalled"
    ) {
      oldestMs[verdict.bucket] = Math.max(oldestMs[verdict.bucket], verdict.ageMs);
    }
  }

  const reasons: OperationalJobLivenessReason[] = [];
  if (counts.overdue > 0) reasons.push("queued_overdue");
  if (counts.expiredLease > 0) reasons.push("lease_expired");
  if (counts.stalled > 0) reasons.push("progress_stalled");
  const ages = {
    oldestOverdueSeconds: counts.overdue > 0 ? toBoundedSeconds(oldestMs.overdue) : null,
    oldestExpiredLeaseSeconds:
      counts.expiredLease > 0 ? toBoundedSeconds(oldestMs.expiredLease) : null,
    oldestStalledSeconds: counts.stalled > 0 ? toBoundedSeconds(oldestMs.stalled) : null,
  };
  if (reasons.length > 0) {
    return {
      kind: OPERATIONAL_JOB_LIVENESS_KIND,
      state: "degraded",
      healthy: false,
      reasons,
      counts,
      ...ages,
    };
  }
  const idle = rows.length === 0;
  return {
    kind: OPERATIONAL_JOB_LIVENESS_KIND,
    state: idle ? "idle" : "healthy",
    healthy: true,
    reasons: [idle ? "queue_idle" : "queue_active"],
    counts,
    ...ages,
  };
}

function classifyRow(
  row: unknown,
  now: number,
  thresholds: OperationalJobLivenessThresholds,
): RowVerdict {
  if (typeof row !== "object" || row === null) return "row_untrusted";
  const job = row as OperationalJobRow;
  // updated_at and available_at are NOT NULL timestamptz columns.
  const updatedAt = parseTimestamptz(job.updated_at);
  const availableAt = parseTimestamptz(job.available_at);
  if (
    updatedAt === null ||
    availableAt === null ||
    !progressCountsValid(job.items_seen, job.items_done)
  ) {
    return "row_untrusted";
  }
  // A durable write from the future means one of the clocks is wrong; any age
  // computed against it would be fiction.
  if (updatedAt - now > thresholds.clockSkewToleranceMs) return "clock_skew";

  if (job.state === "queued") {
    // foundation_jobs_lease_state: only a leased job may hold a lease.
    if (job.lease_expires_at !== null) return "row_untrusted";
    const dueForMs = now - availableAt;
    if (dueForMs < 0) {
      // Beyond the durable schedule bound this is not deferred work: either
      // a clock is wrong or the row was not written by the queue functions.
      return -dueForMs > MAX_SCHEDULE_AHEAD_MS + thresholds.clockSkewToleranceMs
        ? "clock_skew"
        : { bucket: "deferred", ageMs: 0 };
    }
    return dueForMs >= thresholds.overdueAfterMs
      ? { bucket: "overdue", ageMs: dueForMs }
      : { bucket: "eligible", ageMs: dueForMs };
  }

  if (job.state === "leased") {
    // The schema permits a leased row without a lease, but such a row can never
    // expire or be reaped, so no honest age exists for it.
    const leaseExpiresAt = parseTimestamptz(job.lease_expires_at);
    if (leaseExpiresAt === null) return "row_untrusted";
    const expiredForMs = now - leaseExpiresAt;
    if (expiredForMs > thresholds.clockSkewToleranceMs) {
      return { bucket: "expiredLease", ageMs: expiredForMs };
    }
    // items_seen/items_done are validated but never treated as progress on
    // their own; only a durable updated_at write counts as recent progress.
    const quietForMs = now - updatedAt;
    return quietForMs >= thresholds.stalledAfterMs
      ? { bucket: "stalled", ageMs: quietForMs }
      : { bucket: "leased", ageMs: Math.max(0, quietForMs) };
  }

  return "row_untrusted";
}

// Both counters are NOT NULL integer columns constrained by
// foundation_jobs_progress (items_done <= items_seen).
function progressCountsValid(itemsSeen: unknown, itemsDone: unknown): boolean {
  return isCount(itemsSeen) && isCount(itemsDone) && itemsDone <= itemsSeen;
}

function isCount(value: unknown): value is number {
  return isBoundedInteger(value, POSTGRES_INTEGER_MAX);
}

function thresholdsValid(thresholds: OperationalJobLivenessThresholds): boolean {
  return (
    isBoundedInteger(thresholds?.overdueAfterMs, MAX_AGE_THRESHOLD_MS) &&
    isBoundedInteger(thresholds?.stalledAfterMs, MAX_AGE_THRESHOLD_MS) &&
    isBoundedInteger(thresholds?.clockSkewToleranceMs, MAX_CLOCK_SKEW_TOLERANCE_MS)
  );
}

function isBoundedInteger(value: unknown, max: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= max;
}

function toBoundedSeconds(ms: number): number {
  return Math.min(MAX_REPORTED_AGE_SECONDS, Math.max(0, Math.floor(ms / 1000)));
}

function unknownResult(reason: OperationalJobLivenessReason): OperationalJobLiveness {
  return {
    kind: OPERATIONAL_JOB_LIVENESS_KIND,
    state: "unknown",
    healthy: false,
    reasons: [reason],
    counts: null,
    oldestOverdueSeconds: null,
    oldestExpiredLeaseSeconds: null,
    oldestStalledSeconds: null,
  };
}
