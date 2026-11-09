/*
  O02 — the probe history object. Storage is read back, so it is input: a missing object, a
  corrupt one and an oversized one are three different answers and none of them is "everything is
  fine".
*/
import { afterEach, describe, expect, it, vi } from "vitest";
import type { R2SignerEnv } from "./r2-synthetic-canary";
import { PROBE_RUN_SCHEMA, type ProbeCheck, type ProbeRun } from "./synthetic-probe";
import {
  PROBE_HISTORY_KEY,
  PROBE_HISTORY_LIMIT,
  nextProbeHistory,
  readProbeHistory,
  writeProbeHistory,
  type ProbeHistory,
} from "./synthetic-probe-store";

const signer: R2SignerEnv = {
  accountId: "account",
  bucket: "tavonel-saas-foundation-quarantine",
  accessKeyId: "key",
  secretAccessKey: "secret",
};

const checks: ProbeCheck[] = [
  { name: "cdr", kind: "request", status: "not_probed", latencyMs: null, errorClass: "not_configured" },
  { name: "ocr", kind: "request", status: "not_probed", latencyMs: null, errorClass: "gpu_spend_gate" },
  { name: "coreV2", kind: "request", status: "ok", latencyMs: 150, errorClass: null },
  { name: "r2", kind: "request", status: "ok", latencyMs: 80, errorClass: null },
  { name: "db", kind: "request", status: "ok", latencyMs: 40, errorClass: null },
  { name: "billing", kind: "configuration", status: "ok", latencyMs: null, errorClass: null },
];

function run(startedAt: string, ok = true): ProbeRun {
  return {
    schemaVersion: PROBE_RUN_SCHEMA,
    startedAt,
    durationMs: 300,
    ok,
    checks,
    fixtureE2E: { enabled: false, status: "not_enabled", code: null },
  };
}

function history(runs: ProbeRun[]): ProbeHistory {
  return { schemaVersion: "tavonel.synthetic_probe_history.v1", runs };
}

describe("probe history storage", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("writes under the synthetic prefix and reads the same runs back", async () => {
    // The prefix is the whole reason no migration was needed, and `assertFoundationSyntheticKey`
    // is what keeps a probe out of a customer's quarantine.
    expect(PROBE_HISTORY_KEY.startsWith("synthetic/")).toBe(true);

    let stored = "";
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toContain("synthetic/probe/history.json");
      if (init?.method === "PUT") { stored = String(init.body); return new Response(null, { status: 200 }); }
      return new Response(stored, { status: 200 });
    }));

    const written = await writeProbeHistory(signer, history([run("2026-09-11T01:00:00.000Z")]));
    expect(written).toMatchObject({ ok: true });
    const read = await readProbeHistory(signer);
    expect(read).toEqual({ ok: true, history: history([run("2026-09-11T01:00:00.000Z")]) });
  });

  it("treats a missing object as an empty history, which /status renders as NOT RUN", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    await expect(readProbeHistory(signer)).resolves.toEqual({ ok: true, history: history([]) });
  });

  it.each([
    ["a refused read", async () => new Response(null, { status: 403 }), "PROBE_HISTORY_READ_FAILED"],
    ["a network failure", async () => { throw new Error("ECONNRESET"); }, "PROBE_HISTORY_READ_FAILED"],
    ["something that is not JSON", async () => new Response("<html/>", { status: 200 }), "PROBE_HISTORY_NOT_JSON"],
    ["another schema", async () => new Response(JSON.stringify({ schemaVersion: "other", runs: [] }), { status: 200 }), "PROBE_HISTORY_INVALID"],
  ])("names the refusal on %s instead of returning an empty history", async (_label, handler, code) => {
    vi.stubGlobal("fetch", vi.fn(handler));
    await expect(readProbeHistory(signer)).resolves.toEqual({ ok: false, code });
  });

  it("drops a run that does not validate rather than repairing it into something plausible", async () => {
    const good = run("2026-09-11T01:00:00.000Z");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      schemaVersion: "tavonel.synthetic_probe_history.v1",
      runs: [{ ...good, ok: "yes" }, good],
    }), { status: 200 })));
    await expect(readProbeHistory(signer)).resolves.toEqual({ ok: true, history: history([good]) });
  });

  it("keeps the newest runs first and stops at the cap", () => {
    const older = Array.from({ length: PROBE_HISTORY_LIMIT }, (_, index) =>
      run(new Date(Date.UTC(2026, 8, 11, index)).toISOString()));
    const next = nextProbeHistory(history(older), run("2026-09-11T23:00:00.000Z"));
    expect(next.runs).toHaveLength(PROBE_HISTORY_LIMIT);
    expect(next.runs[0].startedAt).toBe("2026-09-11T23:00:00.000Z");
    // The one that fell off the end is the oldest, not an arbitrary one.
    expect(next.runs.at(-1)!.startedAt).toBe(older.at(-2)!.startedAt);
  });

  describe("signing clock", () => {
    // R2 refuses a query-signed URL once X-Amz-Date + X-Amz-Expires is in the past; this stub
    // applies the same rule against the (fake) clock at the moment the request arrives.
    function r2WithExpiry(advanceBeforeArrivalMs = 0) {
      return vi.fn(async (input: RequestInfo | URL) => {
        vi.advanceTimersByTime(advanceBeforeArrivalMs);
        const url = new URL(String(input));
        const stamp = url.searchParams.get("X-Amz-Date")!;
        const signedAt = Date.parse(`${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13)}`);
        const expiresMs = Number(url.searchParams.get("X-Amz-Expires")) * 1_000;
        if (Date.now() > signedAt + expiresMs) return new Response("<Error>expired</Error>", { status: 403 });
        return new Response(JSON.stringify(history([run("2026-11-09T10:20:00.600Z")])), { status: 200 });
      });
    }
    afterEach(() => { vi.useRealTimers(); });

    it("signs at the real clock, so the alert cron 70 s after its slot still reads the history", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-11-09T10:21:10.000Z"));
      const fetch = r2WithExpiry();
      vi.stubGlobal("fetch", fetch);
      await expect(readProbeHistory(signer)).resolves.toEqual({
        ok: true, history: history([run("2026-11-09T10:20:00.600Z")]),
      });
      expect(new URL(String(fetch.mock.calls[0][0])).searchParams.get("X-Amz-Date")).toBe("20261109T102110Z");
    });

    it("still names a refused read when the signed URL has really expired", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-11-09T10:21:10.000Z"));
      vi.stubGlobal("fetch", r2WithExpiry(61_000));
      await expect(readProbeHistory(signer)).resolves.toEqual({ ok: false, code: "PROBE_HISTORY_READ_FAILED" });
    });
  });

  it("refuses a bucket that is not the Foundation bucket, in both directions", async () => {
    const wrong = { ...signer, bucket: "someone-elses-bucket" };
    await expect(readProbeHistory(wrong)).resolves.toEqual({ ok: false, code: "BUCKET_NOT_FOUNDATION" });
    await expect(writeProbeHistory(wrong, history([]))).resolves.toEqual({ ok: false, code: "BUCKET_NOT_FOUNDATION" });
  });

  it("reports a failed write rather than reporting the run as recorded", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 500 })));
    await expect(writeProbeHistory(signer, history([run("2026-09-11T01:00:00.000Z")])))
      .resolves.toEqual({ ok: false, code: "PROBE_HISTORY_WRITE_FAILED" });
  });
});
