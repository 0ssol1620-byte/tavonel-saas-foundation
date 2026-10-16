import { describe, expect, it } from "vitest";

import {
  DEFAULT_OPERATIONAL_JOB_LIVENESS_THRESHOLDS,
  evaluateOperationalJobLiveness,
  MAX_AGE_THRESHOLD_MS,
  MAX_CLOCK_SKEW_TOLERANCE_MS,
  MAX_OBSERVED_ACTIVE_JOBS,
  MAX_REPORTED_AGE_SECONDS,
  MAX_SCHEDULE_AHEAD_MS,
  type OperationalJobLiveness,
  type OperationalJobLivenessReason,
  type OperationalJobObservation,
  type OperationalJobRow,
  parseTimestamptz,
} from "./operational-job-liveness";

const NOW = "2026-10-02T12:00:00.000Z";
const NOW_MS = Date.parse(NOW);
const atMs = (msFromNow: number) => new Date(NOW_MS + msFromNow).toISOString();
const at = (secondsFromNow: number) => atMs(secondsFromNow * 1000);

// Shapes follow public.foundation_jobs: state, available_at, updated_at and
// both progress counters are NOT NULL; only a leased row carries a lease.
function queuedRow(
  dueSecondsFromNow: number,
  overrides: Partial<OperationalJobRow> = {},
): OperationalJobRow {
  return {
    state: "queued",
    available_at: at(dueSecondsFromNow),
    lease_expires_at: null,
    updated_at: at(-60),
    items_seen: 0,
    items_done: 0,
    ...overrides,
  };
}

function leasedRow(overrides: Partial<OperationalJobRow> = {}): OperationalJobRow {
  return {
    state: "leased",
    available_at: at(-300),
    lease_expires_at: at(240),
    updated_at: at(-15),
    items_seen: 40,
    items_done: 12,
    ...overrides,
  };
}

function observed(
  rows: unknown[],
  overrides: Partial<Extract<OperationalJobObservation, { ok: true }>> = {},
): OperationalJobObservation {
  return {
    ok: true,
    observedAt: NOW,
    rows: rows as OperationalJobRow[],
    truncated: false,
    ...overrides,
  };
}

const ZERO_COUNTS = {
  eligible: 0,
  deferred: 0,
  overdue: 0,
  leased: 0,
  expiredLease: 0,
  stalled: 0,
};

function expectUnknown(
  result: OperationalJobLiveness,
  reason: OperationalJobLivenessReason,
) {
  expect(result).toEqual({
    kind: "operational_job_liveness",
    state: "unknown",
    healthy: false,
    reasons: [reason],
    counts: null,
    oldestOverdueSeconds: null,
    oldestExpiredLeaseSeconds: null,
    oldestStalledSeconds: null,
  });
}

