import { describe, expect, it } from "vitest";
import { PROBE_RUN_SCHEMA, type ProbeCheck, type ProbeRun } from "./synthetic-probe";
import type { ProbeHistory } from "./synthetic-probe-store";
import {
  DEFAULT_FRESHNESS_TTL_MS,
  MAX_WINDOW_RUNS,
  OPERATIONAL_SLI_SCHEMA,
  evaluateOperationalSli,
} from "./operational-sli";

const NOW = new Date("2026-09-20T12:00:00.000Z");

function checks(overrides: Partial<Record<ProbeCheck["name"], Partial<ProbeCheck>>> = {}): ProbeCheck[] {
  const base: ProbeCheck[] = [
    { name: "cdr", kind: "request", status: "not_probed", latencyMs: null, errorClass: "not_configured" },
    { name: "ocr", kind: "request", status: "not_probed", latencyMs: null, errorClass: "gpu_spend_gate" },
    { name: "coreV2", kind: "request", status: "ok", latencyMs: 100, errorClass: null },
    { name: "r2", kind: "request", status: "ok", latencyMs: 80, errorClass: null },
    { name: "db", kind: "request", status: "ok", latencyMs: 40, errorClass: null },
    { name: "billing", kind: "configuration", status: "ok", latencyMs: null, errorClass: null },
  ];
  return base.map((entry) => ({ ...entry, ...overrides[entry.name] } as ProbeCheck));
}

function run(startedAt: string, overrides: Partial<ProbeRun> = {}): ProbeRun {
  return {
    schemaVersion: PROBE_RUN_SCHEMA,
    startedAt,
    durationMs: 320,
    ok: true,
    checks: checks(),
    fixtureE2E: { enabled: false, status: "not_enabled", code: null },
    ...overrides,
  };
}

function stored(runs: ProbeRun[]): { ok: true; history: ProbeHistory } {
  return { ok: true, history: { schemaVersion: "tavonel.synthetic_probe_history.v1", runs } };
}

