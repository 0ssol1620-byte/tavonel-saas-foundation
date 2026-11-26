import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { evaluateHealth } from "./guards";
import { handleQueue, handleRequest } from "./index";
import { IDENTITY_BROKER, PRIVATE_CDR_ORIGIN } from "./identity";
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

describe("prewarm authentication", () => {
  beforeEach(() => resetPrewarmState());

  const SECRET_HMAC = "foundation-cdr-hmac-fixture-secret-ok";
  const TOKEN = "fixture.identity.signature";
  const PRIVATE_HEALTH = `${PRIVATE_CDR_ORIGIN}/health`;
  const PRIVATE_ON: PrewarmEnv = { TAVONEL_CDR_PREWARM: "1", TAVONEL_CDR_HEALTH_URL: PRIVATE_HEALTH, FOUNDATION_CDR_IDENTITY_HMAC: SECRET_HMAC };

  type Seen = { url: string; method: string | undefined; redirect: RequestRedirect | undefined; headers: Headers };
  function broker(answerBroker: () => Response = () => Response.json({ audience: PRIVATE_CDR_ORIGIN, token: TOKEN })) {
    const seen: Seen[] = [];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      seen.push({ url, method: init?.method, redirect: init?.redirect, headers: new Headers(init?.headers) });
      return url === IDENTITY_BROKER ? answerBroker() : new Response(null, { status: 200 });
    }) as typeof fetch;
    return { seen, fetcher };
  }

  it("asks the private CDR health route exactly as the health check does: broker first, then the same Bearer token", async () => {
    const warm = broker();
    await prewarmServices(PRIVATE_ON, KEY, warm.fetcher);

    const check = broker();
    const verdict = await evaluateHealth({
      TAVONEL_CDR_HMAC: SECRET_HMAC, TAVONEL_CDR_URL: `${PRIVATE_CDR_ORIGIN}/v1/disarm`, TAVONEL_CDR_HEALTH_URL: PRIVATE_HEALTH,
      TAVONEL_CDR_PROVIDER: "tavonel_pdfium_clamav_v1", FOUNDATION_R2_BUCKET: "tavonel-saas-foundation-quarantine",
      FOUNDATION_CDR_IDENTITY_HMAC: SECRET_HMAC,
    }, check.fetcher);
    assert.equal(verdict.httpStatus, 200);

    assert.deepEqual(warm.seen.map(s => s.url), [IDENTITY_BROKER, PRIVATE_HEALTH]);
    assert.deepEqual(warm.seen.map(s => s.url), check.seen.map(s => s.url), "same calls, same order, as the health check");
    const [brokerCall, healthCall] = warm.seen;
    assert.equal(brokerCall.method, "POST");
    for (const name of ["x-tavonel-identity-timestamp", "x-tavonel-identity-request-id", "x-tavonel-identity-signature"]) {
      assert.ok(brokerCall.headers.get(name), `broker call carries ${name}`);
    }
    assert.equal(healthCall.headers.get("authorization"), `Bearer ${TOKEN}`);
    assert.equal(healthCall.headers.get("authorization"), check.seen[1].headers.get("authorization"));
    assert.equal(healthCall.redirect, "manual");
    assert.equal(healthCall.redirect, check.seen[1].redirect);
    assert.deepEqual({ ...prewarmCounts }, { fired: 1, answered: 1, failed: 0, throttled: 0 });
  });

  it("never sends an unauthenticated request to the private CDR: no identity secret, a short one, or a refusing broker means no health call", async () => {
    for (const secret of [undefined, "", "too-short"]) {
      resetPrewarmState();
      const warm = broker();
      await prewarmServices({ ...PRIVATE_ON, FOUNDATION_CDR_IDENTITY_HMAC: secret }, KEY, warm.fetcher);
      assert.deepEqual(warm.seen, [], `secret ${JSON.stringify(secret)}: nothing is sent at all`);
      assert.deepEqual({ ...prewarmCounts }, { fired: 1, answered: 0, failed: 1, throttled: 0 });
    }
    resetPrewarmState();
    const refused = broker(() => new Response("no", { status: 401 }));
    await prewarmServices(PRIVATE_ON, KEY, refused.fetcher);
    assert.deepEqual(refused.seen.map(s => s.url), [IDENTITY_BROKER], "the broker was asked and refused; the CDR was never contacted");
    assert.deepEqual({ ...prewarmCounts }, { fired: 1, answered: 0, failed: 1, throttled: 0 });
  });

  it("logs which identity step failed, and nothing that identifies a token, key or URL", async () => {
    const logged: string[] = [];
    const realLog = console.log;
    console.log = (...args: unknown[]) => { logged.push(args.map(String).join(" ")); };
    try {
      await prewarmServices(PRIVATE_ON, KEY, broker(() => new Response("no", { status: 401 })).fetcher);
    } finally { console.log = realLog; }
    assert.equal(logged.length, 1);
    assert.deepEqual(JSON.parse(logged[0]), { log: "prewarm", target: "cdr", outcome: "failed", status: null, stage: "response" });
  });

  it("keeps the two credentials apart: the identity token never reaches RunPod and the RunPod key never reaches the CDR", async () => {
    const warm = broker();
    await prewarmServices({ ...PRIVATE_ON, FOUNDATION_OCR_URL: OCR, RUNPOD_API_KEY: SECRET }, KEY, warm.fetcher);
    const cdr = warm.seen.find(s => s.url === PRIVATE_HEALTH)!;
    const ocr = warm.seen.find(s => s.url.endsWith("/ping"))!;
    assert.equal(cdr.headers.get("authorization"), `Bearer ${TOKEN}`);
    assert.equal(ocr.headers.get("authorization"), `Bearer ${SECRET}`);
    assert.ok(!(cdr.headers.get("authorization") ?? "").includes(SECRET), "the RunPod key is not sent to the CDR");
    assert.ok(!(ocr.headers.get("authorization") ?? "").includes(TOKEN), "the identity token is not sent to RunPod");
  });

  it("cannot be started over HTTP: no request to the worker's fetch handler reaches the warm-up or any outbound call", async () => {
    const warm = broker();
    const env = { ...PRIVATE_ON, FOUNDATION_MANUAL_TRIGGER_TOKEN: "manual-trigger-fixture-token-value", FOUNDATION_OCR_URL: OCR, RUNPOD_API_KEY: SECRET };
    const requests: Array<[string, string]> = [
      ["GET", "/"], ["GET", "/prewarm"], ["POST", "/prewarm"], ["POST", "/v1/prewarm"], ["GET", "/ping"],
      ["GET", "/health"], ["POST", "/v1/sanitize"], ["POST", "/queue"],
    ];
    for (const [method, path] of requests) {
      const response = await handleRequest(new Request(`https://worker.test${path}`, { method, body: method === "POST" ? "{}" : undefined }), env as never, warm.fetcher);
      assert.ok([401, 404, 405].includes(response.status), `${method} ${path} -> ${response.status}`);
    }
    assert.deepEqual(warm.seen, [], "an unauthenticated request caused no outbound call, so no warm-up and no broker claim");
    assert.deepEqual({ ...prewarmCounts }, { fired: 0, answered: 0, failed: 0, throttled: 0 });
  });
});
