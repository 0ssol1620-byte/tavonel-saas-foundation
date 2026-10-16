import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MODEL_PROVIDER_CIRCUIT_SCHEMA } from "./model-provider-circuit";
import type { OperationalJobObservation } from "./operational-job-liveness";
import { PROBE_RUN_SCHEMA, type ProbeCheck, type ProbeRun } from "./synthetic-probe";
import * as route from "../app/api/internal/sli/route";

const mocks = vi.hoisted(() => ({
  readProbeHistory: vi.fn(),
  readModelProviderCircuitSnapshot: vi.fn(),
  readOperationalJobObservation: vi.fn(),
}));

vi.mock("./synthetic-probe-store", () => ({ readProbeHistory: mocks.readProbeHistory }));
vi.mock("./model-provider-circuit-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./model-provider-circuit-store")>()),
  readModelProviderCircuitSnapshot: mocks.readModelProviderCircuitSnapshot,
}));
vi.mock("./operational-job-liveness-store", () => ({
  readOperationalJobObservation: mocks.readOperationalJobObservation,
}));

const WORKER_SECRET = "w".repeat(40);
const CRON_SECRET = "c".repeat(40);
const SUPABASE_URL = "https://project-ref.supabase.co";
const SERVICE_ROLE_KEY = `sb_secret_${"k".repeat(40)}`;
const ROW_SENTINEL = "2026-09-20T11:58:07.123456+00";

function freshRun(): ProbeRun {
  const check = (name: ProbeCheck["name"]) =>
    ({ name, kind: "request", status: "ok", latencyMs: 50, errorClass: null } as ProbeCheck);
  return {
    schemaVersion: PROBE_RUN_SCHEMA,
    startedAt: new Date(Date.now() - 60_000).toISOString(),
    durationMs: 300,
    ok: true,
    checks: [check("coreV2"), check("r2"), check("db")],
    fixtureE2E: { enabled: false, status: "not_enabled", code: null },
  };
}

const healthyQueue: OperationalJobObservation = {
  ok: true,
  observedAt: new Date().toISOString(),
  rows: [{
    state: "queued",
    available_at: ROW_SENTINEL,
    lease_expires_at: null,
    updated_at: ROW_SENTINEL,
    items_seen: 0,
    items_done: 0,
  }],
  truncated: false,
};

function get(authorization?: string) {
  const headers = authorization ? { authorization } : undefined;
  return route.GET(new Request("https://app.test/api/internal/sli", { headers }));
}

beforeEach(() => {
  vi.stubEnv("FOUNDATION_WORKER_SECRET", WORKER_SECRET);
  vi.stubEnv("CRON_SECRET", CRON_SECRET);
  vi.stubEnv("R2_ACCOUNT_ID", "account");
  vi.stubEnv("R2_BUCKET", "bucket");
  vi.stubEnv("R2_ACCESS_KEY_ID", "access-key-id");
  vi.stubEnv("R2_SECRET_ACCESS_KEY", "secret-access-key");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL);
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", SERVICE_ROLE_KEY);
  mocks.readProbeHistory.mockResolvedValue({
    ok: true,
    history: { schemaVersion: "tavonel.synthetic_probe_history.v1", runs: [freshRun()] },
  });
  mocks.readModelProviderCircuitSnapshot.mockResolvedValue({
    ok: true,
    state: {
      schemaVersion: MODEL_PROVIDER_CIRCUIT_SCHEMA,
      provider: "runpod",
      phase: "closed",
      revision: 1,
      correlatedFailures: 0,
      failureWindowStartedAt: null,
      openedAt: null,
      cooldownUntil: null,
      probeAdmissionId: null,
      probeExpiresAt: null,
      updatedAt: new Date().toISOString(),
    },
  });
  mocks.readOperationalJobObservation.mockResolvedValue(healthyQueue);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("K23 internal SLI read route", () => {
  it("exports GET and no mutating method", () => {
    const methods = Object.keys(route).filter((name) => /^[A-Z]+$/.test(name));
    expect(methods).toEqual(["GET"]);
  });

  it("refuses a missing, malformed or wrong secret before reading anything", async () => {
    for (const authorization of [undefined, WORKER_SECRET, `Bearer ${WORKER_SECRET}x`, "Bearer wrong", `Basic ${CRON_SECRET}`]) {
      const response = await get(authorization);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ code: "SLI_NOT_AUTHORIZED" });
    }
    expect(mocks.readProbeHistory).not.toHaveBeenCalled();
    expect(mocks.readModelProviderCircuitSnapshot).not.toHaveBeenCalled();
    expect(mocks.readOperationalJobObservation).not.toHaveBeenCalled();
  });

  it("refuses a configured secret shorter than 32 characters", async () => {
    vi.stubEnv("FOUNDATION_WORKER_SECRET", "short-secret");
    vi.stubEnv("CRON_SECRET", "");
    expect((await get("Bearer short-secret")).status).toBe(401);
    expect(mocks.readOperationalJobObservation).not.toHaveBeenCalled();
  });

  it("accepts either secret and keeps the unknown gate out of a healthy dependency SLI", async () => {
    for (const secret of [WORKER_SECRET, CRON_SECRET]) {
      const response = await get(`Bearer ${secret}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const text = await response.text();
      const body = JSON.parse(text);
      expect(body.code).toBe("SLI_EVALUATED");
      expect(body.evaluation).toMatchObject({ state: "available", alerts: [] });
      expect(body.evaluation.jobLiveness).toEqual({
        kind: "operational_job_liveness",
        state: "unknown",
        healthy: false,
        reasons: ["processing_gate_unknown"],
        counts: null,
        oldestOverdueSeconds: null,
        oldestExpiredLeaseSeconds: null,
        oldestStalledSeconds: null,
      });
      for (const leaked of [WORKER_SECRET, CRON_SECRET, SERVICE_ROLE_KEY, SUPABASE_URL, ROW_SENTINEL, "secret-access-key"]) {
        expect(text).not.toContain(leaked);
      }
    }
    expect(mocks.readOperationalJobObservation).toHaveBeenCalledWith({
      supabaseUrl: SUPABASE_URL,
      serviceRoleKey: SERVICE_ROLE_KEY,
    });
  });

  it("keeps unconfigured stores blocked and unknown, never green", async () => {
    vi.stubEnv("R2_BUCKET", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    mocks.readOperationalJobObservation.mockResolvedValue({ ok: false, failure: "store_not_configured" });

    const response = await get(`Bearer ${WORKER_SECRET}`);
    expect(response.status).toBe(200);
    const { evaluation } = await response.json();
    expect(mocks.readProbeHistory).not.toHaveBeenCalled();
    expect(mocks.readOperationalJobObservation).toHaveBeenCalledWith({ supabaseUrl: undefined, serviceRoleKey: undefined });
    expect(evaluation).toMatchObject({
      state: "blocked",
      alerts: [{ severity: "critical", reason: "history_unavailable" }],
    });
    expect(evaluation.jobLiveness).toMatchObject({ state: "unknown", healthy: false });
    expect(JSON.stringify(evaluation)).not.toMatch(/PROBE_STORE_NOT_CONFIGURED|store_not_configured/);
  });
});
