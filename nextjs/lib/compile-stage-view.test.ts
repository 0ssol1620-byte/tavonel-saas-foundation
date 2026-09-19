import { describe, expect, it } from "vitest";
import { deriveCompileStageView, hasActiveSourceWork } from "./compile-stage-view";
import type { PipelineRow } from "./pipeline";
import type { CompileState } from "./compile-job-store";
import type { OcrProgress } from "./ocr-progress";
const row = (held = false): PipelineRow => ({ id: "source-a", filename: "original.pdf", transfer: null, needsPerson: held, observedAt: null,
  stages: [
    { key: "quarantine", label: "UPLOAD", state: "done", detail: "stored" },
    { key: "sanitize", label: "PREPARE", state: "done", detail: "safe copy" },
    { key: "read", label: "READ", state: held ? "held" : "done", detail: "read" },
    { key: "compile", label: "COMPILE", state: held ? "waiting" : "active", detail: "ready for compilation" },
  ] });
const world = (status: "active" | "candidate", id = "new") => ({ world: { id, status }, objects: [{ id: "real-object" }] });
describe("compile-stage state and payload integrity", () => {
  it("does not turn 31 ready and 44 held inventory rows into a live run", () => {
    const rows = [...Array.from({ length: 31 }, () => row()), ...Array.from({ length: 44 }, () => row(true))];
    expect(hasActiveSourceWork(rows)).toBe(false);
    expect(deriveCompileStageView(rows, {}, null, null)).toMatchObject({ visual: "none", tone: "waiting" });
  });
  it.each(["draft", "preflight", "awaiting_confirmation", "uploading", "sanitizing", "reading", "structuring", "resolving", "building_world", "review_required", "ready", "failed", "cancelled"] as CompileState[])("%s never paints an empty result as ready for AI", state => {
    const view = deriveCompileStageView([], {}, null, state);
    expect(view.visual).toBe("none"); expect(view.finalLabel).toBe("Review & activate");
    expect(view.title.length).toBeGreaterThan(5); expect(view.detail.length).toBeGreaterThan(30);
    expect(view.tone).not.toBe("ready");
  });
  it("separates candidate completion, activation and stale results", () => {
    expect(deriveCompileStageView([], {}, world("candidate"), "ready", "new").tone).toBe("attention");
    expect(deriveCompileStageView([], {}, world("active"), "ready", "new")).toMatchObject({ tone: "ready", visual: "world", finalLabel: "Ready for AI" });
    expect(deriveCompileStageView([], {}, world("active", "old"), "ready", "new").visual).toBe("none");
    expect(deriveCompileStageView([], {}, world("active"), "building_world", "new").visual).toBe("none");
    expect(deriveCompileStageView([], {}, world("active"), "review_required", "new").tone).toBe("attention");
  });
  it("draws only received pages belonging to listed sources, not a reported count alone", () => {
    const progress: OcrProgress = { state: "reading", pagesRead: 0, pageCount: 1, regionsFound: 10, pages: [] };
    expect(deriveCompileStageView([row()], { "source-a": progress }, null, "structuring").visual).toBe("none");
    progress.pages.push({ pageNumber1: 1, pageCount: 1, path: "page-1", regionCount: 1, meanConfidence: 1, boxes: [{ bbox1000: [10, 10, 90, 90], confidence: 1, text: "Actual received text", regionId: "r1" }] });
    expect(deriveCompileStageView([row()], { "source-a": progress }, null, "reading").visual).toBe("page");
    expect(deriveCompileStageView([row()], { "source-a": progress }, null, "structuring").visual).toBe("structure");
    expect(deriveCompileStageView([row()], { "unrelated": progress }, null, "reading").visual).toBe("none");
  });
});
