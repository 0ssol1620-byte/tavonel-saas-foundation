/*
  B35 — an internal, bounded decision over the synthetic probe history.

  This module does not send an alert and it does not make a public availability promise. It turns
  the measurements the existing probe already stores into an operator-safe state and an alert
  intent. A scheduler or authenticated operator endpoint may consume the result later.

  The contract deliberately keeps three questions separate:

  - freshness: did the measuring system report recently enough to trust the observation?
  - availability: did every required request check actually answer successfully?
  - window quality: how many stored probe runs passed, with an explicit denominator?

  Configuration rows never count as request evidence. `not_probed` never counts as success. Raw
  store/provider errors and environment values are not copied to the result.

  Queue liveness is a fourth, separate question ("is queued work moving?") and is reported beside
  this decision as `jobLiveness`, never folded into its state or alerts.
*/
import type { ModelProviderCircuitSnapshot } from "./model-provider-circuit";
import {
  evaluateOperationalJobLiveness,
  type OperationalJobLiveness,
  type OperationalJobObservation,
  type OperationalJobProcessingGate,
} from "./operational-job-liveness";
import { PROBE_DEPENDENCIES, type ProbeDependency } from "./synthetic-probe";
import type { ProbeHistory } from "./synthetic-probe-store";

export const OPERATIONAL_SLI_SCHEMA = "tavonel.operational_sli.v1" as const;
export const DEFAULT_FRESHNESS_TTL_MS = 10 * 60 * 1_000;
export const DEFAULT_WINDOW_RUNS = 12;
export const MAX_WINDOW_RUNS = 20;
export const MAX_FUTURE_SKEW_MS = 60 * 1_000;

export const DEFAULT_REQUIRED_REQUEST_CHECKS = ["coreV2", "r2", "db"] as const satisfies readonly ProbeDependency[];

export type OperationalState = "available" | "degraded" | "stale" | "blocked";
export type OperationalReason =
  | "history_unavailable"
  | "observation_missing"
  | "observation_clock_skew"
  | "freshness_ttl_exceeded"
  | "required_check_failed"
  | "required_check_unobserved"
  | "synthetic_transaction_refused"
  | "window_failure_budget_exceeded"
  | "model_provider_circuit_open"
  | "model_provider_circuit_state_unavailable"
  | "compile_backlog_age_exceeded"
  | "compile_backlog_unavailable";

/*
  Compile backlog age (GA ops audit gap 4, 2026-11-10): how long the oldest runnable compile job
  has waited since anything last moved it -- `updated_at` of the head of the scheduler's own
  oldest-first queue (compile-job-store readOpenCompileJobs). A queue that is moving keeps this
  near the one-minute cron; a stuck or starved queue grows it without bound.

  Thresholds are a judgement, not a measurement: 15 minutes is the same bar as
  DOCUMENT_NEVER_ARRIVED and the queue-liveness stall, 60 minutes is four of them. An unreadable
  queue is never an empty one: it is its own warning, like an unreadable provider circuit.
*/
export const COMPILE_BACKLOG_WARNING_SECONDS = 15 * 60;
export const COMPILE_BACKLOG_CRITICAL_SECONDS = 60 * 60;

export type CompileBacklogReading = { ok: true; oldestWaitingSince: string | null } | { ok: false };

export type CompileBacklogHealth = {
  status: "ok" | "unavailable";
  /** Null when the queue holds no runnable job, or could not be read. */
  oldestWaitSeconds: number | null;
};

/*
  Paid-provider health, as the durable circuit already records it. An open breaker is a warning,
  never `blocked`: the customer still gets an answer carrying a named `lexical_structure` /
  `rrf_fused_order` degradation, so the request path stays available while the operator view stops
  being silent about why it got cheaper. Only the provider name, phase and correlated-failure
  count cross this boundary -- never an endpoint URL, credential, price or routing feature.
*/
export type ModelProviderHealth = {
  provider: string;
  status: "closed" | "open" | "half_open" | "unavailable";
  correlatedFailures: number;
};

