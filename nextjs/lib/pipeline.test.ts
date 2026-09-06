/**
 * The board must never be ahead of the objects.
 *
 * This is the visual surface most likely to drift into optimism: it is a progress display, and
 * every progress display is one careless change away from advancing on a timer. These tests fix
 * the rule that a stage turns `done` only when something exists to prove it, and that a document
 * stopped for review is `held` rather than quietly rolled forward or shown as broken.
 */

import { describe, expect, it } from "vitest";
import { PROCESSING_CEILING_SENTENCE } from "../../shared/intakeCeiling";
import { buildPipeline, summarize, type LocalUpload, type PipelineDocument } from "./pipeline";

function doc(overrides: Partial<PipelineDocument> = {}): PipelineDocument {
  return {
    documentId: "doc-1",
    versionKey: "v1",
    sanitizedKey: null,
    sanitizedSize: null,
    ocrJsonKey: null,
    ocrJsonSize: null,
    hasOcrJson: false,
    cdrReceiptKey: null,
    ocrReviewKey: null,
    processingState: "sanitized",
    ...overrides,
  };
}

function upload(overrides: Partial<LocalUpload> = {}): LocalUpload {
  return {
    localId: "local-1",
    filename: "handbook.pdf",
    bytes: 2 * 1024 * 1024,
    documentId: null,
    phase: "issuing",
    loaded: 0,
    ...overrides,
  };
}

const states = (rows: ReturnType<typeof buildPipeline>) => rows[0].stages.map((s) => s.state);

describe("pipeline board", () => {
  it("shows nothing at all with nothing to show", () => {
    expect(buildPipeline([], null)).toEqual([]);
    expect(buildPipeline([], [])).toEqual([]);
  });

  it("reports the transfer from the browser's own knowledge, before any object exists", () => {
    const rows = buildPipeline([upload({ phase: "sending", loaded: 1024 * 1024 })], []);
    expect(states(rows)).toEqual(["active", "waiting", "waiting", "waiting"]);
    expect(rows[0].stages[0].detail).toContain("50%");
    expect(rows[0].transfer).toEqual({ loaded: 1024 * 1024, total: 2 * 1024 * 1024 });
  });

  it("does not advance past quarantine just because the PUT finished", () => {
    // The bytes are in the bucket. Nothing has sanitized them, and the board must not imply it.
    const rows = buildPipeline([upload({ phase: "stored", documentId: "doc-1", loaded: 2 * 1024 * 1024 })], []);
    expect(states(rows)).toEqual(["done", "active", "waiting", "waiting"]);
  });

  it("marks sanitize done only when an immutable PDF exists", () => {
    const sending = upload({ phase: "stored", documentId: "doc-1" });
    expect(states(buildPipeline([sending], [doc({ sanitizedKey: null })]))).toEqual(["done", "active", "waiting", "waiting"]);
    expect(states(buildPipeline([sending], [doc({ sanitizedKey: "k/sanitized.pdf" })]))).toEqual(["done", "done", "active", "waiting"]);
  });

  it("marks reading done only when ocr.json exists", () => {
    const rows = buildPipeline(
      [upload({ phase: "stored", documentId: "doc-1" })],
      [doc({ sanitizedKey: "k/sanitized.pdf", hasOcrJson: true, ocrJsonKey: "k/ocr.json", ocrJsonSize: 4096, processingState: "ocr_ready" })],
    );
    expect(states(rows)).toEqual(["done", "done", "done", "active"]);
    expect(rows[0].stages[2].detail).toContain("source read");
  });

  it("holds a document stopped for operator review, and carries the reason", () => {
    const rows = buildPipeline(
      [upload({ phase: "stored", documentId: "doc-1" })],
      [doc({ sanitizedKey: "k/sanitized.pdf", processingState: "operator_review", ocrReviewKey: "k/ocr-review.json", ocrReviewReasonCode: "OCR_LOW_TEXT_YIELD" })],
    );
    expect(states(rows)).toEqual(["done", "done", "held", "waiting"]);
    expect(rows[0].stages[2].detail).toContain("review required");
    // A held document is not a failure, and it must never be presented as one.
    expect(rows[0].stages[2].state).not.toBe("failed");
    expect(rows[0].needsPerson).toBe(true);
  });

  it("uses customer-facing review language for a held document", () => {
    const rows = buildPipeline(
      [upload({ phase: "stored", documentId: "doc-1" })],
      [doc({ sanitizedKey: "k/sanitized.pdf", processingState: "operator_review" })],
    );
    expect(rows[0].stages[2].detail).toBe("review required before reading can continue");
  });

  it("marks compile done only for documents actually bound into a candidate", () => {
    const ready = doc({ sanitizedKey: "k/sanitized.pdf", hasOcrJson: true, processingState: "ocr_ready" });
    expect(states(buildPipeline([], [ready], []))).toEqual(["done", "done", "done", "active"]);
    expect(states(buildPipeline([], [ready], ["doc-1"]))).toEqual(["done", "done", "done", "done"]);
    // A different document being compiled must not move this one.
    expect(states(buildPipeline([], [ready], ["doc-2"]))).toEqual(["done", "done", "done", "active"]);
  });

  it("stops the row at a failed transfer and shows the reason verbatim", () => {
    const rows = buildPipeline([upload({ phase: "failed", reason: "quarantine PUT failed (403)" })], []);
    expect(states(rows)).toEqual(["failed", "waiting", "waiting", "waiting"]);
    expect(rows[0].stages[0].detail).toBe("quarantine PUT failed (403)");
  });

  it("shows documents from an earlier session that this browser never uploaded", () => {
    const rows = buildPipeline([], [doc({ documentId: "doc-9", sanitizedKey: "k/sanitized.pdf", hasOcrJson: true, processingState: "ocr_ready" })]);
    expect(rows).toHaveLength(1);
    expect(rows[0].filename).toBeNull();
    expect(rows[0].stages[0].detail).toBe("stored");
  });

  it("does not list a document twice when the local record and the server agree", () => {
    const rows = buildPipeline(
      [upload({ phase: "stored", documentId: "doc-1" })],
      [doc({ documentId: "doc-1", sanitizedKey: "k/sanitized.pdf" })],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].filename).toBe("handbook.pdf");
  });

  it("prefers the version that carries OCR output when a document has several", () => {
    const rows = buildPipeline([], [
      doc({ versionKey: "v1", sanitizedKey: "k1/sanitized.pdf" }),
      doc({ versionKey: "v2", sanitizedKey: "k2/sanitized.pdf", hasOcrJson: true, processingState: "ocr_ready" }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].stages[2].state).toBe("done");
  });

  it("summarizes only what the stages already say", () => {
    const rows = buildPipeline(
      [upload({ localId: "a", documentId: "doc-1", phase: "stored" }), upload({ localId: "b", documentId: "doc-2", phase: "sending", loaded: 10 })],
      [
        doc({ documentId: "doc-1", sanitizedKey: "k/sanitized.pdf", hasOcrJson: true, processingState: "ocr_ready" }),
        doc({ documentId: "doc-3", sanitizedKey: "k/sanitized.pdf", processingState: "operator_review" }),
      ],
    );
    expect(summarize(rows)).toEqual({ total: 3, read: 1, held: 1, sending: 1 });
  });
});

