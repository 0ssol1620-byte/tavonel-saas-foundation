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
  deliverOperationalSliBreach,
  operationalSliAlertWindow,
  operationalSliBreachId,
  persistOperationalSliAlert,
} from "./operational-sli-alert-store";
import { operationsAlertCounters, resetOperationsAlertDelivery } from "./operations-p0";

const evaluation: OperationalSli = {
  schemaVersion: "tavonel.operational_sli.v1",
  state: "degraded",
  evaluatedAt: "2026-09-20T12:00:00.000Z",
  freshness: { lastRunAt: "2026-09-20T11:59:00.000Z", ageMs: 60_000, ttlMs: 600_000 },
  availability: { required: ["coreV2", "r2", "db"], passing: 2, total: 3, ratio: 2 / 3, failed: ["db"], unobserved: [] },
  window: { passingRuns: 2, totalRuns: 3, ratio: 2 / 3, successfulRequestLatencyP95Ms: 100, latencySamples: 8 },
  modelProviders: [{ provider: "runpod", status: "closed", correlatedFailures: 0 }],
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

describe("operational SLI breach delivery", () => {
  const slot = new Date("2026-09-20T12:00:00.000Z");
  const hook = "https://hooks.example.test/services/T000/B000/secret-token-value";
  const now = slot.getTime() + 60_000;
  let logged: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetOperationsAlertDelivery();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    logged = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  function loggedText() {
    return logged.mock.calls.map((call) => call.join(" ")).join("\n");
  }

  it("sends nothing when the evaluation has no breach", async () => {
    const post = vi.fn();
    vi.stubGlobal("fetch", post);
    vi.stubEnv("OPERATIONS_ALERT_WEBHOOK_URL", hook);
    expect(await deliverOperationalSliBreach({ ...evaluation, state: "available", alerts: [] }, slot, now))
      .toEqual({ breachId: null, code: "NO_BREACH" });
    expect(post).not.toHaveBeenCalled();
  });

  it("records only, and says so, when no webhook is configured", async () => {
    const post = vi.fn();
    vi.stubGlobal("fetch", post);
    vi.stubEnv("OPERATIONS_ALERT_WEBHOOK_URL", "");
    const result = await deliverOperationalSliBreach(evaluation, slot, now);
    expect(result).toEqual({ breachId: operationalSliBreachId(slot), code: "ALERT_DELIVERY_UNCONFIGURED" });
    expect(post).not.toHaveBeenCalled();
    expect(loggedText()).toContain("ALERT_RECEIVER_UNCONFIGURED");
    expect(operationsAlertCounters()).toMatchObject({ unconfigured: 1, delivered: 0 });
  });

  it("posts the breach once per slot and suppresses a duplicate of the same breach", async () => {
    const post = vi.fn(async (_url: string, _init: RequestInit) => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", post);
    vi.stubEnv("OPERATIONS_ALERT_WEBHOOK_URL", hook);

    const first = await deliverOperationalSliBreach(evaluation, slot, now);
    const retry = await deliverOperationalSliBreach(evaluation, slot, now + 30_000);
    const nextSlot = new Date(slot.getTime() + OPERATIONAL_SLI_ALERT_INTERVAL_MS);
    const next = await deliverOperationalSliBreach(evaluation, nextSlot, now + 40_000);

    expect(first).toEqual({ breachId: operationalSliBreachId(slot), code: "ALERT_DELIVERED" });
    expect(retry).toEqual({ breachId: first.breachId, code: "ALERT_SUPPRESSED_DUPLICATE" });
    expect(next.code).toBe("ALERT_DELIVERED");
    expect(next.breachId).not.toBe(first.breachId);
    expect(post).toHaveBeenCalledTimes(2);

    const body = JSON.parse(String(post.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      schemaVersion: "tavonel.operations_alert.v1",
      alertId: first.breachId,
      kind: "incident",
      severity: "warning",
      service: "web",
      observedAt: slot.toISOString(),
      containsCredentials: false,
    });
    expect(body.summary).toContain("required_check_failed");
    expect(Object.keys(body).sort()).toEqual([
      "alertId", "containsCredentials", "dedupeKey", "kind", "observedAt", "runbookUrl",
      "schemaVersion", "service", "severity", "summary", "text",
    ]);
    expect(JSON.stringify(body)).not.toContain("secret-token-value");
  });

  it("reports a 5xx receiver as failed, never as sent, so the retry delivers", async () => {
    const post = vi.fn()
      .mockResolvedValueOnce(new Response("no_service", { status: 503 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", post);
    vi.stubEnv("OPERATIONS_ALERT_WEBHOOK_URL", hook);

    expect((await deliverOperationalSliBreach(evaluation, slot, now)).code).toBe("ALERT_DELIVERY_FAILED");
    expect((await deliverOperationalSliBreach(evaluation, slot, now + 1_000)).code).toBe("ALERT_DELIVERED");
    expect(post).toHaveBeenCalledTimes(2);
    expect(loggedText()).toContain("ALERT_DELIVERY_FAILED");
    expect(loggedText()).not.toContain("hooks.example.test");
  });

  it("bounds the webhook call at 5 s and treats a timeout as a failed delivery", async () => {
    // The receiver never answers; only the abort signal ends the call. Unbounded, the
    // route would run past maxDuration and never return its 502.
    const fired = AbortSignal.abort(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(fired);
    const post = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const signal = init.signal;
      if (signal?.aborted) reject(signal.reason);
      signal?.addEventListener("abort", () => reject(signal.reason));
    }));
    vi.stubGlobal("fetch", post);
    vi.stubEnv("OPERATIONS_ALERT_WEBHOOK_URL", hook);

    try {
      expect(await deliverOperationalSliBreach(evaluation, slot, now))
        .toEqual({ breachId: operationalSliBreachId(slot), code: "ALERT_DELIVERY_FAILED" });
      expect(timeout).toHaveBeenCalledTimes(1);
      expect(timeout).toHaveBeenCalledWith(5_000);
      expect(post).toHaveBeenCalledTimes(1);
      expect(post.mock.calls[0]?.[1]?.signal).toBe(fired);
      expect(operationsAlertCounters()).toMatchObject({ failed: 1, delivered: 0 });
      expect(loggedText()).not.toContain("secret-token-value");
    } finally {
      timeout.mockRestore();
    }
  });

  it("derives a stable, valid UUID breach id from the slot alone", () => {
    expect(operationalSliBreachId(slot)).toBe(operationalSliBreachId(new Date(slot.getTime())));
    expect(operationalSliBreachId(slot))
      .toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
