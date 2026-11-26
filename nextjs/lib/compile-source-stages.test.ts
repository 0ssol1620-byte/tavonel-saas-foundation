import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompileSourceStages } from "@/components/compile-source-stages";
import {
  clearSourceStages, createSourceStagesPoller, deriveSourceStages, freshSourceStages, parseSourceStages, publishSourceStages,
  readSourceStages, SOURCES_STALE_MS, WAKE_WINDOW_MS, type SourceStagesPayload,
} from "./compile-source-stages";

const NOW = Date.parse("2026-11-26T10:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const doc = (documentId: string, over: Record<string, unknown> = {}) => ({
  documentId, sanitizedKey: `immutable/ws/${documentId}/${"a".repeat(32)}/sanitized.pdf`, sanitizedObservedAt: ago(5_000),
  hasOcrJson: false, processingState: "sanitized" as const, ...over,
});
const stageOf = (stages: ReturnType<typeof deriveSourceStages>, id: string) => stages.find(s => s.documentId === id)?.stage;

beforeEach(() => clearSourceStages());

describe("deriveSourceStages", () => {
  it("names every stage from the objects that exist", () => {
    const stages = deriveSourceStages(["a", "b", "c", "d", "e"], [
      doc("b"), doc("c", { hasOcrJson: true, processingState: "ocr_ready" }),
      doc("d", { processingState: "operator_review" }),
    ], [{ documentId: "e" }], NOW);
    // a: nothing durable. b: sanitized, but c already produced a result so the reader is awake.
    expect(stageOf(stages, "a")).toBe("queued");
    expect(stageOf(stages, "b")).toBe("reading");
    expect(stageOf(stages, "c")).toBe("ready");
    expect(stageOf(stages, "d")).toBe("attention");
    expect(stageOf(stages, "e")).toBe("attention");
  });

  it("calls the reader waking up only while no source has a result and the sanitized PDF is young", () => {
    const young = deriveSourceStages(["a"], [doc("a")], [], NOW);
    expect(stageOf(young, "a")).toBe("waking");
    const old = deriveSourceStages(["a"], [doc("a", { sanitizedObservedAt: ago(WAKE_WINDOW_MS) })], [], NOW);
    expect(stageOf(old, "a")).toBe("reading");
    const noTime = deriveSourceStages(["a"], [doc("a", { sanitizedObservedAt: null })], [], NOW);
    expect(stageOf(noTime, "a")).toBe("reading");
    const clockAhead = deriveSourceStages(["a"], [doc("a", { sanitizedObservedAt: ago(-10_000) })], [], NOW);
    expect(stageOf(clockAhead, "a")).toBe("reading");
  });

  it("never reports a source that is not in the job, and bounds the list", () => {
    const ids = Array.from({ length: 600 }, (_, i) => `d${i}`);
    expect(deriveSourceStages(ids, [doc("stranger")], [], NOW)).toHaveLength(500);
    expect(deriveSourceStages(["a"], [doc("stranger")], [], NOW)).toEqual([{ documentId: "a", stage: "queued" }]);
  });
});

describe("parseSourceStages", () => {
  it("accepts a bounded list of known stages and refuses everything else", () => {
    expect(parseSourceStages({ observedAt: "x", stages: [{ documentId: "a", stage: "waking" }] })).not.toBeNull();
    for (const bad of [null, "s", {}, { observedAt: 1, stages: [] }, { observedAt: "x", stages: "no" },
      { observedAt: "x", stages: [{ documentId: "a", stage: "exploded" }] },
      { observedAt: "x", stages: [{ documentId: 7, stage: "ready" }] },
      { observedAt: "x", stages: [null] },
      { observedAt: "x", stages: Array.from({ length: 501 }, () => ({ documentId: "a", stage: "ready" })) }]) {
      expect(parseSourceStages(bad)).toBeNull();
    }
  });

  it("publishes only what parses", () => {
    publishSourceStages("job", { observedAt: "x", stages: [{ documentId: "a", stage: "bogus" }] });
    expect(readSourceStages("job")).toBeNull();
    publishSourceStages("job", { observedAt: "x", stages: [{ documentId: "a", stage: "reading" }] });
    expect(readSourceStages("job")?.stages).toEqual([{ documentId: "a", stage: "reading" }]);
  });
});