/*
 * The one state the board had no way to show.
 *
 * Every stage was derived from an object existing, which is the right rule and left no way to say
 * "an object will never exist". A source the CDR refuses produces none, so absence of evidence
 * rendered identically to work in progress: PREPARE stayed active forever and the row vanished on
 * reload. These tests fix that a refusal is terminal, is never active, and says why.
 */
describe("a refused source", () => {
  const refusal = {
    reasonCode: "PARSER_OOM",
    observedBytes: 6 * 1024 * 1024,
    occurredAt: "2026-09-06T00:00:00.000Z",
  };

  it("is terminal, and never shows preparation still running", () => {
    const rows = buildPipeline([], [doc({ processingState: "refused", refusal })]);
    expect(states(rows)).toEqual(["done", "failed", "waiting", "waiting"]);
    expect(rows[0].stages.some((stage) => stage.state === "active")).toBe(false);
    expect(rows[0].needsPerson).toBe(false);
  });

  it("says what the customer can do about it, with the live ceiling in the sentence", () => {
    const rows = buildPipeline([], [doc({ processingState: "refused", refusal })]);
    const detail = rows[0].stages[1].detail;
    expect(detail).toContain("6.0 MB");
    expect(detail).toContain(PROCESSING_CEILING_SENTENCE);
  });

  it("keeps the refusal visible for a document this browser never uploaded", () => {
    const rows = buildPipeline([], [doc({ documentId: "doc-9", processingState: "refused", refusal })]);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("doc-9");
    expect(rows[0].stages[1].state).toBe("failed");
  });

  it("joins the refusal to this browser's own upload row instead of listing it twice", () => {
    const rows = buildPipeline(
      [upload({ documentId: "doc-1", phase: "stored", loaded: 6 * 1024 * 1024 })],
      [doc({ documentId: "doc-1", processingState: "refused", refusal })],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].filename).toBe("handbook.pdf");
    expect(rows[0].stages[1].state).toBe("failed");
  });

  it("names a class it does not recognise rather than pretending the source is fine", () => {
    const rows = buildPipeline(
      [],
      [doc({ processingState: "refused", refusal: { ...refusal, reasonCode: "SOMETHING_NEW", observedBytes: null } })],
    );
    expect(rows[0].stages[1].state).toBe("failed");
    expect(rows[0].stages[1].detail).toContain("SOMETHING_NEW");
  });

  it("leaves a document with no refusal exactly as it was", () => {
    const rows = buildPipeline([], [doc({ sanitizedKey: "k/sanitized.pdf" })]);
    expect(states(rows)).toEqual(["done", "done", "active", "waiting"]);
  });
});
