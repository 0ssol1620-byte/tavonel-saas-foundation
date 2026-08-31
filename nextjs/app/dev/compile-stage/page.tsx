"use client";

/**
 * A harness for the workspace compile stage, built from the real `buildPipeline` output.
 *
 * The canvas is only honest if it survives real pipeline shapes: a file still sending, one
 * under the reader with boxes streaming back, one held for a person, and several compiled.
 * This route constructs exactly those rows through the production builder — no hand-written
 * PipelineRow literals — so a change to the pipeline breaks this page too.
 *
 * Not linked from anywhere. It exists so the stage can be inspected without an account.
 */

import CompileStage from "@/components/compile-stage";
import { buildPipeline, type LocalUpload } from "@/lib/pipeline";
import type { DocumentListItem } from "@/lib/immutable-keys";
import type { OcrProgress } from "@/lib/ocr-progress";

const uploads: LocalUpload[] = [
  { localId: "u1", filename: "Services Agreement 2026.pdf", bytes: 2_400_000, documentId: "d-agreement", phase: "stored", loaded: 2_400_000 },
  { localId: "u2", filename: "Operations Manual r9.pdf", bytes: 5_100_000, documentId: "d-manual", phase: "stored", loaded: 5_100_000 },
  { localId: "u3", filename: "scan_0140.jpg", bytes: 1_800_000, documentId: "d-scan", phase: "stored", loaded: 1_800_000 },
  { localId: "u4", filename: "Employee Handbook 2026.pdf", bytes: 3_300_000, documentId: "d-handbook", phase: "stored", loaded: 3_300_000 },
  { localId: "u5", filename: "Q3 forecast.xlsx", bytes: 900_000, documentId: null, phase: "sending", loaded: 430_000 },
];

const doc = (
  documentId: string,
  over: Partial<DocumentListItem> = {},
): DocumentListItem => ({
  documentId,
  versionKey: `i/${documentId}/v1`,
  sanitizedKey: `i/${documentId}/v1/sanitized.pdf`,
  sanitizedSize: 2_100_000,
  ocrJsonKey: null,
  ocrJsonSize: null,
  hasOcrJson: false,
  cdrReceiptKey: `i/${documentId}/v1/cdr-receipt.json`,
  ocrReviewKey: null,
  processingState: "sanitized",
  ...over,
});

const documents: DocumentListItem[] = [
  doc("d-agreement", { hasOcrJson: true, ocrJsonKey: "o/d-agreement", ocrJsonSize: 41_000, processingState: "ocr_ready" }),
  doc("d-manual", { hasOcrJson: true, ocrJsonKey: "o/d-manual", ocrJsonSize: 63_000, processingState: "ocr_ready" }),
  doc("d-scan"),
  doc("d-handbook", {
    processingState: "operator_review",
    ocrReviewKey: "i/d-handbook/v1/ocr-review.json",
    ocrReviewReasonCode: "low_confidence_region",
  }),
];

const reading: Record<string, OcrProgress> = {
  "d-scan": {
    state: "reading",
    pagesRead: 3,
    pageCount: 12,
    regionsFound: 41,
    pages: [
      {
        pageNumber1: 3,
        pageCount: 12,
        path: "p/3",
        regionCount: 14,
        meanConfidence: 0.86,
        boxes: [
          { bbox1000: [60, 70, 640, 130], confidence: 0.94, text: "Site visit notes", regionId: "r1" },
          { bbox1000: [60, 170, 900, 230], confidence: 0.91, text: "Warehouse B — 12 March 2026", regionId: "r2" },
          { bbox1000: [60, 260, 900, 320], confidence: 0.88, text: "Loading bay closed after 18:00.", regionId: "r3" },
          { bbox1000: [60, 350, 900, 410], confidence: 0.84, text: "Gate staff had no revised schedule.", regionId: "r4" },
          { bbox1000: [60, 440, 900, 500], confidence: 0.57, text: "Bay 2 lighting failed at 17:40 (stamped)", regionId: "r5" },
          { bbox1000: [60, 530, 900, 590], confidence: 0.9, text: "Logged against Operations Manual 4.3.", regionId: "r6" },
          { bbox1000: [60, 620, 620, 680], confidence: 0.79, text: "Names in the margin: Park, Singh.", regionId: "r7" },
        ],
      },
    ],
  },
};

export default function CompileStageHarness() {
  const rows = buildPipeline(uploads, documents, ["d-agreement", "d-manual"]);
  const names = {
    "d-agreement": "Services Agreement 2026.pdf",
    "d-manual": "Operations Manual r9.pdf",
    "d-scan": "scan_0140.jpg",
    "d-handbook": "Employee Handbook 2026.pdf",
  };
  return (
    <main id="main" style={{ padding: 24, background: "#08090a", minHeight: "100vh" }}>
      <CompileStage rows={rows} reading={reading} names={names} />
    </main>
  );
}
