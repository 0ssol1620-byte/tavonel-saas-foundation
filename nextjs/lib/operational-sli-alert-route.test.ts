/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const { readSigner, readHistory, persist, evaluate } = vi.hoisted(() => ({
  readSigner: vi.fn(),
  readHistory: vi.fn(),
  persist: vi.fn(),
  evaluate: vi.fn(() => ({
    schemaVersion: "tavonel.operational_sli.v1",
    state: "blocked",
    evaluatedAt: "2026-09-20T12:00:00.000Z",
    freshness: { lastRunAt: null, ageMs: null, ttlMs: 600_000 },
    availability: { required: ["coreV2", "r2", "db"], passing: 0, total: 3, ratio: 0, failed: [], unobserved: ["coreV2", "r2", "db"] },
    window: { passingRuns: 0, totalRuns: 0, ratio: null, successfulRequestLatencyP95Ms: null, latencySamples: 0 },
    alerts: [{ severity: "critical", reason: "history_unavailable" }],
  })),
}));
vi.mock("@/lib/r2-synthetic-canary", () => ({
  readR2SignerEnv: readSigner,
  authorizeSyntheticCanary: (presented: string | null, secret: string) => presented === `Bearer ${secret}`,
}));
vi.mock("@/lib/synthetic-probe-store", () => ({ readProbeHistory: readHistory }));
vi.mock("@/lib/operational-sli", () => ({ evaluateOperationalSli: evaluate }));
vi.mock("@/lib/operational-sli-alert-store", async (original) => ({
  ...(await original<any>()),
  persistOperationalSliAlert: persist,
}));

const { GET } = await import("../app/api/internal/sli-alerts/route");
const SECRET = "s".repeat(48);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-20T12:04:59.999Z"));
  vi.stubEnv("CRON_SECRET", SECRET);
  readSigner.mockReturnValue(null);
  persist.mockResolvedValue({ ok: false, code: "SLI_ALERT_STORE_NOT_CONFIGURED" });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

function request(token = SECRET) {
  return new Request("https://tavonel.com/api/internal/sli-alerts", {
    headers: { authorization: `Bearer ${token}` },
  });
}

describe("scheduled operational SLI alert route", () => {
  it("runs one minute after each five-minute probe slot", () => {
    const deployment = JSON.parse(readFileSync(resolve(import.meta.dirname, "../vercel.json"), "utf8")) as {
      crons: Array<{ path: string; schedule: string }>;
    };
    expect(deployment.crons.find((entry) => entry.path === "/api/internal/probe")?.schedule).toBe("*/5 * * * *");
    expect(deployment.crons.find((entry) => entry.path === "/api/internal/sli-alerts")?.schedule).toBe("1-56/5 * * * *");
  });

  it("fails closed before reading telemetry", async () => {
    const response = await GET(request("wrong".repeat(12)));
    expect(response.status).toBe(401);
    expect(readSigner).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it("persists an honest blocked evaluation when probe storage is unavailable", async () => {
    const response = await GET(request());
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({
      code: "SLI_ALERT_STORE_NOT_CONFIGURED",
      persisted: false,
      evaluation: {
        state: "blocked",
        evaluatedAt: "2026-09-20T12:00:00.000Z",
        alerts: [{ severity: "critical", reason: "history_unavailable" }],
      },
    });
    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({ state: "blocked" }),
      new Date("2026-09-20T12:00:00.000Z"),
    );
    expect(JSON.stringify(body)).not.toContain("PROBE_STORE_NOT_CONFIGURED");
  });

  it("returns a durable replay receipt as success", async () => {
    persist.mockResolvedValue({
      ok: true,
      receipt: {
        evaluationKey: `sha256:${"a".repeat(64)}`,
        payloadSha256: `sha256:${"b".repeat(64)}`,
        windowStartedAt: "2026-09-20T12:00:00.000Z",
        status: "replayed",
      },
    });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      code: "SLI_ALERT_EVALUATION_REPLAYED",
      persisted: true,
      receipt: { status: "replayed" },
    });
  });
});
