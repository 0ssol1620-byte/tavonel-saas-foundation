import { describe, expect, it, vi } from "vitest";
import { readSourceStages } from "./compile-source-stages";
import { compileJobRestingNotice, drainSseFrames, earlierReviewPackages, frameFromEvent, isCompileJobResting, isCompileJobTerminal, observeCompileJob, pickResumableCompileJob } from "./compile-job-client";
import { COMPILE_STATES } from "./compile-job-store";

/*
  The parser and the resume, tested where they can actually be wrong.

  Neither of the two failures this file guards has ever been visible in a normal run: a frame
  split across a chunk boundary and a reconnect that replays from the wrong cursor both look
  like "the compile finished but the UI didn't notice", intermittently, under load.
*/

function stream(chunks: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[index]));
      index += 1;
    },
  });
}

function eventFrame(sequence: number, state: string, extra: Record<string, unknown> = {}) {
  return `id: ${sequence}\nevent: state_changed\ndata: ${JSON.stringify({
    sequence,
    eventType: "state_changed",
    state,
    documentsTotal: 3,
    documentsReady: sequence,
    errorCode: null,
    detail: { collectionId: null, blocked: [] },
    ...extra,
  })}\n\n`;
}

describe("SSE frame parsing", () => {
  it("keeps a frame that arrives split across two chunks", () => {
    const whole = eventFrame(1, "reading");
    const first = drainSseFrames(whole.slice(0, 20));
    expect(first.frames).toHaveLength(0);
    const second = drainSseFrames(first.rest + whole.slice(20));
    expect(second.frames).toHaveLength(1);
    expect(second.frames[0].id).toBe(1);
  });

  it("ignores keepalive comments without disturbing the cursor", () => {
    const drained = drainSseFrames(`: ping\n\n${eventFrame(7, "structuring")}`);
    expect(drained.frames).toHaveLength(1);
    expect(drained.frames[0].id).toBe(7);
  });

  it("handles CRLF line endings, which a proxy may introduce", () => {
    const drained = drainSseFrames(eventFrame(2, "reading").replace(/\n/g, "\r\n"));
    expect(drained.frames).toHaveLength(1);
    expect(drained.frames[0].event).toBe("state_changed");
  });

  it("rejects a payload that is not an event", () => {
    expect(frameFromEvent({ nope: true })).toBeNull();
    expect(frameFromEvent(null)).toBeNull();
  });

  it("carries a size refusal's numbers and package paths, and nothing else", () => {
    // REVIEW-PR192-R1 MAJOR-2: the detail was dropped, so the panel could show nothing measured.
    const candidate = frameFromEvent({ sequence: 157, state: "structuring", detail: { reason: "JSON_TOO_LARGE", sizeLimit: {
      object: "candidate-world.json", bytes: 134_576_916, bound: 33_554_432,
      largestPackageFiles: [{ path: "rag/chunks.jsonl", sizeBytes: 90_000_000, content: "secret" }, { path: 7, sizeBytes: 1 }],
      validationCounts: { claims: 1_200, contradictions: 719_400, note: "text" },
    } } });
    expect(candidate?.sizeLimit).toEqual({ bytes: 134_576_916, bound: 33_554_432,
      largestPackageFiles: [{ path: "rag/chunks.jsonl", sizeBytes: 90_000_000 }],
      counts: { claims: 1_200, contradictions: 719_400 } });

    // Core's own 422: `counts`, and no package files.
    const core = frameFromEvent({ sequence: 9, state: "structuring", detail: { sizeLimit: {
      object: "core-output", bytes: 52_600_000, bound: 33_554_432, counts: { regions: 3_600, contradictionPairs: 719_400 } } } });
    expect(core?.sizeLimit).toEqual({ bytes: 52_600_000, bound: 33_554_432, largestPackageFiles: [],
      counts: { regions: 3_600, contradictionPairs: 719_400 } });

    // A streamed refusal with no length stays unknown rather than guessed; no size row means null.
    expect(frameFromEvent({ sequence: 3, state: "structuring", detail: { sizeLimit: { bytes: null, bound: 83_886_080 } } })?.sizeLimit)
      .toEqual({ bytes: null, bound: 83_886_080, largestPackageFiles: [], counts: {} });
    expect(frameFromEvent({ sequence: 4, state: "failed", detail: {} })?.sizeLimit).toBeNull();
  });
});

