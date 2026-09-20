import { beforeEach, describe, expect, it, vi } from "vitest";

const { adminConfig, adminRequest } = vi.hoisted(() => ({
  adminConfig: vi.fn(),
  adminRequest: vi.fn(),
}));
vi.mock("./supabase-admin", () => ({
  readSupabaseAdminConfig: adminConfig,
  supabaseAdminRequest: adminRequest,
}));

import type { OperationalSli } from "./operational-sli";
import {
  OPERATIONAL_SLI_ALERT_INTERVAL_MS,
  operationalSliAlertWindow,
  persistOperationalSliAlert,
} from "./operational-sli-alert-store";

const evaluation: OperationalSli = {
  schemaVersion: "tavonel.operational_sli.v1",
  state: "degraded",
  evaluatedAt: "2026-09-20T12:00:00.000Z",
  freshness: { lastRunAt: "2026-09-20T11:59:00.000Z", ageMs: 60_000, ttlMs: 600_000 },
  availability: { required: ["coreV2", "r2", "db"], passing: 2, total: 3, ratio: 2 / 3, failed: ["db"], unobserved: [] },
  window: { passingRuns: 2, totalRuns: 3, ratio: 2 / 3, successfulRequestLatencyP95Ms: 100, latencySamples: 8 },
  alerts: [{ severity: "warning", reason: "required_check_failed" }],
};

describe("scheduled operational SLI persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    adminConfig.mockReturnValue({ url: "https://example.supabase.co", serviceRoleKey: "x".repeat(48) });
  });

  it("maps scheduler jitter to one deterministic UTC slot", () => {
    expect(operationalSliAlertWindow(new Date("2026-09-20T12:04:59.999Z")).toISOString())
      .toBe("2026-09-20T12:00:00.000Z");
    expect(operationalSliAlertWindow(new Date("2026-09-20T12:05:00.000Z")).getTime())
      .toBe(new Date("2026-09-20T12:00:00.000Z").getTime() + OPERATIONAL_SLI_ALERT_INTERVAL_MS);
  });

  it("sends stable inputs to the database idempotency boundary and accepts a replay", async () => {
    adminRequest.mockResolvedValue(Response.json({
      evaluationKey: `sha256:${"a".repeat(64)}`,
      payloadSha256: `sha256:${"b".repeat(64)}`,
      windowStartedAt: "2026-09-20T12:00:00.000Z",
      status: "replayed",
    }));
    const result = await persistOperationalSliAlert(evaluation, new Date("2026-09-20T12:00:00.000Z"));
    expect(result).toMatchObject({ ok: true, receipt: { status: "replayed" } });
    const [, path, init] = adminRequest.mock.calls[0];
    expect(path).toBe("/rest/v1/rpc/record_foundation_operational_sli");
    expect(JSON.parse(init.body)).toEqual({
      p_window_started_at: "2026-09-20T12:00:00.000Z",
      p_evaluation: evaluation,
    });
  });

  it("fails honestly when configuration, transport, or receipt validation fails", async () => {
    adminConfig.mockReturnValueOnce(null);
    await expect(persistOperationalSliAlert(evaluation, new Date("2026-09-20T12:00:00.000Z")))
      .resolves.toEqual({ ok: false, code: "SLI_ALERT_STORE_NOT_CONFIGURED" });

    adminRequest.mockRejectedValueOnce(new Error("secret-bearing provider detail"));
    await expect(persistOperationalSliAlert(evaluation, new Date("2026-09-20T12:00:00.000Z")))
      .resolves.toEqual({ ok: false, code: "SLI_ALERT_STORE_WRITE_FAILED" });

    adminRequest.mockResolvedValueOnce(Response.json({ status: "recorded" }));
    await expect(persistOperationalSliAlert(evaluation, new Date("2026-09-20T12:00:00.000Z")))
      .resolves.toEqual({ ok: false, code: "SLI_ALERT_STORE_WRITE_FAILED" });
  });

  it("rejects non-slot timestamps before performing a write", async () => {
    await expect(persistOperationalSliAlert(evaluation, new Date("2026-09-20T12:00:00.001Z")))
      .rejects.toThrow(RangeError);
    expect(adminRequest).not.toHaveBeenCalled();
  });
});
