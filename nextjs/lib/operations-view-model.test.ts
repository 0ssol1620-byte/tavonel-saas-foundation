import { describe, expect, it } from "vitest";
import { buildOperationsSnapshot } from "./operations-view-model";
import type { PipelineRow } from "./pipeline";

const row = (id: string, read: "done" | "active" | "held"): PipelineRow => ({
  id,
  filename: null,
  transfer: null,
  needsPerson: read === "held",
  stages: [
    { key: "quarantine", label: "QUARANTINE", state: "done", detail: "stored" },
    { key: "sanitize", label: "SANITIZE", state: "done", detail: "sanitized.pdf" },
    { key: "read", label: "READ", state: read, detail: read },
    { key: "compile", label: "COMPILE", state: read === "done" ? "active" : "waiting", detail: "" },
  ],
});

describe("operations view model", () => {
  it("opens compile only from two observed OCR outputs", () => {
    const result = buildOperationsSnapshot([row("a", "done"), row("b", "done")], [{}, {}] as never, []);
    expect(result.compileEligible).toBe(true);
    expect(result.readyCount).toBe(2);
  });

  it("keeps held work visible and fail closed", () => {
    const result = buildOperationsSnapshot([row("a", "done"), row("b", "held")], [{}, {}] as never, []);
    expect(result.compileEligible).toBe(false);
    expect(result.blockers).toContain("1 source requires operator review.");
  });

  it("reports policy gates as blockers without inventing progress", () => {
    const result = buildOperationsSnapshot([], null, [{ label: "OCR", qualified: false, detail: "disabled" }]);
    expect(result.runningCount).toBe(0);
    expect(result.blockers).toContain("OCR: disabled");
  });
});
