import { describe, expect, it, vi } from "vitest";
import { drainSseFrames, frameFromEvent, observeCompileJob } from "./compile-job-client";

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
});

describe("observing a durable compile", () => {
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
