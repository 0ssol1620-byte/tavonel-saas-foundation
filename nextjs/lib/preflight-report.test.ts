import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
  words,
} from "./preflight-report";
import { validateIntakeAdmission, type IntakeAdmission } from "./intake-admission";

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
      .toContain(`0 of ${summary.acceptedFormatCount} supported formats carry a qualification receipt`);
    expect(describePreflightSummary(summary)).toContain("2 of 3 selected files supported by format checks");
  });

  it("says nothing at all rather than something reassuring when nothing is staged", () => {
    const empty = buildPreflightSummary([]);
    expect(empty.files).toEqual([]);
    expect(describePreflightSummary(empty)).toContain("0 of 0 selected files supported by format checks");
  });

  it("renders one line per file in the audit's vocabulary", () => {
    const line = describePreflightFile(summary.files[0]);
    expect(line).toContain("Format support: Supported with limitations");
    expect(line).toContain("Expected output: page, paragraph text, Locations on the source page");
    expect(line).toContain("Planned conversion to PDF before reading");
    expect(line).toContain("Not extracted: sheet names, cell addresses, formulas");
    expect(line).toContain("Source marked for review");
    expect(describePreflightFile(summary.files[2])).toBe("refused by format checks · Source safety not assessed by this format lookup");
  });

  it("does not turn an absent review flag into a file-safety verdict", () => {
    const report = buildPreflightFileReport({ fileName: "scan.pdf", mime: "application/pdf" });
    const line = describePreflightFile(report);
    expect(line).toContain("Source safety not assessed by this format lookup");
    expect(line).not.toContain("no review required");
    const summaryLine = describePreflightSummary(buildPreflightSummary([{ fileName: "scan.pdf" }]));
    expect(summaryLine).toContain("this report does not inspect file bytes or assess safety");
    expect(summaryLine).not.toContain("0 awaiting review");
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
    expect(html).toContain("Expected output: page, paragraph text, Locations on the source page");
    expect(html).toContain("Not extracted: sheet names, cell addresses, formulas");
    expect(html).toContain("drawing.dwg");
    expect(html).toContain("refused");
    expect(html).toContain("supported formats carry a qualification receipt");
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
    expect(html).not.toContain("Format support: Supported with limitations");
    expect(html).not.toContain("refused by format checks · Source safety not assessed by this format lookup");
  });

  it("draws no per-file table when no file has been staged", () => {
    const html = render([]);
    expect(html).not.toContain("Format support: Supported with limitations");
    expect(html).toContain("No source run has been observed");
  });
});

/*
  D10's other half: the report has to be on the panel where the upload is authorised.

  The operations surface above reports on sources that already exist. The staged-selection block
  is the last moment a customer can still change their mind, and it was the surface making the
  "1 file staged" claim with nothing beside it. The page is a client component with live effects
  and a Supabase browser client, so this reads the mount rather than rendering it: the rendering
  is covered by the cases above, and what could silently disappear here is the call.
*/
describe("the staged-selection block in the workspace", () => {
  const read = (path: string) => readFileSync(resolve(import.meta.dirname, "..", path), "utf8");

  it("reports per staged file before the upload is spent", () => {
    const page = read("app/workspace/page.tsx");
    expect(page).toContain('from "@/lib/preflight-report"');
    // Built from the staged files themselves, with the browser's own MIME and size, so every
    // staged file is reported on rather than the subset whose filename is known.
    expect(page).toContain("const stagedPreflight = buildPreflightSummary(");
    expect(page).toContain("mime: entry.file.type || null");
    expect(page).toContain("bytes: entry.file.size");
    for (const rendered of [
      "describePreflightSummary(stagedPreflight)",
      "describePreflightFile(file)",
      "file.reasons.map(words)",
      "<strong>{file.fileName}</strong>",
    ]) {
      expect(page, rendered).toContain(rendered);
    }
  });

  it("stacks the rows at phone width instead of scrolling the page sideways", () => {
    const css = read("app/tavonel.css");
    const list = css.slice(css.indexOf(".workspace-preflight-files {"));
    const outer = list.slice(0, list.indexOf(".workspace-preflight-files li"));
    expect(outer).toContain("display: grid");
    /*
      One column at every width, and nothing that sets a floor wider than a 360px screen. A
      `min-width: 0` is the opposite of that problem -- it is what lets a long filename wrap
      inside its track instead of widening the row -- so only a non-zero one fails here.
    */
    expect(outer).not.toMatch(/grid-template-columns|\bwidth:\s|min-width:\s(?!0)/);
    expect(list).toContain("min-width: 0");
    expect(list).toContain("overflow-wrap: anywhere");
  });
});

