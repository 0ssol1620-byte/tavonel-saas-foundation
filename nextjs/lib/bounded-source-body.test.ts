import { describe, expect, it, vi } from "vitest";
import { readBoundedSourceBody } from "./bounded-source-body";

describe("bounded source bytes", () => {
  it("preserves arbitrary binary bytes at the exact limit", async () => {
    const bytes = new Uint8Array([0, 255, 128, 10]);
    expect(await readBoundedSourceBody(new Response(bytes), 4)).toEqual({ ok: true, bytes });
  });
  it.each([null, "1"])("cancels an oversized stream with declared length %s", async length => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(5)); }, cancel }), {
      headers: length === null ? {} : { "content-length": length },
    });
    expect(await readBoundedSourceBody(response, 4)).toEqual({ ok: false, code: "SOURCE_SIZE_UNQUALIFIED" });
    expect(cancel).toHaveBeenCalledOnce();
  });
  it.each(["500", "garbage", "-1"])("refuses declared length %s without reading", async length => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }), { headers: { "content-length": length } });
    expect(await readBoundedSourceBody(response, 4)).toEqual({ ok: false, code: "SOURCE_SIZE_UNQUALIFIED" });
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("returns a retryable download failure when the stream fails", async () => {
    const response = new Response(new ReadableStream({ start(c) { c.error(new Error("connection closed")); } }));
    expect(await readBoundedSourceBody(response, 4)).toEqual({ ok: false, code: "SOURCE_DOWNLOAD_FAILED" });
  });
  it("counts cumulative chunks and stops before the next pull", async () => {
    const cancel = vi.fn();
    let pulls = 0;
    const response = new Response(new ReadableStream({
      pull(c) { pulls += 1; c.enqueue(new Uint8Array([1, 2, 3])); }, cancel,
    }, { highWaterMark: 0 }));
    expect(await readBoundedSourceBody(response, 4)).toEqual({ ok: false, code: "SOURCE_SIZE_UNQUALIFIED" });
    expect(pulls).toBe(2);
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("rejects an empty source", async () => {
    expect(await readBoundedSourceBody(new Response(null), 4)).toEqual({ ok: false, code: "SOURCE_SIZE_UNQUALIFIED" });
  });
});
