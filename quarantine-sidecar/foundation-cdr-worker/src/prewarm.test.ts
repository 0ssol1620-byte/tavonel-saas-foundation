import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { handleQueue } from "./index";
import { PREWARM_WINDOW_MS, prewarmCounts, prewarmServices, resetPrewarmState, type PrewarmEnv } from "./prewarm";

const KEY = "quarantine/ws_a/doc_1/source";
const SECRET = "runpod-key-that-must-never-be-logged";
const HEALTH = "https://tavonel-cdr-synthetic-317850201666.asia-northeast3.run.app/health";
const OCR = "https://abc123.api.runpod.ai/v1/ocr";

const ON: PrewarmEnv = { TAVONEL_CDR_PREWARM: "1", TAVONEL_CDR_HEALTH_URL: HEALTH, FOUNDATION_OCR_URL: OCR, RUNPOD_API_KEY: SECRET };

type Call = { url: string; headers: Record<string, string> };
function recorder(answer: (url: string) => Response | Promise<Response> = () => new Response(null, { status: 200 })) {
  const calls: Call[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), headers: { ...(init?.headers as Record<string, string> | undefined) } });
    return answer(String(input));
  }) as typeof fetch;
  return { calls, fetcher };
}

describe("prewarm", () => {
  beforeEach(() => resetPrewarmState());

  it("is off unless the flag is exactly 1, and then makes no request at all", async () => {
    for (const value of [undefined, "", "0", "true", "yes", " 1", "1 ", "01"]) {
      const { calls, fetcher } = recorder();
      await prewarmServices({ ...ON, TAVONEL_CDR_PREWARM: value }, KEY, fetcher);
      assert.equal(calls.length, 0, `flag ${JSON.stringify(value)} stays off`);
    }
    assert.deepEqual({ ...prewarmCounts }, { fired: 0, answered: 0, failed: 0, throttled: 0 });
  });

  it("asks the CDR health route and the OCR ping, with the RunPod key, and counts both", async () => {
    const { calls, fetcher } = recorder(url => new Response(null, { status: url.endsWith("/ping") ? 204 : 200 }));
    await prewarmServices(ON, KEY, fetcher);
    assert.deepEqual(calls.map(c => c.url).sort(), [HEALTH, "https://abc123.api.runpod.ai/ping"].sort());
    const ocr = calls.find(c => c.url.endsWith("/ping"))!;
    assert.equal(ocr.headers.Authorization, `Bearer ${SECRET}`);
    assert.deepEqual({ ...prewarmCounts }, { fired: 2, answered: 2, failed: 0, throttled: 0 });
  });

  it("swallows every failure, counts it, and logs no secret", async () => {
    const logged: string[] = [];
    const realLog = console.log;
    console.log = (...args: unknown[]) => { logged.push(args.map(String).join(" ")); };
    try {
      const { fetcher } = recorder(() => { throw new Error(`boom ${SECRET}`); });
      await assert.doesNotReject(prewarmServices(ON, KEY, fetcher));
      const rejected = recorder(() => Promise.reject(new Error("network")));
      resetPrewarmState();
      await assert.doesNotReject(prewarmServices(ON, KEY, rejected.fetcher));
      assert.equal(prewarmCounts.failed, 2);
      resetPrewarmState();
      await prewarmServices(ON, KEY, recorder(() => new Response("no", { status: 503 })).fetcher);
      assert.equal(prewarmCounts.failed, 2, "a 503 is a failed warm-up, not an error");
    } finally { console.log = realLog; }
    assert.ok(logged.length > 0);
    assert.ok(logged.every(line => !line.includes(SECRET) && !line.includes("runpod.ai") && !line.includes("run.app")), "no key and no URL is logged");
  });

  it("warms a workspace at most once per 60 s", async () => {
    const { calls, fetcher } = recorder();
    await prewarmServices(ON, KEY, fetcher, 1_000_000);
    await prewarmServices(ON, "quarantine/ws_a/doc_2/source", fetcher, 1_000_000 + PREWARM_WINDOW_MS - 1);
    assert.equal(calls.length, 2, "the second source inside the window sent nothing");
    assert.equal(prewarmCounts.throttled, 1);
    await prewarmServices(ON, "quarantine/ws_b/doc_1/source", fetcher, 1_000_000 + 10);
    assert.equal(calls.length, 4, "another workspace has its own window");
    await prewarmServices(ON, KEY, fetcher, 1_000_000 + PREWARM_WINDOW_MS);
    assert.equal(calls.length, 6, "the window reopens at 60 s");
  });

  it("ignores a key that is not a customer source, and skips an unset OCR URL", async () => {
    const { calls, fetcher } = recorder();
    await prewarmServices(ON, "something/else", fetcher);
    assert.equal(calls.length, 0);
    await prewarmServices({ ...ON, FOUNDATION_OCR_URL: undefined }, KEY, fetcher);
    assert.deepEqual(calls.map(c => c.url), [HEALTH]);
  });

  it("never delays or fails the queue handler, and fires on the first delivery only", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const seen: string[] = [];
    const fetcher = (async (input: RequestInfo | URL) => {
      const url = String(input);
      seen.push(url);
      if (url === HEALTH || url.endsWith("/ping")) { await gate; throw new Error("warm-up down"); }
      return new Response("not a customer source", { status: 500 });
    }) as typeof fetch;
    const acks: number[] = [];
    const retries: number[] = [];
    const pending: Promise<unknown>[] = [];
    const message = (attempts: number) => ({ attempts, body: { object: { key: "ignored/not-a-source" } },
      ack: () => acks.push(attempts), retry: () => retries.push(attempts) });
    // A non-source key is acknowledged before any warm-up: nothing is sent for it.
    await handleQueue({ messages: [message(1)] } as never, ON as never, fetcher, p => pending.push(p));
    assert.equal(seen.length, 0);
    assert.deepEqual(acks, [1]);

    // A real source key: the handler returns while the warm-up is still blocked.
    const source = (attempts: number) => ({ attempts, body: { object: { key: KEY } },
      ack: () => acks.push(attempts), retry: () => retries.push(attempts) });
    const env = { ...ON, FOUNDATION_QUARANTINE: { get: async () => null, put: async () => undefined, list: async () => ({ objects: [] }) } };
    const done = handleQueue({ messages: [source(1)] } as never, env as never, fetcher, p => pending.push(p));
    await done; // resolves although the warm-up fetches are gated
    assert.equal(pending.length, 1, "the warm-up was handed to waitUntil, not awaited");
    assert.ok(seen.includes(HEALTH));
    release();
    await Promise.all(pending);
    assert.equal(prewarmCounts.failed, 2);

    resetPrewarmState();
    seen.length = 0;
    await handleQueue({ messages: [source(2)] } as never, env as never, fetcher, p => pending.push(p));
    assert.equal(seen.filter(u => u === HEALTH || u.endsWith("/ping")).length, 0, "a redelivery does not warm again");
  });
});
