/**
 * The board must never be ahead of the objects.
 *
 * This is the visual surface most likely to drift into optimism: it is a progress display, and
 * every progress display is one careless change away from advancing on a timer. These tests fix
 * the rule that a stage turns `done` only when something exists to prove it, and that a document
 * stopped for review is `held` rather than quietly rolled forward or shown as broken.
 */

import { describe, expect, it } from "vitest";
import type { DocumentListItem } from "./immutable-keys";
import { buildPipeline, summarize, type LocalUpload } from "./pipeline";

function doc(overrides: Partial<DocumentListItem> = {}): DocumentListItem {
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
    expect(rows[0].stages[2].detail).toContain("ocr.json");
  });

  it("holds a document stopped for operator review, and carries the reason", () => {
    const rows = buildPipeline(
      [upload({ phase: "stored", documentId: "doc-1" })],
      [doc({ sanitizedKey: "k/sanitized.pdf", processingState: "operator_review", ocrReviewKey: "k/ocr-review.json", ocrReviewReasonCode: "OCR_LOW_TEXT_YIELD" })],
    );
    expect(states(rows)).toEqual(["done", "done", "held", "waiting"]);
    expect(rows[0].stages[2].detail).toContain("OCR_LOW_TEXT_YIELD");
    // A held document is not a failure, and it must never be presented as one.
    expect(rows[0].stages[2].state).not.toBe("failed");
    expect(rows[0].needsPerson).toBe(true);
  });

  it("never offers an automatic retry for a held document", () => {
    const rows = buildPipeline(
      [upload({ phase: "stored", documentId: "doc-1" })],
      [doc({ sanitizedKey: "k/sanitized.pdf", processingState: "operator_review" })],
    );
    expect(rows[0].stages[2].detail).toContain("no automatic paid retry");
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