describe("B35 operational SLI and freshness gate", () => {
  it("reports available only from fresh, successful required request evidence", () => {
    const result = evaluateOperationalSli(stored([run("2026-09-20T11:55:00.000Z")]), { now: NOW });
    expect(result).toMatchObject({
      schemaVersion: OPERATIONAL_SLI_SCHEMA,
      state: "available",
      freshness: { ageMs: 300_000, ttlMs: DEFAULT_FRESHNESS_TTL_MS },
      availability: { passing: 3, total: 3, ratio: 1, failed: [], unobserved: [] },
      window: { passingRuns: 1, totalRuns: 1, ratio: 1, successfulRequestLatencyP95Ms: 100, latencySamples: 3 },
      alerts: [],
    });
  });

  it("reports degraded when a required dependency failed and preserves the denominator", () => {
    const latest = run("2026-09-20T11:59:00.000Z", {
      ok: false,
      checks: checks({ db: { status: "failed", latencyMs: 5_000, errorClass: "timeout" } }),
    });
    const result = evaluateOperationalSli(stored([latest, run("2026-09-20T11:54:00.000Z"), run("2026-09-20T11:49:00.000Z")]), { now: NOW });
    expect(result.state).toBe("degraded");
    expect(result.availability).toMatchObject({ passing: 2, total: 3, ratio: 2 / 3, failed: ["db"] });
    expect(result.window).toMatchObject({ passingRuns: 2, totalRuns: 3, ratio: 2 / 3 });
    expect(result.alerts).toContainEqual({ severity: "warning", reason: "required_check_failed" });
    expect(result.alerts).toContainEqual({ severity: "warning", reason: "window_failure_budget_exceeded" });
  });

  it("reports degraded when a required request was not observed instead of treating configuration as health", () => {
    const latest = run("2026-09-20T11:59:00.000Z", {
      checks: checks({ db: { kind: "configuration", status: "ok", latencyMs: null, errorClass: null } }),
    });
    const result = evaluateOperationalSli(stored([latest]), { now: NOW });
    expect(result.state).toBe("degraded");
    expect(result.availability.unobserved).toEqual(["db"]);
    expect(result.alerts).toEqual([{ severity: "warning", reason: "required_check_unobserved" }]);
  });

  it("reports stale after the TTL even when the last result passed", () => {
    const result = evaluateOperationalSli(stored([run("2026-09-20T11:49:59.999Z")]), { now: NOW });
    expect(result.state).toBe("stale");
    expect(result.freshness.ageMs).toBe(DEFAULT_FRESHNESS_TTL_MS + 1);
    expect(result.alerts).toEqual([{ severity: "critical", reason: "freshness_ttl_exceeded" }]);
  });

  it("keeps an observation at the TTL boundary fresh", () => {
    const result = evaluateOperationalSli(stored([run("2026-09-20T11:50:00.000Z")]), { now: NOW });
    expect(result.state).toBe("available");
  });

  it("blocks when no request evidence exists or history cannot be trusted", () => {
    const noRequests = run("2026-09-20T11:59:00.000Z", {
      ok: false,
      checks: checks({
        coreV2: { status: "not_probed", latencyMs: null, errorClass: "not_configured" },
        r2: { status: "not_probed", latencyMs: null, errorClass: "not_configured" },
        db: { status: "not_probed", latencyMs: null, errorClass: "not_configured" },
      }),
    });
    expect(evaluateOperationalSli(stored([noRequests]), { now: NOW })).toMatchObject({
      state: "blocked",
      alerts: [{ severity: "critical", reason: "required_check_unobserved" }],
    });
    expect(evaluateOperationalSli(stored([]), { now: NOW })).toMatchObject({
      state: "blocked",
      alerts: [{ severity: "critical", reason: "observation_missing" }],
    });
    const unavailable = evaluateOperationalSli({ ok: false, code: "secret-bearing-provider-error" }, { now: NOW });
    expect(unavailable).toMatchObject({
      state: "blocked",
      alerts: [{ severity: "critical", reason: "history_unavailable" }],
    });
    expect(JSON.stringify(unavailable)).not.toContain("secret-bearing-provider-error");
  });

  it("blocks a future-dated observation beyond the allowed clock skew", () => {
    const result = evaluateOperationalSli(stored([run("2026-09-20T12:01:00.001Z")]), { now: NOW });
    expect(result.state).toBe("blocked");
    expect(result.alerts).toEqual([{ severity: "critical", reason: "observation_clock_skew" }]);
  });

  it("marks an explicitly refused synthetic transaction as degraded", () => {
    const result = evaluateOperationalSli(stored([run("2026-09-20T11:59:00.000Z", {
      ok: false,
      fixtureE2E: { enabled: true, status: "refused", code: "PROBE_FIXTURE_E2E_NOT_IMPLEMENTED" },
    })]), { now: NOW });
    expect(result.state).toBe("degraded");
    expect(result.alerts).toEqual([{ severity: "warning", reason: "synthetic_transaction_refused" }]);
    expect(JSON.stringify(result)).not.toContain("PROBE_FIXTURE_E2E_NOT_IMPLEMENTED");
  });

  it("sorts and caps its measurement window and computes nearest-rank p95", () => {
    const runs = Array.from({ length: MAX_WINDOW_RUNS + 5 }, (_, index) => run(
      new Date(NOW.getTime() - index * 1_000).toISOString(),
      { checks: checks({ coreV2: { latencyMs: index + 1 }, r2: { latencyMs: index + 2 }, db: { latencyMs: index + 3 } }) },
    )).reverse();
    const result = evaluateOperationalSli(stored(runs), { now: NOW, windowRuns: MAX_WINDOW_RUNS });
    expect(result.window.totalRuns).toBe(MAX_WINDOW_RUNS);
    expect(result.window.latencySamples).toBe(MAX_WINDOW_RUNS * 3);
    expect(result.window.successfulRequestLatencyP95Ms).toBe(20);
    expect(result.freshness.lastRunAt).toBe(NOW.toISOString());
  });

  it("rejects unbounded or empty policy inputs", () => {
    expect(() => evaluateOperationalSli(stored([]), { now: NOW, windowRuns: MAX_WINDOW_RUNS + 1 })).toThrow(RangeError);
    expect(() => evaluateOperationalSli(stored([]), { now: NOW, freshnessTtlMs: 0 })).toThrow(RangeError);
    expect(() => evaluateOperationalSli(stored([]), { now: NOW, requiredRequestChecks: [] })).toThrow(RangeError);
  });
});