/*
  A known size, held to the predicate intake actually admits on.

  The browser reports a size for a file it is still sending. When it does, the report must not
  call accepted what `validateIntakeAdmission` refuses -- an empty file used to read as a
  supported one. When it does not (absent or null) nothing is known, and the report stays the
  format lookup it always was: unknown is not zero.
*/
const INVALID_SIZE = "empty_or_invalid_file_size";
const OVER_CEILING = "over_the_5_mib_processing_ceiling";
const sized = (bytes: unknown, fileName = "manual.pdf", mime: string | null = "application/pdf") =>
  buildPreflightFileReport({ fileName, mime, bytes: bytes as number | null });

describe("preflight known size admission: an empty or negative size is refused", () => {
  const cases: Array<[string, number]> = [
    ["zero", 0],
    ["negative zero", -0],
    ["minus one", -1],
    ["minus the ceiling", -PROCESSING_CEILING.maxSourceBytes],
    ["the most negative safe integer", Number.MIN_SAFE_INTEGER],
  ];

  it.each(cases)("refuses %s bytes", (_label, bytes) => {
    const report = buildPreflightFileReport({
      fileName: "manual.pdf",
      mime: "application/pdf",
      bytes,
      reviewRequired: true,
    });
    expect(report.status).toBe("refused");
    expect(report.reasons).toEqual([INVALID_SIZE]);
    expect(report.preserved).toEqual([]);
    expect(report.omitted).toEqual([]);
    expect(report.converted).toBe(false);
    // Refused means nothing will read it, so it is not "awaiting review" either.
    expect(report.reviewRequired).toBe(false);
  });

  it("refuses an empty file whose MIME was inferred from the filename as well", () => {
    const report = buildPreflightFileReport({ fileName: "forecast.xlsx", bytes: 0 });
    expect(report.status).toBe("refused");
    expect(report.mime).toBe(XLSX);
    expect(report.reasons).toEqual([INVALID_SIZE]);
  });
});

describe("preflight known size admission: a fractional, non-finite, unsafe or non-number size is refused", () => {
  const cases: Array<[string, unknown]> = [
    ["fractional", 1.5],
    ["fractional just under the ceiling", PROCESSING_CEILING.maxSourceBytes - 0.5],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["beyond the safe integers", Number.MAX_SAFE_INTEGER + 1],
    ["a numeric string from an untyped caller", "1024"],
    ["a boolean from an untyped caller", true],
    ["an object from an untyped caller", {}],
  ];

  it.each(cases)("refuses %s", (_label, bytes) => {
    const report = sized(bytes);
    expect(report.status).toBe("refused");
    // Infinity is not a larger file; it is not a size. Only a real count reaches the ceiling.
    expect(report.reasons).toEqual([INVALID_SIZE]);
    expect(report.reasons).not.toContain(OVER_CEILING);
  });
});