describe("evaluateOperationalJobLiveness", () => {
  it("reports a fresh, moving queue as healthy", () => {
    const result = evaluateOperationalJobLiveness(
      observed([queuedRow(-30), leasedRow()]),
      "open",
    );

    expect(result).toEqual({
      kind: "operational_job_liveness",
      state: "healthy",
      healthy: true,
      reasons: ["queue_active"],
      counts: { ...ZERO_COUNTS, eligible: 1, leased: 1 },
      oldestOverdueSeconds: null,
      oldestExpiredLeaseSeconds: null,
      oldestStalledSeconds: null,
    });
  });

  it("treats an empty, successfully observed queue as idle and healthy", () => {
    const result = evaluateOperationalJobLiveness(observed([]), "open");

    expect(result.state).toBe("idle");
    expect(result.healthy).toBe(true);
    expect(result.reasons).toEqual(["queue_idle"]);
    expect(result.counts).toEqual(ZERO_COUNTS);
  });

  it("flags queued work that has been eligible for too long as overdue", () => {
    const result = evaluateOperationalJobLiveness(
      observed([queuedRow(-600), queuedRow(-30)]),
      "open",
    );

    expect(result.state).toBe("degraded");
    expect(result.healthy).toBe(false);
    expect(result.reasons).toEqual(["queued_overdue"]);
    expect(result.counts).toEqual({ ...ZERO_COUNTS, overdue: 1, eligible: 1 });
    expect(result.oldestOverdueSeconds).toBe(600);
  });

  it("does not treat future available_at backoff as overdue", () => {
    const result = evaluateOperationalJobLiveness(
      observed([queuedRow(3600), queuedRow(86_400)]),
      "open",
    );

    expect(result.state).toBe("healthy");
    expect(result.counts).toEqual({ ...ZERO_COUNTS, deferred: 2 });
    expect(result.oldestOverdueSeconds).toBeNull();
  });

  it("accepts a quota deferral up to the 24-hour durable schedule bound", () => {
    const { clockSkewToleranceMs } = DEFAULT_OPERATIONAL_JOB_LIVENESS_THRESHOLDS;
    expect(MAX_SCHEDULE_AHEAD_MS).toBe(86_400 * 1000);

    // complete_foundation_job_batch('deferred') at its 86,400 s cap: the row is
    // written with updated_at = now() and available_at = now() + 24h.
    const result = evaluateOperationalJobLiveness(
      observed([
        queuedRow(86_400, { updated_at: NOW }),
        queuedRow(0, {
          updated_at: NOW,
          available_at: atMs(MAX_SCHEDULE_AHEAD_MS + clockSkewToleranceMs),
        }),
      ]),
      "open",
    );

    expect(result.state).toBe("healthy");
    expect(result.healthy).toBe(true);
    expect(result.counts).toEqual({ ...ZERO_COUNTS, deferred: 2 });
  });

  it("treats available_at beyond the schedule bound as clock skew, not deferral", () => {
    const { clockSkewToleranceMs } = DEFAULT_OPERATIONAL_JOB_LIVENESS_THRESHOLDS;
    for (const availableAt of [
      atMs(MAX_SCHEDULE_AHEAD_MS + clockSkewToleranceMs + 1),
      at(7 * 24 * 60 * 60),
      "9999-12-31T23:59:59+00:00",
    ]) {
      expectUnknown(
        evaluateOperationalJobLiveness(
          observed([leasedRow(), queuedRow(0, { available_at: availableAt })]),
          "open",
        ),
        "clock_skew",
      );
    }
  });

  it("flags leases that expired beyond the skew tolerance", () => {
    const result = evaluateOperationalJobLiveness(
      observed([leasedRow({ lease_expires_at: at(-300), updated_at: at(-400) })]),
      "open",
    );

    expect(result.state).toBe("degraded");
    expect(result.reasons).toEqual(["lease_expired"]);
    expect(result.counts).toEqual({ ...ZERO_COUNTS, expiredLease: 1 });
    expect(result.oldestExpiredLeaseSeconds).toBe(300);
  });

  it("does not flag a lease that only just crossed expiry within skew tolerance", () => {
    const result = evaluateOperationalJobLiveness(
      observed([leasedRow({ lease_expires_at: at(-10) })]),
      "open",
    );

    expect(result.state).toBe("healthy");
    expect(result.counts).toEqual({ ...ZERO_COUNTS, leased: 1 });
  });

  it("flags a live lease whose durable progress has not moved", () => {
    const result = evaluateOperationalJobLiveness(
      observed([leasedRow({ updated_at: at(-1200) })]),
      "open",
    );

    expect(result.state).toBe("degraded");
    expect(result.reasons).toEqual(["progress_stalled"]);
    expect(result.counts).toEqual({ ...ZERO_COUNTS, stalled: 1 });
    expect(result.oldestStalledSeconds).toBe(1200);
  });

  it("does not infer progress from the progress counters", () => {
    for (const counters of [
      { items_seen: 0, items_done: 0 },
      { items_seen: 500, items_done: 499 },
    ]) {
      const result = evaluateOperationalJobLiveness(
        observed([leasedRow({ updated_at: at(-1200), ...counters })]),
        "open",
      );

      expect(result.state).toBe("degraded");
      expect(result.reasons).toEqual(["progress_stalled"]);
    }
  });

  it("applies each threshold at its exact boundary", () => {
    const { overdueAfterMs, stalledAfterMs, clockSkewToleranceMs } =
      DEFAULT_OPERATIONAL_JOB_LIVENESS_THRESHOLDS;
    const countsFor = (row: OperationalJobRow) =>
      evaluateOperationalJobLiveness(observed([row]), "open").counts;

    expect(countsFor(queuedRow(0))).toEqual({ ...ZERO_COUNTS, eligible: 1 });
    expect(countsFor(queuedRow(0, { available_at: atMs(1) }))).toEqual({
      ...ZERO_COUNTS,
      deferred: 1,
    });
    expect(countsFor(queuedRow(0, { available_at: atMs(1 - overdueAfterMs) }))).toEqual({
      ...ZERO_COUNTS,
      eligible: 1,
    });
    expect(countsFor(queuedRow(0, { available_at: atMs(-overdueAfterMs) }))).toEqual({
      ...ZERO_COUNTS,
      overdue: 1,
    });

    expect(countsFor(leasedRow({ lease_expires_at: atMs(-clockSkewToleranceMs) }))).toEqual({
      ...ZERO_COUNTS,
      leased: 1,
    });
    expect(
      countsFor(leasedRow({ lease_expires_at: atMs(-clockSkewToleranceMs - 1) })),
    ).toEqual({ ...ZERO_COUNTS, expiredLease: 1 });

    expect(countsFor(leasedRow({ updated_at: atMs(1 - stalledAfterMs) }))).toEqual({
      ...ZERO_COUNTS,
      leased: 1,
    });
    expect(countsFor(leasedRow({ updated_at: atMs(-stalledAfterMs) }))).toEqual({
      ...ZERO_COUNTS,
      stalled: 1,
    });

    expect(countsFor(leasedRow({ updated_at: atMs(clockSkewToleranceMs) }))).toEqual({
      ...ZERO_COUNTS,
      leased: 1,
    });
    expectUnknown(
      evaluateOperationalJobLiveness(
        observed([leasedRow({ updated_at: atMs(clockSkewToleranceMs + 1) })]),
        "open",
      ),
      "clock_skew",
    );
  });

  it("reports every degraded signal together", () => {
    const result = evaluateOperationalJobLiveness(
      observed([
        queuedRow(-900),
        leasedRow({ lease_expires_at: at(-120) }),
        leasedRow({ updated_at: at(-1800) }),
      ]),
      "open",
    );

    expect(result.reasons).toEqual([
      "queued_overdue",
      "lease_expired",
      "progress_stalled",
    ]);
  });

  it("reports an intentionally closed gate as paused without claiming health", () => {
    const backlog = evaluateOperationalJobLiveness(
      observed([queuedRow(-900)]),
      "closed",
    );
    expect(backlog.state).toBe("paused");
    expect(backlog.healthy).toBe(false);
    expect(backlog.reasons).toEqual(["processing_gate_closed", "queued_overdue"]);
    expect(backlog.counts).toEqual({ ...ZERO_COUNTS, overdue: 1 });

    const empty = evaluateOperationalJobLiveness(observed([]), "closed");
    expect(empty.state).toBe("paused");
    expect(empty.healthy).toBe(false);
    expect(empty.reasons).toEqual(["processing_gate_closed", "queue_idle"]);
  });

  it("keeps a closed gate paused even when the store is unreadable", () => {
    const result = evaluateOperationalJobLiveness(
      { ok: false, failure: "store_http_error" },
      "closed",
    );

    expect(result.state).toBe("paused");
    expect(result.healthy).toBe(false);
    expect(result.reasons).toEqual(["processing_gate_closed", "store_unavailable"]);
    expect(result.counts).toBeNull();
  });

  it("returns unknown when the processing gate cannot be determined", () => {
    expectUnknown(
      evaluateOperationalJobLiveness(observed([]), "unknown"),
      "processing_gate_unknown",
    );
    expectUnknown(
      evaluateOperationalJobLiveness(observed([]), "maybe" as "open"),
      "processing_gate_unknown",
    );
  });

  it("returns unknown when the store is unreadable", () => {
    for (const failure of [
      "store_not_configured",
      "store_request_failed",
      "store_http_error",
      "store_invalid_response",
      "store_response_too_large",
      "store_clock_unavailable",
    ] as const) {
      expectUnknown(
        evaluateOperationalJobLiveness({ ok: false, failure }, "open"),
        "store_unavailable",
      );
    }
    expectUnknown(
      evaluateOperationalJobLiveness(
        undefined as unknown as OperationalJobObservation,
        "open",
      ),
      "store_unavailable",
    );
  });

  it("returns unknown when the observed time is missing or invalid", () => {
    for (const observedAt of [
      undefined,
      null,
      "",
      "not-a-time",
      "infinity",
      "2026-10-02T12:00:00",
      1_790_000_000_000,
    ]) {
      expectUnknown(
        evaluateOperationalJobLiveness(
          observed([], { observedAt: observedAt as unknown as string }),
          "open",
        ),
        "observed_time_untrusted",
      );
    }
  });

  it("returns unknown when a durable write is ahead of the observed clock", () => {
    expectUnknown(
      evaluateOperationalJobLiveness(
        observed([leasedRow({ updated_at: at(600) })]),
        "open",
      ),
      "clock_skew",
    );
  });

  it("tolerates small forward clock skew on durable writes", () => {
    const result = evaluateOperationalJobLiveness(
      observed([leasedRow({ updated_at: at(10) })]),
      "open",
    );

    expect(result.state).toBe("healthy");
  });

  it("compares timestamptz values as absolute instants across offsets", () => {
    const result = evaluateOperationalJobLiveness(
      observed(
        [
          queuedRow(0, { available_at: "2026-10-02T21:00:00+09:00" }),
          queuedRow(0, { available_at: "2026-10-02 13:00:00.123456+09" }),
        ],
        { observedAt: "2026-10-02 12:00:00.000000+00" },
      ),
      "open",
    );

    expect(result.counts).toEqual({ ...ZERO_COUNTS, eligible: 1, overdue: 1 });
    expect(result.oldestOverdueSeconds).toBe(8 * 60 * 60 - 1);
  });

  it("evaluates a workload exactly at the cap", () => {
    const atCap = Array.from({ length: MAX_OBSERVED_ACTIVE_JOBS }, () => queuedRow(-30));

    const result = evaluateOperationalJobLiveness(observed(atCap), "open");

    expect(result.state).toBe("healthy");
    expect(result.counts).toEqual({ ...ZERO_COUNTS, eligible: MAX_OBSERVED_ACTIVE_JOBS });
  });

  it("returns unknown when the workload is capped or truncated", () => {
    expectUnknown(
      evaluateOperationalJobLiveness(observed([], { truncated: true }), "open"),
      "workload_capped",
    );
    expectUnknown(
      evaluateOperationalJobLiveness(
        observed([queuedRow(-30)], { truncated: undefined as unknown as boolean }),
        "open",
      ),
      "workload_capped",
    );
    const overCap = Array.from({ length: MAX_OBSERVED_ACTIVE_JOBS + 1 }, () =>
      queuedRow(-30),
    );
    expectUnknown(evaluateOperationalJobLiveness(observed(overCap), "open"), "workload_capped");
  });

  it("returns unknown for any row it cannot trust", () => {
    const untrusted: unknown[] = [
      null,
      "row",
      // state is the foundation_job_state enum; only queued/leased are active.
      queuedRow(-30, { state: "running" }),
      queuedRow(-30, { state: "Queued" }),
      queuedRow(-30, { state: undefined }),
      queuedRow(-30, { state: null }),
      queuedRow(-30, { state: "succeeded" }),
      queuedRow(-30, { state: "failed" }),
      queuedRow(-30, { state: "dead" }),
      queuedRow(-30, { state: "canceled" }),
      // A legacy `status` field is not the state column.
      {
        status: "queued",
        available_at: at(-30),
        lease_expires_at: null,
        updated_at: at(-60),
        items_seen: 0,
        items_done: 0,
      },
      // NOT NULL timestamps.
      queuedRow(-30, { available_at: null }),
      leasedRow({ available_at: null }),
      leasedRow({ available_at: "soon" }),
      queuedRow(-30, { updated_at: null }),
      queuedRow(-30, { updated_at: "yesterday" }),
      // Lease shape.
      leasedRow({ lease_expires_at: null }),
      queuedRow(-30, { lease_expires_at: at(240) }),
      queuedRow(-30, { lease_expires_at: undefined }),
      // NOT NULL integer counters with items_done <= items_seen.
      leasedRow({ items_seen: null }),
      leasedRow({ items_done: null }),
      queuedRow(-30, { items_seen: null, items_done: null }),
      leasedRow({ items_seen: -1 }),
      leasedRow({ items_done: 1.5 }),
      leasedRow({ items_seen: 3, items_done: 4 }),
      leasedRow({ items_seen: "40" }),
      leasedRow({ items_done: undefined }),
      leasedRow({ items_seen: 2_147_483_648, items_done: 0 }),
    ];

    for (const row of untrusted) {
      expectUnknown(
        evaluateOperationalJobLiveness(observed([leasedRow(), row]), "open"),
        "row_untrusted",
      );
    }
  });

  it("accepts counters at the integer column ceiling", () => {
    const result = evaluateOperationalJobLiveness(
      observed([leasedRow({ items_seen: 2_147_483_647, items_done: 2_147_483_647 })]),
      "open",
    );

    expect(result.state).toBe("healthy");
  });

  it("returns unknown for invalid thresholds instead of a vacuous pass", () => {
    const valid = DEFAULT_OPERATIONAL_JOB_LIVENESS_THRESHOLDS;
    for (const key of Object.keys(valid) as (keyof typeof valid)[]) {
      for (const value of [
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        -1,
        1.5,
        "60000",
        null,
        undefined,
        Number.MAX_SAFE_INTEGER,
        2 ** 53,
        Number.MAX_VALUE,
      ]) {
        expectUnknown(
          evaluateOperationalJobLiveness(observed([]), "open", {
            ...valid,
            [key]: value as number,
          }),
          "thresholds_invalid",
        );
      }
    }
  });

  it("bounds thresholds so a huge one cannot turn bad work healthy", () => {
    const atMax = {
      overdueAfterMs: MAX_AGE_THRESHOLD_MS,
      stalledAfterMs: MAX_AGE_THRESHOLD_MS,
      clockSkewToleranceMs: MAX_CLOCK_SKEW_TOLERANCE_MS,
    };
    const badWork = [
      queuedRow(-30 * 24 * 60 * 60),
      leasedRow({ updated_at: at(-3 * 24 * 60 * 60), lease_expires_at: at(-2 * 24 * 60 * 60) }),
    ];

    expect(evaluateOperationalJobLiveness(observed([queuedRow(-600)]), "open", atMax).state).toBe(
      "healthy",
    );
    expect(evaluateOperationalJobLiveness(observed(badWork), "open", atMax).reasons).toEqual([
      "queued_overdue",
      "lease_expired",
    ]);
    for (const overMax of [
      { ...atMax, overdueAfterMs: MAX_AGE_THRESHOLD_MS + 1 },
      { ...atMax, stalledAfterMs: MAX_AGE_THRESHOLD_MS + 1 },
      { ...atMax, clockSkewToleranceMs: MAX_CLOCK_SKEW_TOLERANCE_MS + 1 },
      {
        overdueAfterMs: Number.MAX_SAFE_INTEGER,
        stalledAfterMs: Number.MAX_SAFE_INTEGER,
        clockSkewToleranceMs: Number.MAX_SAFE_INTEGER,
      },
    ]) {
      expectUnknown(
        evaluateOperationalJobLiveness(observed(badWork), "open", overMax),
        "thresholds_invalid",
      );
    }
  });

  it("bounds reported ages and never echoes row values", () => {
    const result = evaluateOperationalJobLiveness(
      observed([queuedRow(-30 * 24 * 60 * 60)]),
      "open",
    );

    expect(result.oldestOverdueSeconds).toBe(MAX_REPORTED_AGE_SECONDS);
    expect(Object.keys(result).sort()).toEqual([
      "counts",
      "healthy",
      "kind",
      "oldestExpiredLeaseSeconds",
      "oldestOverdueSeconds",
      "oldestStalledSeconds",
      "reasons",
      "state",
    ]);
    expect(JSON.stringify(result)).not.toContain("2026-");
  });
});

describe("parseTimestamptz", () => {
  it("accepts PostgREST and Postgres text output with explicit offsets", () => {
    expect(parseTimestamptz("2026-10-02T12:00:00+00:00")).toBe(NOW_MS);
    expect(parseTimestamptz("2026-10-02 12:00:00.000999+00")).toBe(NOW_MS);
    expect(parseTimestamptz("2026-10-02T17:30:00+0530")).toBe(NOW_MS);
    expect(parseTimestamptz("2026-10-02T12:00:00Z")).toBe(NOW_MS);
  });

  it("rejects values without a trustworthy instant", () => {
    for (const value of ["2026-10-02T12:00:00", "infinity", "", null, 0]) {
      expect(parseTimestamptz(value)).toBeNull();
    }
  });
});
