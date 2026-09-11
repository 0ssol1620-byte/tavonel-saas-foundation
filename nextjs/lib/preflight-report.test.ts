import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import OperationsUltimate from "../components/operations-ultimate";
import { buildPipeline } from "./pipeline";
import { PROCESSING_CEILING } from "../../shared/intakeCeiling";
import { CAPABILITY_MANIFEST, isAcceptedAtUpload } from "../../shared/capabilityManifest";
import {
  buildPreflightFileReport,
  buildPreflightSummary,
  describePreflightFile,
  describePreflightSummary,
} from "./preflight-report";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

describe("the per-file preflight report", () => {
  it("says what a spreadsheet loses, from the same manifest row /sources prints", () => {
    const report = buildPreflightFileReport({ fileName: "forecast.xlsx", mime: XLSX });
    const row = CAPABILITY_MANIFEST.entries.find((entry) => entry.mime === XLSX);
    expect(report.status).toBe("accepted");
    expect(report.tier).toBe("BEST_EFFORT");
    expect(report.preserved).toEqual(["page", "paragraph_text", "bbox1000"]);
    expect(report.preserved).toEqual(row?.preserved);
    expect(report.converted).toBe(true);
    expect(report.omitted).toContain("cell_addresses");
    expect(report.omitted).toContain("formulas");
    expect(report.omitted).toContain("merged_ranges");
    expect(report.reasons).toContain("converted_to_pdf_before_reading");
    expect(report.reviewRequired).toBe(false);
  });

  it.each([
    ["manual.pdf", "application/pdf", false, []],
    ["notes.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", true, ["comments"]],
    ["deck.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation", true, ["speaker_notes"]],
    ["scan.png", "image/png", true, []],
  ])("accepts %s and reports its family's omissions", (fileName, mime, converted, omitted) => {
    const report = buildPreflightFileReport({ fileName, mime });
    expect(report.status).toBe("accepted");
    expect(report.converted).toBe(converted);
    for (const token of omitted as string[]) expect(report.omitted).toContain(token);
  });

  it("omits nothing for an image, rather than inventing a limitation", () => {
    expect(buildPreflightFileReport({ fileName: "scan.png", mime: "image/png" }).omitted).toEqual([]);
  });

  it("claims no omission a tier was never going to extract", () => {
    const everyOmission = CAPABILITY_MANIFEST.entries
      .filter((entry) => isAcceptedAtUpload(entry.status))
      .flatMap((entry) => buildPreflightFileReport({ fileName: `a.${entry.extensions[0]}`, mime: entry.mime }).omitted);
    for (const token of ["chart_legend", "chart_axis", "animation_order", "slide_transition", "font_embedding"]) {
      expect(everyOmission).not.toContain(token);
    }
  });

  it("refuses an unsupported MIME instead of accepting it with an empty report", () => {
    const report = buildPreflightFileReport({ fileName: "drawing.dwg", mime: "image/vnd.dwg" });
    expect(report.status).toBe("refused");
    expect(report.tier).toBe("UNSUPPORTED");
    expect(report.preserved).toEqual([]);
    expect(report.omitted).toEqual([]);
    expect(report.reasons).toEqual(["unqualified_mime"]);
  });

  it("refuses what the upload route refuses, in the route's own vocabulary", () => {
    // Not a second opinion: these codes come out of validateQualifiedDocumentInput, so the
    // preflight cannot promise an upload the server will reject.
    expect(buildPreflightFileReport({ fileName: "notes.docx", mime: "application/pdf" }).reasons)
      .toEqual(["filename_mime_mismatch"]);
    expect(buildPreflightFileReport({ fileName: "../escape.pdf", mime: "application/pdf" }).reasons)
      .toEqual(["invalid_filename"]);
    expect(buildPreflightFileReport({ fileName: "payload.pdf", mime: "__proto__" }).reasons)
      .toEqual(["unqualified_mime"]);
  });

  it("refuses a file over the processing ceiling before it is sent", () => {
    const report = buildPreflightFileReport({
      fileName: "manual.pdf",
      mime: "application/pdf",
      bytes: PROCESSING_CEILING.maxSourceBytes + 1,
    });
    expect(report.status).toBe("refused");
    expect(report.reasons).toEqual(["over_the_5_mib_processing_ceiling"]);
    // The byte exactly on the ceiling is accepted, because that is what the processors do.
    expect(buildPreflightFileReport({
      fileName: "manual.pdf",
      mime: "application/pdf",
      bytes: PROCESSING_CEILING.maxSourceBytes,
    }).status).toBe("accepted");
  });

  it("says so when the MIME was inferred, rather than presenting it as a server verdict", () => {
    const report = buildPreflightFileReport({ fileName: "forecast.xlsx" });
    expect(report.status).toBe("accepted");
    expect(report.mime).toBe(XLSX);
    expect(report.reasons[0]).toBe("mime_inferred_from_the_filename_extension");
  });

  it("refuses a file with no extension and no declared MIME rather than guessing a row", () => {
    const report = buildPreflightFileReport({ fileName: "scan" });
    expect(report.status).toBe("refused");
    expect(report.mime).toBeNull();
    expect(report.reasons).toEqual(["unqualified_mime"]);
  });

  it("reports the archive as a transport, with the browser limits that actually apply", () => {
    const report = buildPreflightFileReport({ fileName: "sources.zip" });
    expect(report.status).toBe("refused");
    expect(report.tier).toBe("UNSUPPORTED");
    expect(report.reasons).toContain("the_archive_itself_is_never_compiled");
    expect(report.reasons).toContain("expanded_in_the_browser_before_upload");
  });

  it("never invents a review requirement the caller did not state", () => {
    expect(buildPreflightFileReport({ fileName: "a.pdf", mime: "application/pdf" }).reviewRequired).toBe(false);
    expect(buildPreflightFileReport({
      fileName: "a.pdf",
      mime: "application/pdf",
      reviewRequired: true,
    }).reviewRequired).toBe(true);
    // A refused file is not "awaiting review": nothing will read it.
    expect(buildPreflightFileReport({
      fileName: "a.dwg",
      mime: "image/vnd.dwg",
      reviewRequired: true,
    }).reviewRequired).toBe(false);
  });
});

