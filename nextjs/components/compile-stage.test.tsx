import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import CompileStage from "./compile-stage";
import type { PipelineRow } from "@/lib/pipeline";
import { clearSourceVersionUnavailable, filterPollableSourceVersions, markSourceVersionUnavailable, pruneUnavailableSourceVersions, type OcrProgress } from "@/lib/ocr-progress";

const row = (id: string): PipelineRow => ({
  id,
  filename: `${id}.pdf`,
  transfer: null,
  stages: [
    { key: "quarantine", label: "UPLOAD", state: "done", detail: "" },
    { key: "sanitize", label: "PREPARE", state: "done", detail: "" },
    { key: "read", label: "READ", state: "active", detail: "" },
    { key: "compile", label: "COMPILE", state: "waiting", detail: "" },
  ],
  needsPerson: false,
  observedAt: null,
});

const digest = "a".repeat(64);
const sourceFor = (documentId: string, versionKey = digest) => `immutable/pilot-test/pilot-test/${documentId}/${versionKey}/sanitized.pdf`;

const progress = (text: string, documentId = "reused", versionKey = digest): OcrProgress => ({
  documentId,
  versionKey,
  sourceImmutableKey: sourceFor(documentId, versionKey),
  sourceSha256: `sha256:${versionKey}`,
  state: "read",
  pagesRead: 1,
  pageCount: 1,
  regionsFound: 1,
  pages: [{
    pageNumber1: 1,
    pageCount: 1,
    path: "page-1.json",
    regionCount: 1,
    meanConfidence: 0.98,
    boxes: [{ bbox1000: [10, 10, 900, 80], confidence: 0.98, text, regionId: "region-1" }],
  }],
});

const retainedReading: Record<string, OcrProgress> = {
  reused: progress("private old OCR text"),
  removed: progress("text from a source removed in run B"),
};

const observation = (documentId: string, text: string, versionKey = digest) => ({
  documentId,
  versionKey,
  sourceImmutableKey: sourceFor(documentId, versionKey),
  sourceSha256: `sha256:${versionKey}`,
  pdfBytes: new Uint8Array([37, 80, 68, 70]),
  progress: progress(text, documentId, versionKey),
});