describe("observing a durable compile", () => {
  it("hands a sources frame to the stage store, never to the state view and never as a cursor", async () => {
    const JOB = "cjob-00000000000000000000000000000002";
    const sources = `event: sources\ndata: ${JSON.stringify({ observedAt: "t", stages: [{ documentId: "a", stage: "waking" }] })}\n\n`;
    const malformed = `event: sources\ndata: {"stages":"no"}\n\n`;
    const requested: string[] = [];
    const responses = [stream([eventFrame(1, "reading"), sources, malformed]), stream([eventFrame(2, "ready")])];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      requested.push(String(input));
      return new Response(responses.shift()!, { headers: { "content-type": "text/event-stream" } });
    }) as unknown as typeof fetch;
    const seen: number[] = [];
    await observeCompileJob({ jobId: JOB, authToken: async () => "t", onFrame: (frame) => seen.push(frame.sequence), fetchImpl, sleep: async () => undefined });
    expect(seen).toEqual([1, 2]);
    expect(readSourceStages(JOB)?.stages).toEqual([{ documentId: "a", stage: "waking" }]);
    expect(requested[1]).toContain("after=1");
  });

  it("resumes from the last received sequence when the stream ends early", async () => {
    const requested: string[] = [];
    const responses = [
      stream([eventFrame(1, "uploading"), eventFrame(2, "reading")]),
      stream([eventFrame(3, "ready")]),
    ];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      requested.push(String(input));
      return new Response(responses.shift()!, { headers: { "content-type": "text/event-stream" } });
    }) as unknown as typeof fetch;

    const seen: number[] = [];
    const settled = await observeCompileJob({
      jobId: "cjob-00000000000000000000000000000001",
      authToken: async () => "token",
      onFrame: (frame) => seen.push(frame.sequence),
      fetchImpl,
      sleep: async () => undefined,
    });

    expect(seen).toEqual([1, 2, 3]);
    expect(settled).toBe("ready");
    // The whole point: the second connection asks for what came after 2, not from the top.
    expect(requested[0]).toContain("after=0");
    expect(requested[1]).toContain("after=2");
  });

  it("keeps a terminal state when a later frame in the same stream says otherwise", async () => {
    // cjob-157f2f23: seq 158 `failed`, then seq 159 `structuring` from a duplicate run.
    const fetchImpl = vi.fn(async () => new Response(
      stream([eventFrame(157, "structuring"), eventFrame(158, "failed"), eventFrame(159, "structuring")]),
      { headers: { "content-type": "text/event-stream" } },
    )) as unknown as typeof fetch;
    const seen: string[] = [];
    const settled = await observeCompileJob({
      jobId: "cjob-00000000000000000000000000000001",
      authToken: async () => "token",
      onFrame: (frame) => seen.push(frame.state),
      fetchImpl,
      sleep: async () => undefined,
    });
    expect(seen).toEqual(["structuring", "failed"]);
    expect(settled).toBe("failed");
  });

  it("stops rather than looping when the job is not the caller's", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 404 })) as unknown as typeof fetch;
    const settled = await observeCompileJob({
      jobId: "cjob-00000000000000000000000000000002",
      authToken: async () => "token",
      onFrame: () => { throw new Error("no frame should arrive"); },
      fetchImpl,
      sleep: async () => undefined,
    });
    expect(settled).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("backs off and retries a server error instead of giving up", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call === 1) return new Response("", { status: 503 });
      return new Response(stream([eventFrame(4, "failed")]), { headers: { "content-type": "text/event-stream" } });
    }) as unknown as typeof fetch;

    const slept: number[] = [];
    const settled = await observeCompileJob({
      jobId: "cjob-00000000000000000000000000000003",
      authToken: async () => "token",
      onFrame: () => undefined,
      fetchImpl,
      sleep: async (ms) => { slept.push(ms); },
    });
    expect(settled).toBe("failed");
    expect(slept[0]).toBeGreaterThan(0);
  });

  it("stops when the caller aborts, leaving the compile running on the server", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(async () => {
      controller.abort();
      return new Response(stream([eventFrame(1, "reading")]), { headers: { "content-type": "text/event-stream" } });
    }) as unknown as typeof fetch;

    const settled = await observeCompileJob({
      jobId: "cjob-00000000000000000000000000000004",
      authToken: async () => "token",
      onFrame: () => undefined,
      signal: controller.signal,
      fetchImpl,
      sleep: async () => undefined,
    });
    expect(settled).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("pickResumableCompileJob (no ?job= in the URL)", () => {
  const now = Date.parse("2026-11-09T04:58:06Z");
  const job = (id: string, state: "ready" | "failed" | "reading" | "cancelled", settledAt: string | null = null) => ({ jobId: id, state, settledAt });

  it("shows a failure that just happened over an older stuck job", () => {
    // D0: 749b failed seconds before the reload; 130f had been blocked in reading for five days.
    const jobs = [job("749b", "failed", "2026-11-09T04:57:32Z"), job("130f", "reading")];
    expect(pickResumableCompileJob(jobs, now)?.jobId).toBe("749b");
  });
  it("still shows that failure when the browser clock is behind the server", () => {
    expect(pickResumableCompileJob([job("749b", "failed", "2026-11-09T04:59:00Z"), job("130f", "reading")], now)?.jobId).toBe("749b");
  });
  it("falls back to the first unfinished job when the newest failure is older than 24 h", () => {
    expect(pickResumableCompileJob([job("old", "failed", "2026-11-06T04:00:00Z"), job("130f", "reading")], now)?.jobId).toBe("130f");
  });
  it("takes the newest job when it is still running, and skips ready ones", () => {
    expect(pickResumableCompileJob([job("run", "reading"), job("130f", "reading")], now)?.jobId).toBe("run");
    expect(pickResumableCompileJob([job("done", "ready", "2026-11-09T04:00:00Z"), job("130f", "reading")], now)?.jobId).toBe("130f");
  });
  it("does not resurrect a recent failure that is not the newest job, nor a cancelled one", () => {
    expect(pickResumableCompileJob([job("done", "ready", "2026-11-09T04:58:00Z"), job("749b", "failed", "2026-11-09T04:57:32Z")], now)).toBeUndefined();
    expect(pickResumableCompileJob([job("c", "cancelled", "2026-11-09T04:57:32Z")], now)).toBeUndefined();
    expect(pickResumableCompileJob([job("f", "failed", null)], now)).toBeUndefined();
    expect(pickResumableCompileJob([], now)).toBeUndefined();
  });
});

describe("earlierReviewPackages: no pending review package is hidden (WO-WS-6, F3, founder decision 2026-11-26 row 2)", () => {
  const now = Date.parse("2026-11-26T12:00:00Z");
  type S = "ready" | "review_required" | "reading" | "failed" | "cancelled";
  const job = (jobId: string, state: S, extra: { collectionId?: string | null; corpusId?: string | null; settledAt?: string | null } = {}) =>
    ({ jobId, state, settledAt: "2026-11-26T08:24:00Z", ...extra });

  it("behind a newer ready job the pick is unchanged (the first unfinished job) and every other pending package is listed, newest first", () => {
    const jobs = [job("new", "ready", { collectionId: "collection-n" }), job("old", "review_required", { collectionId: "collection-o" }), job("older", "review_required")];
    const open = pickResumableCompileJob(jobs, now);
    expect(open?.jobId).toBe("old");
    expect(earlierReviewPackages(jobs, open)).toEqual([{ jobId: "older", collectionId: null, href: "/workspace?job=older" }]);
    expect(earlierReviewPackages(jobs, undefined).map((item) => item.jobId)).toEqual(["old", "older"]);
  });
  it("a newer failed job keeps the old package: it is opened or listed, never dropped", () => {
    const jobs = [job("f", "failed", { settledAt: "2026-11-26T11:59:00Z" }), job("old", "review_required", { collectionId: "collection-o" })];
    const open = pickResumableCompileJob(jobs, now);
    expect(open?.jobId).toBe("f");
    expect(earlierReviewPackages(jobs, open)).toEqual([{ jobId: "old", collectionId: "collection-o", href: "/workspace?collection=collection-o" }]);
  });
  it("lists nothing when there is no pending review package, and not the job that was opened", () => {
    const jobs = [job("only", "review_required")];
    expect(earlierReviewPackages(jobs, pickResumableCompileJob(jobs, now))).toEqual([]);
    expect(earlierReviewPackages([job("a", "ready"), job("b", "reading")], undefined)).toEqual([]);
    expect(earlierReviewPackages([], undefined)).toEqual([]);
  });
  it("another corpus stays independent and listed; another part of the opened job's corpus is reached through that corpus", () => {
    const jobs = [job("p2", "review_required", { corpusId: "corpus-a" }), job("p1", "review_required", { corpusId: "corpus-a" }), job("x", "review_required", { corpusId: "corpus-b" })];
    expect(earlierReviewPackages(jobs, jobs[0]).map((item) => item.jobId)).toEqual(["x"]);
  });
  it("encodes what it links to", () => {
    expect(earlierReviewPackages([job("a", "review_required", { collectionId: "c&d=1" })], undefined)[0].href).toBe("/workspace?collection=c%26d%3D1");
  });
});
