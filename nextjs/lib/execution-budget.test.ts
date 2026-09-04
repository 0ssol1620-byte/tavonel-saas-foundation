import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CORE_CLIENT_TIMEOUT_MS,
  CORE_MAX_LATENCY_MS,
  WORKER_MAX_DURATION_MS,
  WORKER_MAX_DURATION_SECONDS,
  WORKER_SETTLEMENT_RESERVE_MS,
  coreLatencyOutcome,
  executionBudgetViolations,
} from "./execution-budget";
import { buildProductCoreV2Request, dispatchProductCoreV2 } from "./core-runtime-v2";
import type { CollectionOcrInput } from "./collection-compiler";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the execution budget is internally consistent", () => {
  it("holds its own invariant", () => {
    expect(executionBudgetViolations()).toEqual([]);
  });

  it("never promises Core more time than the caller will wait", () => {
    expect(CORE_MAX_LATENCY_MS).toBeLessThanOrEqual(CORE_CLIENT_TIMEOUT_MS);
  });

  it("leaves the worker time to record an outcome after the caller gives up", () => {
    /*
      The failure this prevents: the client timeout and the platform kill landing together, so
      the invocation disappears before anything is written and the lease is held until it
      expires. The reserve is what makes a timeout an event rather than a disappearance.
    */
    expect(WORKER_MAX_DURATION_MS - CORE_CLIENT_TIMEOUT_MS).toBeGreaterThanOrEqual(WORKER_SETTLEMENT_RESERVE_MS);
  });
});

describe("what happens to a Core response by the time it arrives", () => {
  it.each([
    [1_000, "within-budget"],
    [CORE_MAX_LATENCY_MS - 1, "within-budget"],
    [CORE_MAX_LATENCY_MS, "within-budget"],
    [CORE_MAX_LATENCY_MS + 1, "client-timeout"],
    [59_000, "client-timeout"],
    [WORKER_MAX_DURATION_MS - 1, "client-timeout"],
    [61_000, "worker-killed"],
    [89_000, "worker-killed"],
    [90_000, "worker-killed"],
  ])("%ims is %s", (elapsed, expected) => {
    expect(coreLatencyOutcome(elapsed as number)).toBe(expected);
  });

  it("classifies everything the old configuration could not reach", () => {
    /*
      The previous route.maxLatencyMs was 90_000 against a 60s function. Every value between the
      old promise and the wall clock was unreachable: Core was allowed to take it and the caller
      could never see it. Those are now `worker-killed`, which is the honest name for what the
      old numbers described, and the promise no longer extends into that range.
    */
    expect(coreLatencyOutcome(90_000)).toBe("worker-killed");
    expect(CORE_MAX_LATENCY_MS).toBeLessThan(90_000);
  });
});

describe("the budget is declared in one place", () => {
  const source = (path: string) => readFileSync(resolve(import.meta.dirname, path), "utf8");

  it("the worker route declares the same wall clock the budget is derived from", () => {
    /*
      Read out of the source rather than imported, because that is how Next.js reads it: route
      segment config is parsed statically before any module runs, so `maxDuration` cannot be an
      identifier -- the build fails with `Unknown identifier ... at "maxDuration"`. This test is
      what keeps the literal and the constant from moving apart.
    */
    const route = source("../app/api/internal/jobs/run/route.ts");
    const declared = route.match(/export const maxDuration = (\d+);/);
    expect(declared).not.toBeNull();
    expect(Number(declared![1])).toBe(WORKER_MAX_DURATION_SECONDS);
  });

  it("the Core client takes both of its numbers from the budget", () => {
    const core = source("./core-runtime-v2.ts");
    expect(core).toContain("maxLatencyMs: CORE_MAX_LATENCY_MS");
    expect(core).toContain("AbortSignal.timeout(CORE_CLIENT_TIMEOUT_MS)");
    expect(core).not.toContain("maxLatencyMs: 90_000");
    expect(core).not.toContain("AbortSignal.timeout(60_000)");
  });

  it("matches the seconds the platform is given", () => {
    expect(WORKER_MAX_DURATION_MS).toBe(WORKER_MAX_DURATION_SECONDS * 1_000);
  });
});

const ocrInput = (): CollectionOcrInput[] => [{
  documentId: "11111111111111111111111111111111",
  versionKey: "a".repeat(64),
  sourceImmutableKey: "immutable/one",
  ocrJsonKey: "ocr/one.json",
  inputSha256: `sha256:${"1".repeat(64)}`,
  pageCount: 1,
  regions: [],
} as unknown as CollectionOcrInput];

describe("a retry reaches the same compile, not a second one", () => {
  it("keys the compile on the documents, not on the attempt", () => {
    /*
      This assertion is the reverse of the one it replaces, which required two attempts to
      produce two keys. That made every retry a new compile to Core -- a second World and a
      second charge for work the caller had simply failed to collect the answer to.
    */
    const first = buildProductCoreV2Request("pilot", ocrInput(), new Date("2026-09-04T00:00:00Z"), "request-1");
    const second = buildProductCoreV2Request("pilot", ocrInput(), new Date("2026-09-04T00:01:30Z"), "request-2");

    expect(first.idempotencyKey).toBe(second.idempotencyKey);
    // The attempt is still distinguishable; the receipt binds to it.
    expect(first.requestId).not.toBe(second.requestId);
    expect(first.collectionId).toBe(second.collectionId);
  });

  it("gives a different document set a different key", () => {
    const one = buildProductCoreV2Request("pilot", ocrInput(), new Date("2026-09-04T00:00:00Z"), "request-1");
    const other = buildProductCoreV2Request("pilot-two", ocrInput(), new Date("2026-09-04T00:00:00Z"), "request-1");
    expect(one.idempotencyKey).not.toBe(other.idempotencyKey);
  });
});

describe("a timeout is not the same failure as an unreachable Core", () => {
  const env = { url: "https://core.example", hmac: "h".repeat(48) };

  it("reports a client timeout as its own code", async () => {
    vi.stubGlobal("fetch", async () => {
      const error = new Error("The operation was aborted due to timeout");
      error.name = "TimeoutError";
      throw error;
    });
    const result = await dispatchProductCoreV2(env, "pilot", ocrInput());
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe("CORE_V2_TIMEOUT");
  });

  it("still reports a refused connection as unavailable", async () => {
    vi.stubGlobal("fetch", async () => { throw new TypeError("fetch failed"); });
    const result = await dispatchProductCoreV2(env, "pilot", ocrInput());
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe("CORE_V2_UNAVAILABLE");
  });

  it("asks Core for exactly the budget it will be given", async () => {
    let sent: { route?: { maxLatencyMs?: number } } | null = null;
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      throw new TypeError("fetch failed");
    });
    await dispatchProductCoreV2(env, "pilot", ocrInput());
    expect(sent!.route!.maxLatencyMs).toBe(CORE_MAX_LATENCY_MS);
  });
});