describe("compile stage separates durable run state from source-version observations", () => {
  it("drops retained text for reused and removed IDs when the run changes", () => {
    const runA = renderToStaticMarkup(
      <CompileStage rows={[row("reused"), row("removed")]} reading={retainedReading} state="reading"
        sourceObservation={observation("reused", "OCR text for source version A")}
        selectedSourceVersion={{ documentId: "reused", versionKey: digest }}
        runProgress={{ jobId: "run-A", documentsTotal: 2, documentsReady: 1 }} />,
    );
    const runB = renderToStaticMarkup(
      <CompileStage rows={[row("reused")]} reading={retainedReading} state="reading"
        runProgress={{ jobId: "run-B", documentsTotal: 1, documentsReady: 0 }} />,
    );

    expect(runA).toContain('data-run-id="run-A"');
    expect(runA).toContain("<dd>2</dd>");
    expect(runA).toContain("<dd>1</dd>");
    expect(runA).not.toContain("private old OCR text");
    expect(runA).toContain("OCR text for source version A");
    expect(runA).toContain("not a compile-run record");
    expect(runA).toContain(`data-source-version="${digest}"`);
    expect(runB).toContain('data-run-id="run-B"');
    expect(runB).toContain("<dd>1</dd>");
    expect(runB).toContain("<dd>0</dd>");
    expect(runB).toContain("Original preview unavailable");
    expect(runB).not.toContain("private old OCR text");
    expect(runB).not.toContain("text from a source removed in run B");
    expect(runB).not.toContain("Observed pages");
    expect(runB).not.toContain("Observed regions");
  });

  it("shows an authorized source page with no OCR overlay when no bound stream is available", () => {
    const markup = renderToStaticMarkup(
      <CompileStage rows={[row("reused")]} state="reading" sourceObservation={{ ...observation("reused", ""), progress: null }}
        selectedSourceVersion={{ documentId: "reused", versionKey: digest }} />,
    );
    expect(markup).toContain("Page stream unavailable");
    expect(markup).toContain("No source-bound page stream is available");
    expect(markup).not.toContain("Empty OCR line");
  });

  it("reports JSON completion from the durable source state without simulating page progress", () => {
    const markup = renderToStaticMarkup(
      <CompileStage rows={[row("reused")]} state="reading" sourceObservation={{ ...observation("reused", ""), progress: null }}
        selectedSourceVersion={{ documentId: "reused", versionKey: digest }} selectedSourceState="ocr_ready" />,
    );
    expect(markup).toContain("OCR record ready");
    expect(markup).toContain("The immutable OCR result is ready");
    expect(markup).not.toContain("Observed pages");
  });

  it("withholds an old version even when the document ID is unchanged", () => {
    const newerVersion = "b".repeat(64);
    const markup = renderToStaticMarkup(
      <CompileStage rows={[row("reused")]} state="reading" sourceObservation={observation("reused", "old version text")}
        selectedSourceVersion={{ documentId: "reused", versionKey: newerVersion }} />,
    );
    expect(markup).toContain('data-visual="none"');
    expect(markup).not.toContain('data-source-id="reused"');
    expect(markup).not.toContain("old version text");
  });

  it("resumes polling after version A returns 404 and shows only version B when it arrives", () => {
    const documentId = "reused";
    const versionA = digest;
    const versionB = "b".repeat(64);
    const unavailable = new Map<string, string>();
    const sourceA = { documentId, versionKey: versionA };
    const sourceB = { documentId, versionKey: versionB };

    // The exact version A 404 excludes A only. When inventory advances for the same ID,
    // version B is pollable and the old marker is discarded.
    markSourceVersionUnavailable(unavailable, sourceA);
    expect(filterPollableSourceVersions([sourceA], unavailable)).toEqual([]);
    pruneUnavailableSourceVersions(unavailable, [sourceB]);
    expect(unavailable.has(documentId)).toBe(false);
    expect(filterPollableSourceVersions([sourceB], unavailable)).toEqual([sourceB]);

    // An empty B response must leave B on the interval; a successful B observation can
    // then render, while retained A content remains incompatible with the selected version.
    expect(filterPollableSourceVersions([sourceB], unavailable)).toEqual([sourceB]);
    const beforeB = renderToStaticMarkup(
      <CompileStage rows={[row(documentId)]} state="reading"
        sourceObservation={observation(documentId, "private OCR from version A", versionA)}
        selectedSourceVersion={sourceB} />,
    );
    expect(beforeB).toContain('data-visual="none"');
    expect(beforeB).not.toContain('data-source-id="reused"');
    expect(beforeB).not.toContain("private OCR from version A");

    markSourceVersionUnavailable(unavailable, sourceB);
    clearSourceVersionUnavailable(unavailable, sourceB);
    expect(filterPollableSourceVersions([sourceB], unavailable)).toEqual([sourceB]);
    const afterB = renderToStaticMarkup(
      <CompileStage rows={[row(documentId)]} state="reading"
        sourceObservation={observation(documentId, "OCR from version B", versionB)}
        selectedSourceVersion={sourceB} />,
    );
    expect(afterB).toContain("OCR from version B");
    expect(afterB).not.toContain("private OCR from version A");
  });

  it("does not render source-linked OCR if the preview descriptor carries another digest", () => {
    const wrongDigest = "b".repeat(64);
    const markup = renderToStaticMarkup(
      <CompileStage rows={[row("reused")]} state="reading"
        sourceObservation={{ ...observation("reused", "must not show"), sourceSha256: `sha256:${wrongDigest}` }}
        selectedSourceVersion={{ documentId: "reused", versionKey: digest }} />,
    );
    expect(markup).toContain('data-visual="none"');
    expect(markup).not.toContain('data-source-id="reused"');
    expect(markup).not.toContain("must not show");
  });

  it("keeps attention and stopped stage states", () => {
    const attention = renderToStaticMarkup(
      <CompileStage rows={[row("reused")]} state="review_required"
        runProgress={{ jobId: "run-A", documentsTotal: 1, documentsReady: 1 }} />,
    );
    const stopped = renderToStaticMarkup(
      <CompileStage rows={[row("reused")]} state="failed"
        runProgress={{ jobId: "run-A", documentsTotal: 1, documentsReady: 0 }} />,
    );

    expect(attention).toContain('data-state="attention"');
    expect(stopped).toContain('data-state="stopped"');
    expect(stopped).toContain('role="status"');
    expect(stopped).toContain('aria-label="Compilation stages"');
  });
});
