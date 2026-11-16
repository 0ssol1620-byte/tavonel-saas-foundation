import { afterEach, describe, expect, it, vi } from "vitest";

const admin = vi.hoisted(() => ({ config: vi.fn(), request: vi.fn() }));
vi.mock("./supabase-admin", () => ({ readSupabaseAdminConfig: admin.config, supabaseAdminRequest: admin.request }));

import { readCompileQueueTimings, summarizeQueueTimings } from "./compile-queue-timing";

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const SINCE = "2026-11-16T10:00:00.000Z";
const JOB_A = { job_id: "cjob-a", created_at: "2026-11-16T10:00:00Z", settled_at: "2026-11-16T10:10:00Z" };

afterEach(() => vi.resetAllMocks());

describe("summarizeQueueTimings", () => {
  it("gives exact nearest-rank percentiles on a known 20-sample set", () => {
    const samples = Array.from({ length: 20 }, (_, index) => ({ startWaitSeconds: index + 1, timeToSettleSeconds: (index + 1) * 100 }));
    expect(summarizeQueueTimings(samples)).toEqual({
      n: 20,
      startWait: { p50: 10, p95: 19, p99: 20 },
      timeToSettle: { p50: 1000, p95: 1900, p99: 2000 },
    });
  });

  it("is empty-shaped for no samples, and skips unknown start waits rather than counting zero", () => {
    expect(summarizeQueueTimings([])).toEqual({ n: 0, startWait: { p50: null, p95: null, p99: null }, timeToSettle: { p50: null, p95: null, p99: null } });
    const mixed = summarizeQueueTimings([{ startWaitSeconds: null, timeToSettleSeconds: 5 }, { startWaitSeconds: 8, timeToSettleSeconds: 9 }]);
    expect(mixed.startWait.p50).toBe(8);
    expect(mixed.n).toBe(2);
  });
});

describe("readCompileQueueTimings", () => {
  it("joins settled jobs to their first non-created event", async () => {
    admin.config.mockReturnValue({ url: "https://s.test", serviceRoleKey: "k" });
    admin.request
      .mockResolvedValueOnce(json([JOB_A, { job_id: "cjob-b", created_at: "2026-11-16T10:00:00Z", settled_at: "2026-11-16T10:01:00Z" }]))
      .mockResolvedValueOnce(json([
        { job_id: "cjob-a", occurred_at: "2026-11-16T10:00:30Z" },
        { job_id: "cjob-a", occurred_at: "2026-11-16T10:05:00Z" },
      ]));
    expect(await readCompileQueueTimings(SINCE)).toEqual({
      ok: true,
      samples: [{ startWaitSeconds: 30, timeToSettleSeconds: 600 }, { startWaitSeconds: null, timeToSettleSeconds: 60 }],
    });
    const jobsPath = decodeURIComponent(String(admin.request.mock.calls[0]![1]));
    expect(jobsPath).toContain("state=in.(ready,failed)");
    expect(jobsPath).toContain(`settled_at=gte.${SINCE}`);
    expect(jobsPath).toContain("limit=500");
  });

  it("is ok with no samples, and reads no events, when nothing settled", async () => {
    admin.config.mockReturnValue({ url: "https://s.test", serviceRoleKey: "k" });
    admin.request.mockResolvedValueOnce(json([]));
    expect(await readCompileQueueTimings(SINCE)).toEqual({ ok: true, samples: [] });
    expect(admin.request).toHaveBeenCalledTimes(1);
  });

  it("is not ok when unconfigured, on a failed read, on a bad payload, on a throw, or on a bad timestamp", async () => {
    admin.config.mockReturnValue(null);
    expect(await readCompileQueueTimings(SINCE)).toEqual({ ok: false });
    admin.config.mockReturnValue({ url: "https://s.test", serviceRoleKey: "k" });
    admin.request.mockResolvedValueOnce(json({}, 500));
    expect(await readCompileQueueTimings(SINCE)).toEqual({ ok: false });
    admin.request.mockResolvedValueOnce(json({ not: "an array" }));
    expect(await readCompileQueueTimings(SINCE)).toEqual({ ok: false });
    admin.request.mockResolvedValueOnce(json([{ ...JOB_A, created_at: "nope" }])).mockResolvedValueOnce(json([]));
    expect(await readCompileQueueTimings(SINCE)).toEqual({ ok: false });
    admin.request.mockResolvedValueOnce(json([JOB_A])).mockResolvedValueOnce(json({}, 503));
    expect(await readCompileQueueTimings(SINCE)).toEqual({ ok: false });
    admin.request.mockRejectedValueOnce(new Error("network"));
    expect(await readCompileQueueTimings(SINCE)).toEqual({ ok: false });
    expect(await readCompileQueueTimings("not-a-date")).toEqual({ ok: false });
  });
});