export type ModelProviderCircuitReading = {
  provider: string;
  snapshot: ModelProviderCircuitSnapshot;
};

export type OperationalAlert = {
  severity: "warning" | "critical";
  reason: OperationalReason;
};

export type OperationalSli = {
  schemaVersion: typeof OPERATIONAL_SLI_SCHEMA;
  state: OperationalState;
  evaluatedAt: string;
  freshness: {
    lastRunAt: string | null;
    ageMs: number | null;
    ttlMs: number;
  };
  availability: {
    required: ProbeDependency[];
    passing: number;
    total: number;
    ratio: number | null;
    failed: ProbeDependency[];
    unobserved: ProbeDependency[];
  };
  window: {
    passingRuns: number;
    totalRuns: number;
    ratio: number | null;
    successfulRequestLatencyP95Ms: number | null;
    latencySamples: number;
  };
  modelProviders: ModelProviderHealth[];
  compileBacklog?: CompileBacklogHealth;
  alerts: OperationalAlert[];
};

export type OperationalSliOptions = {
  now?: Date;
  freshnessTtlMs?: number;
  windowRuns?: number;
  requiredRequestChecks?: readonly ProbeDependency[];
  /** A measured run failure ratio above this value produces a degraded state. */
  windowFailureRatio?: number;
  /** Avoid treating one startup sample as a historical trend. */
  minimumWindowSamples?: number;
  /** Already-read circuit state. This module stays pure; the caller performs the provider I/O. */
  modelProviderCircuits?: readonly ModelProviderCircuitReading[];
  /** Already-read oldest runnable compile job. Omitted, the evaluation carries no backlog field. */
  compileBacklog?: CompileBacklogReading;
};

type StoredHistory = { ok: true; history: ProbeHistory } | { ok: false; code: string };

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`value must be an integer from ${minimum} through ${maximum}`);
  }
  return value;
}

function boundedRatio(value: number | undefined, fallback: number) {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError("ratio must be between 0 and 1");
  return value;
}

function uniqueRequired(value: readonly ProbeDependency[] | undefined): ProbeDependency[] {
  const required = [...new Set(value ?? DEFAULT_REQUIRED_REQUEST_CHECKS)];
  if (required.length === 0 || required.some((name) => !PROBE_DEPENDENCIES.includes(name))) {
    throw new RangeError("at least one known probe dependency is required");
  }
  return required;
}

