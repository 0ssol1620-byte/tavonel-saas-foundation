import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./supabase-admin", () => ({
  readSupabaseAdminConfig: (env: Record<string, string | undefined> = process.env) =>
    env.TEST_STORE === "off" ? null : { url: "https://store.test", serviceRoleKey: "k".repeat(40) },
  supabaseAdminRequest: (_config: unknown, path: string) => store.request(path),
}));

import {
  alertCompileJobTurn,
  alertOcrFailure,
  checkReleaseRowExpiry,
  checkRunPodDailyCost,
  ocrSpendStop,
  resetOcrSpendStopCache,
  MCP_SPIKE_MIN_CALLS,
  OPERATIONS_ALERTS_RUNBOOK_URL,
  recordMcpToolCall,
  resetMcpSpikeWindow,
  runScheduledOperationsChecks,
  stableAlertId,
} from "./operations-alert-triggers";
import { operationsAlertCounters, resetOperationsAlertDelivery } from "./operations-p0";

const NOW = Date.parse("2026-11-04T09:00:00Z");
const JOB = { jobId: `cjob-${"a".repeat(32)}`, workspaceKey: "pilot-ops01", blocked: [] as { documentId: string; reason: string }[] };
const DOC = "0a100000-0000-4000-8000-00000000000a";
const SHA = "1".repeat(40);

let posts: Array<Record<string, unknown>>;
beforeEach(() => {
  resetOperationsAlertDelivery();
  resetMcpSpikeWindow();
  vi.restoreAllMocks();
  store.request.mockReset();
  posts = [];
  vi.stubEnv("OPERATIONS_ALERT_WEBHOOK_URL", "https://hooks.example.test/T/B/X");
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    posts.push(JSON.parse(String(init?.body)));
    return new Response("ok", { status: 200 });
  }));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("stableAlertId", () => {
  it("is a UUID the payload validator accepts, the same for the same trigger", () => {
    expect(stableAlertId("x")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(stableAlertId("x")).toBe(stableAlertId("x"));
    expect(stableAlertId("x")).not.toBe(stableAlertId("y"));
  });
});

describe("compile job worker pages", () => {
  it("pages a job that settled failed (the dead letter), with its code and the runbook", async () => {
    const [sent] = await alertCompileJobTurn(JOB, { note: "failed", errorCode: "NO_DOCUMENT_COULD_BE_READ", deadLettered: true, blocked: [] }, NOW);
    expect(sent).toMatchObject({ ok: true, code: "ALERT_DELIVERED" });
    expect(posts[0]).toMatchObject({
      schemaVersion: "tavonel.operations_alert.v1", kind: "incident", service: "web", severity: "warning",
      runbookUrl: OPERATIONS_ALERTS_RUNBOOK_URL, containsCredentials: false,
    });
    expect(posts[0]!.summary).toContain(JOB.jobId);
    expect(posts[0]!.summary).toContain("NO_DOCUMENT_COULD_BE_READ");
  });

  it("does not page a failed turn whose failed state was not durably written by it", async () => {
    expect(await alertCompileJobTurn(JOB, { note: "failed", errorCode: "NO_DOCUMENT_COULD_BE_READ", blocked: [] }, NOW)).toEqual([]);
    expect(posts).toEqual([]);
  });

  it("does not page a turn that compiled, waited or rested", async () => {
    for (const note of ["compiled", "waiting", "resting", "blocked", "skipped"]) {
      expect(await alertCompileJobTurn(JOB, { note, blocked: [] }, NOW)).toEqual([]);
    }
    expect(posts).toEqual([]);
  });

  it("pages a document newly blocked as never arrived, once, and not again on the next turn", async () => {
    const blocked = [{ documentId: DOC, reason: "DOCUMENT_NEVER_ARRIVED" }];
    await alertCompileJobTurn(JOB, { note: "blocked", blocked }, NOW);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ service: "r2" });
    expect(posts[0]!.summary).toContain("DOCUMENT_NEVER_ARRIVED");
    // The next turn starts from the recorded blocker: nothing new, nothing sent.
    expect(await alertCompileJobTurn({ ...JOB, blocked }, { note: "blocked", blocked }, NOW + 60_000)).toEqual([]);
    // A different reason is not this page.
    expect(await alertCompileJobTurn(JOB, { note: "blocked", blocked: [{ documentId: DOC, reason: "READING_DID_NOT_FINISH" }] }, NOW)).toEqual([]);
  });
});

