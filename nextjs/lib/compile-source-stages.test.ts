import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { CompileSourceStages } from "@/components/compile-source-stages";
import {
  clearSourceStages, deriveSourceStages, parseSourceStages, publishSourceStages, readSourceStages, WAKE_WINDOW_MS,
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

  it("says the reader is waking up as a normal step, with a typical time and no alarm", () => {
    publishSourceStages("job", { observedAt: "x", stages: [{ documentId: "a", stage: "waking" }, { documentId: "b", stage: "queued" }] });
    const html = render("reading");
    expect(html).toContain("Contract.docx");
    expect(html).toContain("Reader waking up");
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
