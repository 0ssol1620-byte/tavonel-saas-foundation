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
const { resetOperationsAlertDelivery } = await import("./operations-p0");
const SECRET = "s".repeat(48);
const HOOK = "https://hooks.example.test/services/T000/B000/route-secret-token";
const RECEIPT = {
  evaluationKey: `sha256:${"a".repeat(64)}`,
  payloadSha256: `sha256:${"b".repeat(64)}`,
  windowStartedAt: "2026-09-20T12:00:00.000Z",
  status: "recorded",
};
let quietErrors: { mockRestore: () => void };

beforeEach(() => {
  resetOperationsAlertDelivery();
  quietErrors = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("OPERATIONS_ALERT_WEBHOOK_URL", "");
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-20T12:04:59.999Z"));
  vi.stubEnv("CRON_SECRET", SECRET);
  readSigner.mockReturnValue(null);
  persist.mockResolvedValue({ ok: false, code: "SLI_ALERT_STORE_NOT_CONFIGURED" });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  quietErrors.mockRestore();
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

  it("reads probe history at the real clock and evaluates it at the slot instant", async () => {
    // Regression: the read used to be signed at the slot start, ~70 s before the cron runs, and
    // the 60 s signed URL was refused on every production slot (history_unavailable).
    const signer = { accountId: "a", bucket: "tavonel-saas-foundation-quarantine", accessKeyId: "k", secretAccessKey: "s" };
    readSigner.mockReturnValue(signer);
    const stored = { ok: true, history: { schemaVersion: "tavonel.synthetic_probe_history.v1", runs: [] } };
    readHistory.mockResolvedValue(stored);
    await GET(request());
    expect(readHistory).toHaveBeenCalledTimes(1);
    expect(readHistory.mock.calls[0]).toEqual([signer]);
    expect(evaluate).toHaveBeenCalledWith(stored, expect.objectContaining({ now: new Date("2026-09-20T12:00:00.000Z") }));
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

  it("GA gap 4: hands the evaluator the compile backlog, and an unreadable queue as unavailable rather than empty", async () => {
    await GET(request());
    expect(evaluate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      now: new Date("2026-09-20T12:00:00.000Z"),
      compileBacklog: { ok: false },
    }));
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
      delivery: { code: "ALERT_DELIVERY_UNCONFIGURED" },
    });
  });

  it("delivers a recorded breach to the operations webhook after the receipt is durable", async () => {
    vi.stubEnv("OPERATIONS_ALERT_WEBHOOK_URL", HOOK);
    const post = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", post);
    persist.mockResolvedValue({ ok: true, receipt: RECEIPT });

    const response = await GET(request());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      code: "SLI_ALERT_EVALUATION_RECORDED",
      persisted: true,
      delivery: { code: "ALERT_DELIVERED", breachId: expect.any(String) },
    });
    expect(post).toHaveBeenCalledTimes(1);
    expect(persist.mock.invocationCallOrder[0]).toBeLessThan(post.mock.invocationCallOrder[0]);
    expect(JSON.stringify(body)).not.toContain("route-secret-token");
  });

  it("returns 502 with the durable receipt when the webhook rejects the breach", async () => {
    vi.stubEnv("OPERATIONS_ALERT_WEBHOOK_URL", HOOK);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no_service", { status: 500 })));
    persist.mockResolvedValue({ ok: true, receipt: RECEIPT });

    const response = await GET(request());
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body).toMatchObject({
      code: "SLI_ALERT_DELIVERY_FAILED",
      persisted: true,
      receipt: { status: "recorded" },
      delivery: { code: "ALERT_DELIVERY_FAILED" },
    });
    expect(JSON.stringify(body)).not.toContain("route-secret-token");
  });

  it("still pages when the record itself could not be persisted", async () => {
    vi.stubEnv("OPERATIONS_ALERT_WEBHOOK_URL", HOOK);
    const post = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", post);

    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      persisted: false,
      delivery: { code: "ALERT_DELIVERED" },
    });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("W1-A3: reports the hourly RunPod cost check beside the SLI result without changing its status", async () => {
    persist.mockResolvedValue({ ok: true, receipt: RECEIPT });
    const response = await GET(request());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.code).toBe("SLI_ALERT_EVALUATION_RECORDED");
    // The 12:00 slot is an hourly slot; with no cap configured the check says so and pages nobody.
    expect(body.watch).toEqual([{ check: "runpod_daily_cost", code: "RUNPOD_COST_CAP_UNCONFIGURED" }]);

    vi.setSystemTime(new Date("2026-09-20T12:09:59.999Z"));
    expect((await (await GET(request())).json()).watch).toEqual([]);
  });

  it("W1-A3: pages a RunPod day over its cap from the hourly slot", async () => {
    vi.stubEnv("OPERATIONS_ALERT_WEBHOOK_URL", HOOK);
    vi.stubEnv("TAVONEL_RUNPOD_DAILY_COST_CAP_USD", "10");
    vi.stubEnv("TAVONEL_RUNPOD_API_KEY", "rp-test");
    const post = vi.fn(async (url: string) => url.startsWith("https://api.runpod.io/")
      ? new Response(JSON.stringify({ records: [{ startTime: "2026-09-20T00:00:00Z", totalAmount: 11 }] }), { status: 200 })
      : new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", post);
    persist.mockResolvedValue({ ok: true, receipt: RECEIPT });
    const body = await (await GET(request())).json();
    expect(body.watch).toEqual([{ check: "runpod_daily_cost", code: "RUNPOD_COST_CAP_EXCEEDED", delivery: "ALERT_DELIVERED" }]);
    const pages = post.mock.calls.filter(([url]) => url === HOOK).map((entry) => JSON.parse(String((entry as unknown as [string, RequestInit])[1].body)));
    expect(pages.map((page) => page.kind)).toEqual(["incident", "cost"]);
    expect(JSON.stringify(body)).not.toContain("rp-test");
  });
});