describe("OCR settlement pages", () => {
  it("pages OCR_TIMEOUT_OR_NETWORK, OCR_HTTP_UNAVAILABLE and OCR_RESPONSE_INVALID, and nothing else", async () => {
    expect(await alertOcrFailure({ workspaceKey: "pilot-ops01", documentId: DOC, reasonCode: "OCR_TIMEOUT_OR_NETWORK", outcome: "released" }, NOW)).toMatchObject({ code: "ALERT_DELIVERED" });
    // GA gap 4: the reader answering 429/5xx through every retry settles released, like a timeout, and pages like one.
    expect(await alertOcrFailure({ workspaceKey: "pilot-ops01", documentId: DOC, reasonCode: "OCR_HTTP_UNAVAILABLE", outcome: "released" }, NOW)).toMatchObject({ code: "ALERT_DELIVERED" });
    expect(await alertOcrFailure({ workspaceKey: "pilot-ops01", documentId: DOC, reasonCode: "OCR_RESPONSE_INVALID", outcome: "operator_review" }, NOW)).toMatchObject({ code: "ALERT_DELIVERED" });
    // The page says what the settlement did, never a state it did not report.
    expect(posts.map((post) => String(post.summary).split("; ")[1])).toEqual([
      "the reservation was released at no charge", "the reservation was released at no charge", "the reservation is held for operator review",
    ]);
    for (const reasonCode of ["OCR_COMPLETED", "CDR_PERMANENT_REJECT", "GPU_NOT_DISPATCHED", "OCR_HTTP_REJECTED"]) {
      expect(await alertOcrFailure({ workspaceKey: "pilot-ops01", documentId: DOC, reasonCode }, NOW)).toBeNull();
    }
    expect(posts.map((post) => post.service)).toEqual(["runpod", "runpod", "runpod"]);
    expect(String(posts[1]!.summary)).toContain("OCR_HTTP_UNAVAILABLE");
    expect(String(posts[2]!.summary)).toContain("OCR_RESPONSE_INVALID");
  });
});

describe("MCP 5xx spike", () => {
  it("does not page below the minimum number of calls, however many failed", async () => {
    for (let i = 0; i < MCP_SPIKE_MIN_CALLS - 1; i += 1) expect(await recordMcpToolCall(true, NOW + i)).toBeNull();
    expect(posts).toEqual([]);
  });

  it("pages once per slot when the 5xx share crosses the bar, with the share as a metric", async () => {
    for (let i = 0; i < 18; i += 1) await recordMcpToolCall(false, NOW + i);
    expect(await recordMcpToolCall(true, NOW + 18)).toBeNull();
    expect(await recordMcpToolCall(true, NOW + 19)).toMatchObject({ code: "ALERT_DELIVERED" });
    expect(await recordMcpToolCall(true, NOW + 20)).toMatchObject({ code: "ALERT_SUPPRESSED_DUPLICATE" });
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ severity: "critical", unit: "percent", thresholdValue: 5 });
    expect(posts[0]!.currentValue).toBeGreaterThanOrEqual(5);
  });

  it("never pages on a successful call, and forgets calls older than the window", async () => {
    for (let i = 0; i < 25; i += 1) await recordMcpToolCall(true, NOW + i);
    resetOperationsAlertDelivery();
    posts = [];
    expect(await recordMcpToolCall(false, NOW + 30)).toBeNull();
    // Ten minutes later the 25 failures are out of the window: one failure in one call is not a spike.
    expect(await recordMcpToolCall(true, NOW + 10 * 60_000)).toBeNull();
    expect(posts).toEqual([]);
  });
});