describe("CompileSourceStages", () => {
  const render = (state: "reading" | "structuring", blockedIds: string[] = []) =>
    renderToStaticMarkup(createElement(CompileSourceStages, { jobId: "job", state, names: { a: "Contract.docx" }, blockedIds }));

  it("renders nothing before a frame arrives, and nothing once reading is over", () => {
    expect(render("reading")).toBe("");
    publishSourceStages("job", { observedAt: "x", stages: [{ documentId: "a", stage: "ready" }] });
    expect(render("structuring")).toBe("");
  });

  it("words the first step as what is known, with a typical time and no alarm", () => {
    publishSourceStages("job", { observedAt: "x", stages: [{ documentId: "a", stage: "waking" }, { documentId: "b", stage: "queued" }] });
    const html = render("reading");
    expect(html).toContain("Contract.docx");
    expect(html).toContain("Handed to the reader");
    expect(html).not.toContain("waking up");
    expect(html).toContain("Waiting to be converted");
    expect(html).toContain("typically takes about 30 to 40 seconds");
    expect(html).not.toMatch(/role="alert"|error|failed|problem/i);
    expect(html).not.toContain("estimate");
  });

  it("shows a source the panel knows is blocked as needing a decision, unless it already read", () => {
    publishSourceStages("job", { observedAt: "x", stages: [{ documentId: "a", stage: "reading" }, { documentId: "b", stage: "ready" }] });
    const html = render("reading", ["a", "b"]);
    expect(html).toContain("Needs your decision");
    expect(html.match(/data-stage="ready"/g)).toHaveLength(1);
  });
});

describe("freshSourceStages", () => {
  const frame = { observedAt: "x", stages: [{ documentId: "a", stage: "waking" }] };

  it("shows a frame while it is fresh and drops it once nothing has confirmed it for SOURCES_STALE_MS", () => {
    publishSourceStages("job", frame, 1_000);
    const stored = readSourceStages("job");
    expect(freshSourceStages(stored, 1_000 + SOURCES_STALE_MS - 1)?.stages).toEqual(frame.stages);
    expect(freshSourceStages(stored, 1_000 + SOURCES_STALE_MS)).toBeNull();
  });

  it("measures age from receipt on this clock, ignores the server's observedAt, and refuses a clock that went backwards", () => {
    publishSourceStages("job", { observedAt: "1999-01-01T00:00:00Z", stages: frame.stages }, 5_000);
    const stored = readSourceStages("job");
    expect(freshSourceStages(stored, 5_000)).not.toBeNull();
    expect(freshSourceStages(stored, 4_000)).toBeNull();
    expect(freshSourceStages(null, 5_000)).toBeNull();
  });

  it("a newer frame replaces the old one, so a source that finished stops showing as waking", () => {
    publishSourceStages("job", frame, 1_000);
    publishSourceStages("job", { observedAt: "y", stages: [{ documentId: "a", stage: "ready" }] }, 20_000);
    expect(freshSourceStages(readSourceStages("job"), 21_000)?.stages).toEqual([{ documentId: "a", stage: "ready" }]);
  });

  it("renders nothing for a stale frame", () => {
    publishSourceStages("job", frame, Date.now() - SOURCES_STALE_MS - 1_000);
    expect(renderToStaticMarkup(createElement(CompileSourceStages, { jobId: "job", state: "reading" }))).toBe("");
  });
});

