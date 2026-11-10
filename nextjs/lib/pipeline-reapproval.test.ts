import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PipelineBoard from "@/components/pipeline-board";
import { buildPipeline, type PipelineDocument } from "@/lib/pipeline";

/*
  ADR-0006 F1: a PDF refused for more pages than it was approved at offers the way back on its own
  row -- an upload of the same file approving the count the worker read.
*/
const refused: PipelineDocument = {
  documentId: "doc-1", versionKey: "", sanitizedKey: null, sanitizedSize: null, sanitizedObservedAt: null,
  ocrJsonKey: null, ocrJsonSize: null, hasOcrJson: false, cdrReceiptKey: null, ocrReviewKey: null,
  processingState: "refused",
  refusal: { reasonCode: "PARSER_OOM", observedBytes: 2048, occurredAt: "2026-11-10T00:00:00.000Z", observedPages: 240, approvedMaxPages: 80 },
};

const render = (onReapprove?: (pages: number) => void) => renderToStaticMarkup(createElement(PipelineBoard, {
  rows: buildPipeline([], [refused]), customerDataAccess: "open", onReapprove,
}));

describe("re-approval of a source longer than its approval", () => {
  it("offers an upload approving the real count, only where the page can send one", () => {
    expect(render(() => undefined)).toContain("Upload again and approve 240 pages");
    expect(render()).not.toContain("Upload again and approve");
  });

  it("sends that count as the upload's estimatedPages, on the per-file path the board offers it on", () => {
    const page = readFileSync(join(process.cwd(), "app/workspace/page.tsx"), "utf8");
    expect(page).toContain("estimatedPages: Math.max(approvePages ?? 0, estimateBillablePages({");
    expect(page).toContain("void uploadLegacyDocument(file, true, undefined, null, pages)");
    expect(page).toContain("onReapprove={intakeOpen && !INTAKE_APPROVAL_ROLLOUT_ENABLED ? reapproveSource : undefined}");
  });
});