describe("preflight known size admission: unknown size stays a format lookup and the ceiling is unchanged", () => {
  const unknownSize = buildPreflightFileReport({ fileName: "manual.pdf", mime: "application/pdf" });

  it("treats absent, undefined and null as unknown, never as zero", () => {
    expect(unknownSize.status).toBe("accepted");
    expect(unknownSize.reasons).not.toContain(INVALID_SIZE);
    expect(buildPreflightFileReport({ fileName: "manual.pdf", mime: "application/pdf", bytes: undefined }))
      .toEqual(unknownSize);
    expect(buildPreflightFileReport({ fileName: "manual.pdf", mime: "application/pdf", bytes: null }))
      .toEqual(unknownSize);
    const inferred = buildPreflightFileReport({ fileName: "forecast.xlsx", bytes: null });
    expect(inferred.status).toBe("accepted");
    expect(inferred.reasons[0]).toBe("mime_inferred_from_the_filename_extension");
  });

  it("accepts one byte and exactly the ceiling with the same report as an unknown size", () => {
    expect(sized(1)).toEqual(unknownSize);
    expect(sized(PROCESSING_CEILING.maxSourceBytes)).toEqual(unknownSize);
  });

  it("refuses one byte over the ceiling with the reason it already gave", () => {
    expect(PROCESSING_CEILING.maxSourceBytes).toBe(5 * 1024 * 1024);
    const report = sized(PROCESSING_CEILING.maxSourceBytes + 1);
    expect(report.status).toBe("refused");
    expect(report.reasons).toEqual([OVER_CEILING]);
  });
});

describe("preflight known size admission: agrees with the actual pure intake admission predicate", () => {
  // Metadata only. The real validator is called directly: no reservation, RPC, signing or
  // credentials, and nothing here says the upload would be authorised, paid for or processed.
  const admission: IntakeAdmission = {
    workspaceKey: "ws_size_fixture",
    documentId: "3f2a9c1e-8b4d-4e6f-9a1b-2c3d4e5f6a7b",
    userId: "7c1d2e3f-4a5b-4c6d-8e7f-a1b2c3d4e5f6",
    objectKey: "quarantine/ws_size_fixture/3f2a9c1e-8b4d-4e6f-9a1b-2c3d4e5f6a7b/source",
    requestedBytes: 1,
    declaredMimeType: "application/pdf",
  };
  const admits = (bytes: unknown) => validateIntakeAdmission({ ...admission, requestedBytes: bytes as number });

  it("starts from a fixture the validator accepts, so only the size can decide", () => {
    expect(admits(1)).toBe(true);
  });

  const cases: Array<[string, unknown, boolean]> = [
    ["zero", 0, false],
    ["minus one", -1, false],
    ["fractional", 1.5, false],
    ["NaN", Number.NaN, false],
    ["Infinity", Number.POSITIVE_INFINITY, false],
    ["beyond the safe integers", Number.MAX_SAFE_INTEGER + 1, false],
    ["a numeric string", "1024", false],
    ["one byte", 1, true],
    ["one KiB", 1024, true],
    ["exactly the ceiling", PROCESSING_CEILING.maxSourceBytes, true],
    ["one byte over the ceiling", PROCESSING_CEILING.maxSourceBytes + 1, false],
  ];

  it.each(cases)("%s: the report accepts exactly when admission does", (_label, bytes, admitted) => {
    expect(admits(bytes)).toBe(admitted);
    expect(sized(bytes).status).toBe(admitted ? "accepted" : "refused");
  });

  it("makes no size claim at all when the size is unknown", () => {
    // Admission needs a byte count; a report without one stays a format lookup and is not
    // presented as an admission verdict in either direction.
    const report = sized(null);
    expect(report.status).toBe("accepted");
    expect(report.reasons).not.toContain(INVALID_SIZE);
    expect(report.reasons).not.toContain(OVER_CEILING);
  });
});