describe("createSourceStagesPoller", () => {
  const payload = (stage: "waking" | "reading" | "ready" = "waking", observedAt = "t"): SourceStagesPayload =>
    ({ observedAt, stages: [{ documentId: "a", stage }] });
  const timing = { everyMs: 5_000, timeoutMs: 4_000, refreshMs: 15_000 };
  let clock = 0;
  beforeEach(() => { clock = 0; vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  const settle = () => vi.advanceTimersByTimeAsync(0);

  it("never waits: a listing that never answers leaves poll() instant, sends nothing and is retried after the deadline", async () => {
    const read = vi.fn(() => new Promise<SourceStagesPayload | null>(() => undefined));
    const poller = createSourceStagesPoller(read, () => clock, timing);
    expect(poller.poll()).toBeNull();
    await settle();
    expect(read).toHaveBeenCalledTimes(1);
    for (let second = 1; second <= 3; second += 1) {
      clock += 1_000;
      await vi.advanceTimersByTimeAsync(1_000);
      expect(poller.poll()).toBeNull();
    }
    expect(read).toHaveBeenCalledTimes(1);
    // The deadline passes (4 s) and the next window opens (5 s): a second listing starts, still nothing is sent.
    clock += 2_000;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(poller.poll()).toBeNull();
    await settle();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("drops an answer that arrives after the deadline instead of sending a stale stage", async () => {
    const read = vi.fn(() => new Promise<SourceStagesPayload | null>(resolve => setTimeout(() => resolve(payload("reading")), 9_000)));
    const poller = createSourceStagesPoller(read, () => clock, timing);
    poller.poll();
    await vi.advanceTimersByTimeAsync(9_500);
    clock += 4_900;
    expect(poller.poll()).toBeNull();
    await settle();
    clock += 200;
    expect(poller.poll()).toBeNull();
  });

  it("sends a change at once and an unchanged payload only as a refresh", async () => {
    let next = payload("waking", "t1");
    const poller = createSourceStagesPoller(async () => next, () => clock, timing);
    poller.poll();
    await settle();
    clock += 1_000;
    expect(poller.poll()?.stages).toEqual([{ documentId: "a", stage: "waking" }]);
    const tick = async (ms: number) => { clock += ms; await settle(); const sent = poller.poll(); await settle(); return sent; };
    // Same stages with a newer observedAt: not a change.
    next = payload("waking", "t2");
    expect(await tick(5_000)).toBeNull();
    expect(await tick(5_000)).toBeNull();
    // Refresh window (15 s since the last frame) reached: the unchanged payload is resent.
    expect((await tick(5_000))?.observedAt).toBe("t2");
    // A real change goes out on the very next answer.
    next = payload("ready", "t3");
    await tick(5_000);
    expect((await tick(5_000))?.stages).toEqual([{ documentId: "a", stage: "ready" }]);
  });

  it("treats a failing or null listing as silence and keeps trying", async () => {
    const read = vi.fn<() => Promise<SourceStagesPayload | null>>()
      .mockRejectedValueOnce(new Error("bucket down"))
      .mockResolvedValueOnce(null)
      .mockResolvedValue(payload("reading"));
    const poller = createSourceStagesPoller(read, () => clock, timing);
    const sent: Array<SourceStagesPayload | null> = [];
    for (let pass = 0; pass < 4; pass += 1) {
      sent.push(poller.poll());
      await settle();
      clock += 5_000;
    }
    expect(sent.slice(0, 3)).toEqual([null, null, null]);
    expect(sent[3]?.stages).toEqual([{ documentId: "a", stage: "reading" }]);
    expect(read).toHaveBeenCalledTimes(4);
  });

  it("runs one listing at a time", async () => {
    let release: (value: SourceStagesPayload | null) => void = () => undefined;
    const read = vi.fn(() => new Promise<SourceStagesPayload | null>(resolve => { release = resolve; }));
    const poller = createSourceStagesPoller(read, () => clock, { ...timing, timeoutMs: 60_000 });
    poller.poll();
    await settle();
    clock += 10_000;
    poller.poll();
    await settle();
    expect(read).toHaveBeenCalledTimes(1);
    release(payload());
    await settle();
    clock += 1;
    expect(poller.poll()?.stages).toHaveLength(1);
  });
});
