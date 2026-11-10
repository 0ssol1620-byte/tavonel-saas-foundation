import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The board as it renders once segmented intake is on (PDF ceiling 500). The switch-off side, where
// the ceiling is 80 and no re-approval is offered, is lib/pipeline.test.ts.
vi.mock("../../shared/intakeCeiling", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../shared/intakeCeiling")>();
  const on = real.intakeCeilingFor(real.INTAKE_CEILING_STAGE, true);
  return { ...real, ...on, SEGMENTED_INTAKE_ENABLED: true,
    maxSourcePagesFor: (mimeType: string) => real.maxSourcePagesFor(mimeType, on.PROCESSING_CEILING) };
});
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

  it("offers no upload above the live ceiling, and says to split instead (#242 R1 P2)", () => {
    const tooLong = { ...refused, refusal: { ...refused.refusal!, observedPages: 501 } };
    const html = renderToStaticMarkup(createElement(PipelineBoard, {
      rows: buildPipeline([], [tooLong]), customerDataAccess: "open", onReapprove: () => undefined,
    }));
    expect(html).not.toContain("Upload again and approve");
    expect(buildPipeline([], [tooLong])[0].stages[1].detail).toContain("split it into PDFs of at most 500 pages");
    expect(buildPipeline([], [refused])[0].stages[1].detail).toBe(
      "This PDF has 240 pages, more than the 80 pages approved for it, so it was stored but not compiled or charged. Upload it again and approve 240 pages.",
    );
  });

  it("sends that count as the upload's estimatedPages, on the per-file path the board offers it on", () => {
    const page = readFileSync(join(process.cwd(), "app/workspace/page.tsx"), "utf8");
    expect(page).toContain("estimatedPages: Math.max(approvePages ?? 0, estimateBillablePages({");
    expect(page).toContain("void uploadLegacyDocument(file, true, undefined, null, pages)");
    expect(page).toContain("onReapprove={intakeOpen && !INTAKE_APPROVAL_ROLLOUT_ENABLED ? reapproveSource : undefined}");
  });
});