describe("the preflight denominators", () => {
  const summary = buildPreflightSummary([
    { fileName: "forecast.xlsx", mime: XLSX, reviewRequired: true },
    { fileName: "manual.pdf", mime: "application/pdf" },
    { fileName: "drawing.dwg", mime: "image/vnd.dwg" },
  ]);

  it("counts against the number of files staged, not against a rate with no denominator", () => {
    expect(summary.stagedCount).toBe(3);
    expect(summary.acceptedCount).toBe(2);
    expect(summary.refusedCount).toBe(1);
    expect(summary.convertedCount).toBe(1);
    expect(summary.reviewRequiredCount).toBe(1);
  });

  it("carries the qualification denominator /sources already publishes", () => {
    expect(summary.qualifiedFormatCount).toBe(0);
    expect(summary.acceptedFormatCount).toBe(
      CAPABILITY_MANIFEST.entries.filter((entry) => isAcceptedAtUpload(entry.status)).length,
    );
    expect(describePreflightSummary(summary))
      .toContain(`0 of ${summary.acceptedFormatCount} accepted formats carry a qualification receipt`);
    expect(describePreflightSummary(summary)).toContain("2 of 3 staged files accepted");
  });

  it("says nothing at all rather than something reassuring when nothing is staged", () => {
    const empty = buildPreflightSummary([]);
    expect(empty.files).toEqual([]);
    expect(describePreflightSummary(empty)).toContain("0 of 0 staged files accepted");
  });

  it("renders one line per file in the audit's vocabulary", () => {
    const line = describePreflightFile(summary.files[0]);
    expect(line).toContain("accepted as BEST_EFFORT");
    expect(line).toContain("preserved page, paragraph text, bbox1000");
    expect(line).toContain("converted to PDF before reading");
    expect(line).toContain("omitted sheet names, cell addresses, formulas");
    expect(line).toContain("review required");
    expect(describePreflightFile(summary.files[2])).toBe("refused · no review required");
  });
});

/*
  The component. `nextjs/lib/compile-job-panel.test.ts` is the pattern: render to static markup
  and assert on the words a customer reads, because a preflight that computes the report and
  does not show it is the same defect D10 names.
*/
describe("the workspace preflight section", () => {
  const render = (filenames: string[]) =>
    renderToStaticMarkup(createElement(OperationsUltimate, {
      mode: "runs" as const,
      rows: buildPipeline(
        filenames.map((filename, index) => ({
          localId: `local-${index}`,
          filename,
          bytes: 1024,
          documentId: null,
          phase: "stored" as const,
          loaded: 1024,
        })),
        [],
      ),
      documents: [],
      names: {},
      gates: [],
    }));

  it("shows a per-file row with its preservation and omission, not only a source count", () => {
    const html = render(["forecast.xlsx", "drawing.dwg"]);
    expect(html).toContain("forecast.xlsx");
    expect(html).toContain("preserved page, paragraph text, bbox1000");
    expect(html).toContain("omitted sheet names, cell addresses, formulas");
    expect(html).toContain("drawing.dwg");
    expect(html).toContain("refused");
    expect(html).toContain("accepted formats carry a qualification receipt");
  });

  it("counts a source whose filename this device does not hold instead of calling it refused", () => {
    const html = renderToStaticMarkup(createElement(OperationsUltimate, {
      mode: "runs" as const,
      rows: buildPipeline([], [{
        documentId: "doc_a1b2c3d4e5f6a7b8",
        versionKey: "ab".repeat(32),
        sanitizedKey: `immutable/ws/ws/doc_a1b2c3d4e5f6a7b8/${"ab".repeat(32)}/sanitized.pdf`,
        sanitizedSize: 2048,
        sanitizedObservedAt: null,
        ocrJsonKey: null,
        ocrJsonSize: null,
        hasOcrJson: false,
        cdrReceiptKey: null,
        ocrReviewKey: null,
        processingState: "sanitized" as const,
      }]),
      documents: [],
      names: {},
      gates: [],
    }));
    expect(html).toContain("this browser holds no filename to report on");
    expect(html).not.toContain("accepted as BEST_EFFORT");
    expect(html).not.toContain("refused · no review required");
  });

  it("draws no per-file table when no file has been staged", () => {
    const html = render([]);
    expect(html).not.toContain("accepted as BEST_EFFORT");
    expect(html).toContain("No source run has been observed");
  });
});