describe("RunPod daily cost", () => {
  const billing = (records: unknown) => vi.fn(async () => new Response(JSON.stringify({ records }), { status: 200 }));
  const env = { TAVONEL_RUNPOD_DAILY_COST_CAP_USD: "25", TAVONEL_RUNPOD_API_KEY: "rp-test" };

  it("says it is unconfigured rather than checking a budget nobody set", async () => {
    const fetcher = vi.fn();
    expect(await checkRunPodDailyCost(NOW, {}, fetcher)).toEqual({ check: "runpod_daily_cost", code: "RUNPOD_COST_CAP_UNCONFIGURED" });
    expect(await checkRunPodDailyCost(NOW, { TAVONEL_RUNPOD_DAILY_COST_CAP_USD: "25" }, fetcher)).toMatchObject({ code: "RUNPOD_BILLING_NOT_CONFIGURED" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("is within the cap at or below it, and reads only today's bucket", async () => {
    const fetcher = billing([{ startTime: "2026-11-03T00:00:00Z", totalAmount: 500 }, { startTime: "2026-11-04T00:00:00Z", totalAmount: 25 }]);
    expect(await checkRunPodDailyCost(NOW, env, fetcher)).toMatchObject({ code: "RUNPOD_COST_WITHIN_CAP" });
    expect(String((fetcher.mock.calls[0] as unknown as [string])[0])).toBe("https://api.runpod.io/v2/billing?bucketSize=day&lastN=2");
    expect((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toEqual({ Authorization: "Bearer rp-test" });
  });

  it("pages a cost alert over the cap, critical at 120%", async () => {
    expect(await checkRunPodDailyCost(NOW, env, billing([{ startTime: "2026-11-04T00:00:00Z", totalAmount: 26.5 }])))
      .toEqual({ check: "runpod_daily_cost", code: "RUNPOD_COST_CAP_EXCEEDED", delivery: "ALERT_DELIVERED" });
    expect(posts[0]).toMatchObject({ kind: "cost", service: "runpod", unit: "usd", currentValue: 26.5, thresholdValue: 25, severity: "warning" });
    resetOperationsAlertDelivery();
    await checkRunPodDailyCost(NOW, env, billing([{ startTime: "2026-11-04T00:00:00Z", totalAmount: 30 }]));
    expect(posts[1]).toMatchObject({ severity: "critical" });
  });

  it("picks the day bucket by the instant it covers, not by a date prefix", async () => {
    // A bucket that starts at 15:00 UTC (another time zone's midnight) holds 09:00 UTC today.
    expect(await checkRunPodDailyCost(NOW, env, billing([
      { startTime: "2026-11-02T15:00:00Z", totalAmount: 400 },
      { startTime: "2026-11-03T15:00:00Z", totalAmount: 26 },
    ]))).toMatchObject({ code: "RUNPOD_COST_CAP_EXCEEDED", delivery: "ALERT_DELIVERED" });
    expect(posts[0]).toMatchObject({ currentValue: 26 });
    expect(String(posts[0]!.summary)).toContain("2026-11-03T15:00:00.000Z");
    // No bucket holding now is no spend yet today, not yesterday's.
    expect(await checkRunPodDailyCost(NOW, env, billing([{ startTime: "2026-11-02T00:00:00Z", totalAmount: 400 }])))
      .toMatchObject({ code: "RUNPOD_COST_WITHIN_CAP" });
  });

  it("pages once a day, from the 00 UTC slot, when a cap is set but the billing cannot be read", async () => {
    const midnight = Date.parse("2026-11-04T00:00:00Z");
    for (const [label, fetcher, environment] of [
      ["401", vi.fn(async () => new Response("no", { status: 401 })), env],
      ["no key", vi.fn(), { TAVONEL_RUNPOD_DAILY_COST_CAP_USD: "25" }],
    ] as const) {
      resetOperationsAlertDelivery();
      posts = [];
      expect(await checkRunPodDailyCost(midnight, environment, fetcher as unknown as typeof fetch), label).toMatchObject({ delivery: "ALERT_DELIVERED" });
      expect(posts, label).toHaveLength(1);
      expect(posts[0], label).toMatchObject({ kind: "incident", severity: "warning", service: "runpod" });
      // The other 23 hourly slots of the day report it and page nobody.
      expect(await checkRunPodDailyCost(midnight + 3_600_000, environment, fetcher as unknown as typeof fetch), label).not.toHaveProperty("delivery");
      expect(posts, label).toHaveLength(1);
    }
  });

  it("fails visibly on an unreadable answer and never pages on one outside the daily slot", async () => {
    for (const fetcher of [
      vi.fn(async () => new Response("no", { status: 401 })),
      vi.fn(async () => { throw new Error("down"); }),
      billing("not-an-array"),
      billing([{ startTime: "2026-11-04T00:00:00Z", totalAmount: "26" }]),
    ]) {
      expect(await checkRunPodDailyCost(NOW, env, fetcher as unknown as typeof fetch)).toMatchObject({ code: "RUNPOD_BILLING_UNREADABLE" });
    }
    expect(posts).toEqual([]);
  });
});

describe("daily OCR spend stop (GA gap 2)", () => {
  const billing = (totalAmount: unknown) => vi.fn(async () =>
    new Response(JSON.stringify({ records: [{ startTime: "2026-11-04T00:00:00Z", totalAmount }] }), { status: 200 }));
  const env = { TAVONEL_RUNPOD_DAILY_HARD_STOP_USD: "40", TAVONEL_RUNPOD_API_KEY: "rp-test" };
  beforeEach(() => resetOcrSpendStopCache());

  it("admits and reads nothing when no stop is set, keeping today's alert-only behaviour", async () => {
    const fetcher = vi.fn();
    for (const value of [undefined, "", "0", "-5", "forty"]) {
      expect(await ocrSpendStop(NOW, { TAVONEL_RUNPOD_DAILY_HARD_STOP_USD: value, TAVONEL_RUNPOD_API_KEY: "rp-test" }, fetcher), String(value)).toBeNull();
    }
    expect(fetcher).not.toHaveBeenCalled();
    expect(posts).toEqual([]);
  });

  it("admits below the stop without paging", async () => {
    expect(await ocrSpendStop(NOW, env, billing(39.99))).toBeNull();
    expect(posts).toEqual([]);
  });

  it("refuses at the stop with a named code and one critical cost page per billing day", async () => {
    expect(await ocrSpendStop(NOW, env, billing(40))).toBe("OCR_DAILY_SPEND_STOP");
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ kind: "cost", severity: "critical", service: "runpod", unit: "usd", currentValue: 40, thresholdValue: 40 });
    expect(String(posts[0]!.summary)).toContain("OCR_DAILY_SPEND_STOP");
    expect(JSON.stringify(posts[0])).not.toContain("rp-test");
    // The next refusal on this instance inside the dedupe window does not page again.
    expect(await ocrSpendStop(NOW + 1_000, env, billing(41))).toBe("OCR_DAILY_SPEND_STOP");
    expect(posts).toHaveLength(1);
  });

  it("fails closed when the stop is set and spend cannot be measured", async () => {
    for (const [label, fetcher, environment] of [
      ["no key", vi.fn(), { TAVONEL_RUNPOD_DAILY_HARD_STOP_USD: "40" }],
      ["401", vi.fn(async () => new Response("no", { status: 401 })), env],
      ["throws", vi.fn(async () => { throw new Error("down"); }), env],
      ["not a number", billing("40"), env],
    ] as const) {
      resetOcrSpendStopCache();
      resetOperationsAlertDelivery();
      posts = [];
      expect(await ocrSpendStop(NOW, environment, fetcher as unknown as typeof fetch), label).toBe("OCR_SPEND_UNVERIFIED");
      expect(posts, label).toHaveLength(1);
      expect(posts[0], label).toMatchObject({ kind: "incident", severity: "critical", service: "runpod" });
    }
  });

  it("reads RunPod's billing at most once a minute per instance, then reads again", async () => {
    const fetcher = billing(10);
    expect(await ocrSpendStop(NOW, env, fetcher)).toBeNull();
    expect(await ocrSpendStop(NOW + 59_999, env, billing(99))).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await ocrSpendStop(NOW + 60_000, env, billing(99))).toBe("OCR_DAILY_SPEND_STOP");
  });

  it("lifts when RunPod's next billing day opens", async () => {
    expect(await ocrSpendStop(NOW, env, billing(50))).toBe("OCR_DAILY_SPEND_STOP");
    resetOcrSpendStopCache();
    // Only yesterday's bucket: nothing is spent yet in the day that holds now.
    expect(await ocrSpendStop(NOW + 86_400_000, env, billing(50))).toBeNull();
  });
});

describe("release row expiry", () => {
  const env = { VERCEL_GIT_COMMIT_SHA: SHA };
  const row = (daysOld: number, extra: Record<string, unknown> = {}) => {
    store.request.mockResolvedValueOnce(new Response(JSON.stringify([{
      allowed: true, stage: "production", evaluated_at: new Date(NOW - daysOld * 86_400_000).toISOString(), ...extra,
    }]), { status: 200 }));
  };

  it("is current with more than seven days left, and pages inside the last seven", async () => {
    row(22);
    expect(await checkReleaseRowExpiry(NOW, env)).toMatchObject({ code: "RELEASE_ROW_CURRENT" });
    row(24);
    expect(await checkReleaseRowExpiry(NOW, env)).toMatchObject({ code: "RELEASE_ROW_EXPIRING", delivery: "ALERT_DELIVERED" });
    expect(posts[0]).toMatchObject({ severity: "warning" });
    expect(String(posts[0]!.summary)).toContain(SHA.slice(0, 12));
    expect(String(store.request.mock.calls[0]![0])).toContain("/rest/v1/customer_data_release_decisions?");
  });

  it("pages critical once it has lapsed", async () => {
    row(31);
    expect(await checkReleaseRowExpiry(NOW, env)).toMatchObject({ code: "RELEASE_ROW_LAPSED", delivery: "ALERT_DELIVERED" });
    expect(posts[0]).toMatchObject({ severity: "critical" });
  });

  it("leaves a refusal, a qualification or no row to the release runbook, and says why it did not check", async () => {
    row(29, { allowed: false });
    expect(await checkReleaseRowExpiry(NOW, env)).toMatchObject({ code: "RELEASE_ROW_NOT_APPLICABLE" });
    row(29, { stage: "qualification" });
    expect(await checkReleaseRowExpiry(NOW, env)).toMatchObject({ code: "RELEASE_ROW_NOT_APPLICABLE" });
    store.request.mockResolvedValueOnce(new Response("[]", { status: 200 }));
    expect(await checkReleaseRowExpiry(NOW, env)).toMatchObject({ code: "RELEASE_ROW_NOT_APPLICABLE" });
    expect(await checkReleaseRowExpiry(NOW, {})).toMatchObject({ code: "RELEASE_REVISION_UNKNOWN" });
    expect(await checkReleaseRowExpiry(NOW, { ...env, TEST_STORE: "off" })).toMatchObject({ code: "RELEASE_STORE_NOT_CONFIGURED" });
    store.request.mockResolvedValueOnce(new Response("{}", { status: 500 }));
    expect(await checkReleaseRowExpiry(NOW, env)).toMatchObject({ code: "RELEASE_STORE_UNREADABLE" });
    expect(posts).toEqual([]);
  });

  it("pages a warning from its daily slot when it cannot read the row or does not know its revision", async () => {
    const midnight = Date.parse("2026-11-04T00:00:00Z");
    store.request.mockResolvedValueOnce(new Response("{}", { status: 500 }));
    expect(await checkReleaseRowExpiry(midnight, env)).toMatchObject({ code: "RELEASE_STORE_UNREADABLE", delivery: "ALERT_DELIVERED" });
    expect(await checkReleaseRowExpiry(midnight, {})).toMatchObject({ code: "RELEASE_REVISION_UNKNOWN", delivery: "ALERT_DELIVERED" });
    expect(posts.map((post) => [post.severity, post.service])).toEqual([["warning", "web"], ["warning", "web"]]);
  });
});

describe("scheduled cadence", () => {
  it("runs cost hourly and expiry daily at 00 UTC, from the five-minute SLI slot", async () => {
    const at = (iso: string) => runScheduledOperationsChecks(new Date(iso), {}, vi.fn());
    expect((await at("2026-11-04T00:00:00Z")).map((entry) => entry.check)).toEqual(["runpod_daily_cost", "release_row_expiry"]);
    expect((await at("2026-11-04T03:00:00Z")).map((entry) => entry.check)).toEqual(["runpod_daily_cost"]);
    expect(await at("2026-11-04T03:05:00Z")).toEqual([]);
  });
});

describe("with no receiver configured", () => {
  it("every producer reports the unconfigured state and none of them throws", async () => {
    vi.stubEnv("OPERATIONS_ALERT_WEBHOOK_URL", "");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const [result] = await alertCompileJobTurn(JOB, { note: "failed", errorCode: "X_FAILED", deadLettered: true, blocked: [] }, NOW);
    expect(result).toMatchObject({ ok: false, code: "ALERT_RECEIVER_UNCONFIGURED" });
    expect(await alertOcrFailure({ workspaceKey: "pilot-ops01", documentId: DOC, reasonCode: "OCR_RESPONSE_INVALID" }, NOW))
      .toMatchObject({ code: "ALERT_RECEIVER_UNCONFIGURED" });
    expect(operationsAlertCounters()).toMatchObject({ unconfigured: 2, delivered: 0 });
    expect(posts).toEqual([]);
  });
});