describe("preflight known size admission: mixed sizes are counted honestly and claim no safety", () => {
  const summary = buildPreflightSummary([
    { fileName: "empty.pdf", mime: "application/pdf", bytes: 0 },
    { fileName: "one.pdf", mime: "application/pdf", bytes: 1 },
    { fileName: "edge.pdf", mime: "application/pdf", bytes: PROCESSING_CEILING.maxSourceBytes },
    { fileName: "large.pdf", mime: "application/pdf", bytes: PROCESSING_CEILING.maxSourceBytes + 1 },
    { fileName: "garbled.pdf", mime: "application/pdf", bytes: Number.NaN },
    { fileName: "unknown.pdf", mime: "application/pdf", bytes: null },
  ]);

  it("counts the empty, garbled and oversized files as refused against the same denominator", () => {
    expect(summary.files.map((file) => file.status))
      .toEqual(["refused", "accepted", "accepted", "refused", "refused", "accepted"]);
    expect(summary.stagedCount).toBe(6);
    expect(summary.acceptedCount).toBe(3);
    expect(summary.refusedCount).toBe(3);
    expect(summary.acceptedCount + summary.refusedCount).toBe(summary.stagedCount);
    expect(describePreflightSummary(summary)).toContain("3 of 6 selected files supported by format checks");
  });

  it("gives each refusal one plain reason a customer can read", () => {
    expect(summary.files[0].reasons.map(words)).toEqual(["empty or invalid file size"]);
    expect(summary.files[4].reasons.map(words)).toEqual(["empty or invalid file size"]);
    expect(summary.files[3].reasons.map(words)).toEqual(["over the 5 mib processing ceiling"]);
    for (const file of summary.files.filter((each) => each.status === "refused")) {
      for (const reason of file.reasons.map(words)) {
        expect(reason).not.toMatch(/_|intake|admission|requested|integer|rpc/i);
      }
    }
  });

  it("keeps the safety and qualification caveats beside the counts", () => {
    const line = describePreflightSummary(summary);
    expect(line).toContain("Source safety checks are separate");
    expect(line).toContain(`0 of ${summary.acceptedFormatCount} supported formats carry a qualification receipt`);
    expect(line).toContain("Format lookup only; this report does not inspect file bytes or assess safety");
    for (const file of summary.files) {
      const fileLine = describePreflightFile(file);
      expect(fileLine).toContain("Source safety not assessed by this format lookup");
      expect(fileLine).not.toMatch(/\bsafe to\b|guarantee|qualified/i);
    }
    expect(describePreflightFile(summary.files[0]))
      .toBe("refused by format checks · Source safety not assessed by this format lookup");
  });
});

describe("preflight known size admission: format refusals still come first and inputs are not mutated", () => {
  it("keeps the filename, MIME and unsupported-format reasons ahead of any size", () => {
    expect(sized(0, "../escape.pdf").reasons).toEqual(["invalid_filename"]);
    expect(sized(-1, "notes.docx").reasons).toEqual(["filename_mime_mismatch"]);
    expect(sized(Number.NaN, "payload.pdf", "__proto__").reasons).toEqual(["unqualified_mime"]);
    expect(sized(1.5, "drawing.dwg", "image/vnd.dwg").reasons).toEqual(["unqualified_mime"]);
    expect(sized(PROCESSING_CEILING.maxSourceBytes + 1, "drawing.dwg", "image/vnd.dwg").reasons)
      .toEqual(["unqualified_mime"]);
    expect(sized(0, "scan", null).reasons).toEqual(["unqualified_mime"]);
    const archive = sized(0, "sources.zip", null);
    expect(archive.tier).toBe("UNSUPPORTED");
    expect(archive.reasons).toContain("the_archive_itself_is_never_compiled");
    expect(archive.reasons).not.toContain(INVALID_SIZE);
  });

  it("reads its inputs without changing them", () => {
    const inputs = [
      { fileName: " manual.pdf ", mime: "application/pdf", bytes: 0, reviewRequired: true },
      { fileName: "manual.pdf", mime: "application/pdf", bytes: Number.NaN },
      { fileName: "manual.pdf", mime: "application/pdf", bytes: PROCESSING_CEILING.maxSourceBytes + 1 },
      { fileName: "manual.pdf", mime: "application/pdf", bytes: null },
      { fileName: "../escape.pdf", mime: "application/pdf", bytes: -1 },
    ];
    const before = structuredClone(inputs);
    for (const input of inputs) Object.freeze(input);
    Object.freeze(inputs);
    buildPreflightSummary(inputs);
    for (const input of inputs) buildPreflightFileReport(input);
    expect(inputs).toEqual(before);
  });
});
