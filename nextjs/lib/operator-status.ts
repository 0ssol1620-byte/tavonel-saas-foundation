export const OPERATOR_STATUS_SCHEMA = "tavonel.operator_status.v1" as const;

const ALLOWED_STATES = new Set(["available", "degraded", "stale", "blocked"]);
const ALLOWED_ALERT_SEVERITIES = new Set(["warning", "critical"]);
const ALLOWED_ALERT_REASONS = new Set([
  "history_unavailable",
  "observation_missing",
  "observation_clock_skew",
  "freshness_ttl_exceeded",
  "required_check_failed",
  "required_check_unobserved",
  "synthetic_transaction_refused",
  "window_failure_budget_exceeded",
]);

export type OperatorAuthorization =
  | { ok: true; subject: string }
  | { ok: false; status: 401; code: "OPERATOR_AUTH_REQUIRED" }
  | { ok: false; status: 503; code: "OPERATOR_AUTH_UNAVAILABLE" };

export type OperatorAuthorizer = (request: Request) => OperatorAuthorization | Promise<OperatorAuthorization>;

export type OperationalStatusSource = {
  state: "available" | "degraded" | "stale" | "blocked";
  evaluatedAt: string;
  freshness: { lastRunAt: string | null; ageMs: number | null; ttlMs: number };
  availability: { passing: number; total: number };
  window: {
    passingRuns: number;
    totalRuns: number;
    ratio: number | null;
    successfulRequestLatencyP95Ms: number | null;
    latencySamples: number;
  };
  alerts: Array<{ severity: "warning" | "critical"; reason: string }>;
  modelAttempts?: {
    total: number;
    receiptsRecorded: number;
    receiptWriteFailures: number;
    fullModel: number;
    partialModel: number;
    deterministic: number;
    providerFailures: number;
    invalidModelOutputs: number;
    downstreamFailures: number;
  };
};

export type OperatorStatusV1 = {
  schemaVersion: typeof OPERATOR_STATUS_SCHEMA;
  overallState: OperationalStatusSource["state"];
  evaluatedAt: string;
  evidence: {
    freshness: "fresh" | "stale" | "missing" | "unavailable";
    observedAt: string | null;
    ageMs: number | null;
    ttlMs: number;
  };
  requiredChecks: { passing: number; total: number };
  recentWindow: {
    passingRuns: number;
    totalRuns: number;
    successRatio: number | null;
    successfulRequestLatencyP95Ms: number | null;
    latencySamples: number;
  };
  alerts: Array<{ severity: "warning" | "critical"; reason: string }>;
  modelAttempts: {
    total: number;
    receiptsRecorded: number;
    receiptWriteFailures: number;
    routes: { fullModel: number; partialModel: number; deterministic: number };
    failures: { upstreamUnavailable: number; invalidModelOutput: number; downstreamFailure: number };
  };
};

function finiteNonNegative(value: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function finiteCount(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

/**
 * A strict operator projection. It intentionally enumerates every output field rather than
 * spreading the measurement, so provider configuration, prompts, URLs, routing data, raw error
 * strings, and credentials cannot cross this boundary when a source object grows.
 */
export function buildOperatorStatusV1(source: OperationalStatusSource): OperatorStatusV1 {
  const alerts = source.alerts
    .filter((entry) => ALLOWED_ALERT_SEVERITIES.has(entry.severity) && ALLOWED_ALERT_REASONS.has(entry.reason))
    .map((entry) => ({
      severity: entry.severity as "warning" | "critical",
      reason: entry.reason,
    }));
  const unavailable = alerts.some((entry) => entry.reason === "history_unavailable");
  const missing = source.freshness.lastRunAt === null;
  const stale = source.state === "stale" || alerts.some((entry) => entry.reason === "freshness_ttl_exceeded");
  const overallState = ALLOWED_STATES.has(source.state) ? source.state : "blocked";

  return {
    schemaVersion: OPERATOR_STATUS_SCHEMA,
    overallState,
    evaluatedAt: source.evaluatedAt,
    evidence: {
      freshness: unavailable ? "unavailable" : missing ? "missing" : stale ? "stale" : "fresh",
      observedAt: source.freshness.lastRunAt,
      ageMs: finiteNonNegative(source.freshness.ageMs),
      ttlMs: finiteCount(source.freshness.ttlMs),
    },
    requiredChecks: {
      passing: finiteCount(source.availability.passing),
      total: finiteCount(source.availability.total),
    },
    recentWindow: {
      passingRuns: finiteCount(source.window.passingRuns),
      totalRuns: finiteCount(source.window.totalRuns),
      successRatio: source.window.ratio !== null && Number.isFinite(source.window.ratio)
        && source.window.ratio >= 0 && source.window.ratio <= 1 ? source.window.ratio : null,
      successfulRequestLatencyP95Ms: finiteNonNegative(source.window.successfulRequestLatencyP95Ms),
      latencySamples: finiteCount(source.window.latencySamples),
    },
    alerts,
    modelAttempts: {
      total: finiteCount(source.modelAttempts?.total ?? 0),
      receiptsRecorded: finiteCount(source.modelAttempts?.receiptsRecorded ?? 0),
      receiptWriteFailures: finiteCount(source.modelAttempts?.receiptWriteFailures ?? 0),
      routes: {
        fullModel: finiteCount(source.modelAttempts?.fullModel ?? 0),
        partialModel: finiteCount(source.modelAttempts?.partialModel ?? 0),
        deterministic: finiteCount(source.modelAttempts?.deterministic ?? 0),
      },
      failures: {
        upstreamUnavailable: finiteCount(source.modelAttempts?.providerFailures ?? 0),
        invalidModelOutput: finiteCount(source.modelAttempts?.invalidModelOutputs ?? 0),
        downstreamFailure: finiteCount(source.modelAttempts?.downstreamFailures ?? 0),
      },
    },
  };
}

/** No identity provider is assumed. Until a deployment supplies an operator authorizer, close. */
export const unconfiguredOperatorAuthorizer: OperatorAuthorizer = async () => ({
  ok: false,
  status: 503,
  code: "OPERATOR_AUTH_UNAVAILABLE",
});

export function createOperatorStatusHandler(dependencies: {
  authorize: OperatorAuthorizer;
  readOperationalStatus: () => OperationalStatusSource | Promise<OperationalStatusSource>;
}) {
  return async function GET(request: Request): Promise<Response> {
    const authorization = await dependencies.authorize(request);
    if (!authorization.ok) {
      const headers = new Headers({ "Cache-Control": "no-store", Vary: "Authorization" });
      if (authorization.status === 401) headers.set("WWW-Authenticate", "Bearer");
      return Response.json({ code: authorization.code }, { status: authorization.status, headers });
    }

    try {
      const source = await dependencies.readOperationalStatus();
      return Response.json(buildOperatorStatusV1(source), {
        headers: { "Cache-Control": "no-store", Vary: "Authorization" },
      });
    } catch {
      return Response.json(
        { code: "OPERATOR_STATUS_UNAVAILABLE" },
        { status: 503, headers: { "Cache-Control": "no-store", Vary: "Authorization" } },
      );
    }
  };
}