function percentile95(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

function ratio(passing: number, total: number) {
  return total === 0 ? null : passing / total;
}

function alert(severity: OperationalAlert["severity"], reason: OperationalReason): OperationalAlert {
  return { severity, reason };
}

const PROVIDER_NAME = /^[a-z0-9][a-z0-9._-]{1,63}$/;

type ProviderReading = { health: ModelProviderHealth[]; alerts: OperationalAlert[]; compileBacklog?: CompileBacklogHealth };

/** Bounded projection of the already-read backlog head. Unreadable or untrusted is never healthy. */
function withCompileBacklog(providers: ProviderReading, reading: CompileBacklogReading | undefined, nowMs: number): ProviderReading {
  if (!reading) return providers;
  const since = reading.ok && reading.oldestWaitingSince !== null ? Date.parse(reading.oldestWaitingSince) : null;
  if (!reading.ok || (since !== null && !Number.isFinite(since))) {
    return { ...providers, compileBacklog: { status: "unavailable", oldestWaitSeconds: null },
      alerts: [...providers.alerts, alert("warning", "compile_backlog_unavailable")] };
  }
  // A job touched after the slot began has waited no time at all; the slot is the evaluation's now.
  const oldestWaitSeconds = since === null ? null : Math.max(0, Math.floor((nowMs - since) / 1_000));
  const alerts = [...providers.alerts];
  if (oldestWaitSeconds !== null && oldestWaitSeconds > COMPILE_BACKLOG_WARNING_SECONDS) {
    alerts.push(alert(oldestWaitSeconds > COMPILE_BACKLOG_CRITICAL_SECONDS ? "critical" : "warning", "compile_backlog_age_exceeded"));
  }
  return { ...providers, compileBacklog: { status: "ok", oldestWaitSeconds }, alerts };
}

/** Bounded projection of already-read circuit state. An unreadable circuit is never "closed". */
function modelProviderHealth(readings: readonly ModelProviderCircuitReading[] | undefined): ProviderReading {
  const health: ModelProviderHealth[] = [];
  const alerts: OperationalAlert[] = [];
  for (const reading of readings ?? []) {
    if (!PROVIDER_NAME.test(reading.provider)) {
      throw new RangeError("model provider name must be a bounded provider identifier");
    }
    const status = reading.snapshot.ok ? reading.snapshot.state.phase : "unavailable";
    health.push({
      provider: reading.provider,
      status,
      correlatedFailures: reading.snapshot.ok ? reading.snapshot.state.correlatedFailures : 0,
    });
    if (status === "open" || status === "half_open") {
      alerts.push(alert("warning", "model_provider_circuit_open"));
    }
    if (status === "unavailable") {
      alerts.push(alert("warning", "model_provider_circuit_state_unavailable"));
    }
  }
  return { health, alerts };
}

function emptyResult(
  evaluatedAt: string,
  ttlMs: number,
  required: ProbeDependency[],
  reason: "history_unavailable" | "observation_missing",
  providers: ProviderReading,
): OperationalSli {
  return {
    schemaVersion: OPERATIONAL_SLI_SCHEMA,
    state: "blocked",
    evaluatedAt,
    freshness: { lastRunAt: null, ageMs: null, ttlMs },
    availability: { required, passing: 0, total: required.length, ratio: 0, failed: [], unobserved: [...required] },
    window: { passingRuns: 0, totalRuns: 0, ratio: null, successfulRequestLatencyP95Ms: null, latencySamples: 0 },
    modelProviders: providers.health,
    ...(providers.compileBacklog ? { compileBacklog: providers.compileBacklog } : {}),
    alerts: [alert("critical", reason), ...providers.alerts],
  };
}

/**
 * Evaluate already-validated probe history. The output contains only bounded measurements and
 * allowlisted reason codes, so raw provider/store errors cannot cross an operator DTO boundary.
 */
export function evaluateOperationalSli(stored: StoredHistory, options: OperationalSliOptions = {}): OperationalSli {
  const now = options.now ?? new Date();
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new RangeError("now must be a valid date");
  const ttlMs = boundedInteger(options.freshnessTtlMs, DEFAULT_FRESHNESS_TTL_MS, 1_000, 24 * 60 * 60 * 1_000);
  const windowRuns = boundedInteger(options.windowRuns, DEFAULT_WINDOW_RUNS, 1, MAX_WINDOW_RUNS);
  const minimumWindowSamples = boundedInteger(options.minimumWindowSamples, 3, 1, MAX_WINDOW_RUNS);
  const failureRatio = boundedRatio(options.windowFailureRatio, 0.2);
  const required = uniqueRequired(options.requiredRequestChecks);
  const evaluatedAt = now.toISOString();

  // The compile backlog rides with provider health: independent of probe freshness, appended on
  // every branch, able to degrade an available state and never to clear a blocked or stale one.
  const providers = withCompileBacklog(modelProviderHealth(options.modelProviderCircuits), options.compileBacklog, nowMs);

  if (!stored.ok) return emptyResult(evaluatedAt, ttlMs, required, "history_unavailable", providers);
  if (stored.history.runs.length === 0) {
    return emptyResult(evaluatedAt, ttlMs, required, "observation_missing", providers);
  }

  // Storage writes newest first, but sorting here prevents a malformed ordering from selecting an
  // older green run. The slice bounds both CPU work and the denominator exposed to operators.
  const runs = [...stored.history.runs]
    .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt))
    .slice(0, windowRuns);
  const latest = runs[0];
  const lastRunMs = Date.parse(latest.startedAt);
  const ageMs = Math.max(0, nowMs - lastRunMs);
  const future = lastRunMs - nowMs > MAX_FUTURE_SKEW_MS;

  const latestByName = new Map(latest.checks.map((check) => [check.name, check]));
  const failed = required.filter((name) => latestByName.get(name)?.status === "failed");
  const passing = required.filter((name) => {
    const check = latestByName.get(name);
    return check?.kind === "request" && check.status === "ok";
  });
  const unobserved = required.filter((name) => !failed.includes(name) && !passing.includes(name));

  const passingRuns = runs.filter((run) => run.ok).length;
  const windowFailure = runs.length >= minimumWindowSamples && (runs.length - passingRuns) / runs.length > failureRatio;
  const latencySamples = runs.flatMap((run) => run.checks)
    .filter((check) => required.includes(check.name) && check.kind === "request" && check.status === "ok" && check.latencyMs !== null)
    .map((check) => check.latencyMs as number);

  const alerts: OperationalAlert[] = [];
  let state: OperationalState = "available";
  if (future) {
    state = "blocked";
    alerts.push(alert("critical", "observation_clock_skew"));
  } else if (ageMs > ttlMs) {
    state = "stale";
    alerts.push(alert("critical", "freshness_ttl_exceeded"));
  } else if (passing.length === 0) {
    state = "blocked";
    alerts.push(alert("critical", failed.length > 0 ? "required_check_failed" : "required_check_unobserved"));
  } else {
    if (failed.length > 0) alerts.push(alert("warning", "required_check_failed"));
    if (unobserved.length > 0) alerts.push(alert("warning", "required_check_unobserved"));
    if (latest.fixtureE2E.status === "refused") alerts.push(alert("warning", "synthetic_transaction_refused"));
    if (windowFailure) alerts.push(alert("warning", "window_failure_budget_exceeded"));
  }

  // Provider health is independent of probe freshness, so it is appended on every branch. It can
  // only turn an otherwise-available system degraded; it never clears a blocked or stale state.
  alerts.push(...providers.alerts);
  if (state === "available" && alerts.length > 0) state = "degraded";

  return {
    schemaVersion: OPERATIONAL_SLI_SCHEMA,
    state,
    evaluatedAt,
    freshness: { lastRunAt: latest.startedAt, ageMs, ttlMs },
    availability: {
      required,
      passing: passing.length,
      total: required.length,
      ratio: ratio(passing.length, required.length),
      failed,
      unobserved,
    },
    window: {
      passingRuns,
      totalRuns: runs.length,
      ratio: ratio(passingRuns, runs.length),
      successfulRequestLatencyP95Ms: percentile95(latencySamples),
      latencySamples: latencySamples.length,
    },
    modelProviders: providers.health,
    ...(providers.compileBacklog ? { compileBacklog: providers.compileBacklog } : {}),
    alerts,
  };
}

export type OperationalJobLivenessInput = {
  observation: OperationalJobObservation;
  processingGate: OperationalJobProcessingGate;
};

export type OperationalSliWithJobLiveness = OperationalSli & { jobLiveness: OperationalJobLiveness };

/**
 * Dependency health and queue liveness as two answers side by side. Every dependency field, the
 * state and the alerts are exactly evaluateOperationalSli's; `jobLiveness` never feeds them. An
 * unknown or paused queue therefore cannot hide behind a green dependency state, and a healthy
 * queue cannot make a blocked dependency look available.
 */
export function evaluateOperationalSliWithJobLiveness(
  stored: StoredHistory,
  job: OperationalJobLivenessInput,
  options: OperationalSliOptions = {},
): OperationalSliWithJobLiveness {
  return {
    ...evaluateOperationalSli(stored, options),
    jobLiveness: evaluateOperationalJobLiveness(job.observation, job.processingGate),
  };
}
