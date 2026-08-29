/**
 * The reader must refuse a report it cannot draw honestly.
 *
 * A progress object is the only mutable thing in a workspace built entirely out of immutable
 * ones, and it is the input to the most persuasive screen in the product. That combination is
 * exactly where an overclaim would come from: a page count that does not match, a box outside the
 * page, a fraction invented because the total was unknown. Each of those is refused here.
 */

import { describe, expect, it } from "vitest";
import { currentPage, qualifyProgress, readFraction } from "./ocr-progress";

const page = (over: Record<string, unknown> = {}) => ({
  schemaVersion: "tavonel.ocr_progress.v1",
  type: "page",
  pageNumber1: 1,
  pageCount: 3,
  path: "raster",
  regionCount: 2,
  meanConfidence: 0.8,
  boxes: [{ bbox1000: [100, 100, 900, 140], confidence: 0.9, text: "제3조 (계약기간)", regionId: "ocr-p0001-l00001" }],
  ...over,
});

const body = (over: Record<string, unknown> = {}) => ({
  schemaVersion: "tavonel.ocr_progress.v1",
  sourceImmutableKey: "immutable/ws/doc/v/sanitized.pdf",
  inputSha256: `sha256:${"a".repeat(64)}`,
  state: "reading",
  pagesRead: 1,
  pageCount: 3,
  regionsFound: 2,
  pages: [page()],
  ...over,
});

describe("ocr progress", () => {
  it("accepts a well-formed report", () => {
    const progress = qualifyProgress(body());
    expect(progress).not.toBeNull();
    expect(progress!.pagesRead).toBe(1);
    expect(currentPage(progress!)!.boxes).toHaveLength(1);
  });

  it("refuses anything that is not this schema", () => {
    for (const value of [null, undefined, 42, "reading", {}, body({ schemaVersion: "tavonel.ocr_progress.v2" })]) {
      expect(qualifyProgress(value)).toBeNull();
    }
  });

  it("refuses a report claiming more pages read than the document has", () => {
    expect(qualifyProgress(body({ pagesRead: 9, pageCount: 3 }))).toBeNull();
  });

  it("refuses a page numbered beyond its own page count", () => {
    const progress = qualifyProgress(body({ pages: [page({ pageNumber1: 7, pageCount: 3 })] }));
    // The document still qualifies; the page inside it does not, so it is simply not drawn.
    expect(progress).not.toBeNull();
    expect(progress!.pages).toHaveLength(0);
  });

  it("refuses a state it does not understand", () => {
    expect(qualifyProgress(body({ state: "finished" }))).toBeNull();
    expect(qualifyProgress(body({ state: "refused" }))).not.toBeNull();
  });

  it("drops boxes that cannot be drawn honestly", () => {
    const cases = [
      { bbox1000: [100, 100, 90, 200], confidence: 0.9 },   // inverted on x
      { bbox1000: [100, 200, 900, 200], confidence: 0.9 },  // zero height
      { bbox1000: [100, 100, 1200, 200], confidence: 0.9 }, // outside the 0-1000 space
      { bbox1000: [100, 100, 900], confidence: 0.9 },       // not four numbers
      { bbox1000: "100,100,900,200", confidence: 0.9 },     // not an array
    ];
    const progress = qualifyProgress(body({ pages: [page({ boxes: cases })] }));
    expect(progress!.pages[0].boxes).toHaveLength(0);
  });

  it("clamps a confidence it is given but keeps the box", () => {
    const progress = qualifyProgress(body({ pages: [page({ boxes: [{ bbox1000: [1, 1, 2, 2], confidence: 5 }] })] }));
    expect(progress!.pages[0].boxes[0].confidence).toBe(0);
  });

  it("returns no fraction at all when the page count is unknown", () => {
    const progress = qualifyProgress(body({ pageCount: null, pagesRead: 4 }));
    expect(progress).not.toBeNull();
    // Not 0, not 1, not a guess. Nothing.
    expect(readFraction(progress!)).toBeNull();
  });

  it("computes the fraction from the report, and never exceeds one", () => {
    expect(readFraction(qualifyProgress(body({ pagesRead: 1, pageCount: 4 }))!)).toBe(0.25);
    expect(readFraction(qualifyProgress(body({ pagesRead: 3, pageCount: 3 }))!)).toBe(1);
  });

  it("draws the most recent page", () => {
    const progress = qualifyProgress(body({
      pagesRead: 2,
      pages: [page({ pageNumber1: 1 }), page({ pageNumber1: 2 })],
    }));
    expect(currentPage(progress!)!.pageNumber1).toBe(2);
  });

  it("has no page to draw before anything has been read", () => {
    const progress = qualifyProgress(body({ pagesRead: 0, pages: [] }));
    expect(currentPage(progress!)).toBeNull();
  });

  /*
   * This replaces a test that asserted text was never present.
   *
   * Carrying the line is the point of the view: a page of boxes with no words is a diagram, and
   * what a person needs to see is their own document being understood. It is safe because the
   * object reaches the browser from the bucket on a signed URL, and the /api route that hands out
   * that URL never opens the object. What still bounds this is the worker side: a rolling page
   * window, a truncated line, and `ocr.json` as the only create-once record. What is checked here
   * is narrower and still worth checking -- that a line is never invented and never unbounded.
   */
  it("keeps the line that was read, trimmed for display", () => {
    const progress = qualifyProgress(body());
    expect(progress!.pages[0].boxes[0].text).toBe("제3조 (계약기간)");
    expect(progress!.pages[0].boxes[0].regionId).toBe("ocr-p0001-l00001");
  });

  it("never invents a line the reader did not report", () => {
    const progress = qualifyProgress(body({
      pages: [page({ boxes: [{ bbox1000: [1, 1, 999, 40], confidence: 0.5 }] })],
    }));
    expect(progress!.pages[0].boxes[0].text).toBe("");
  });

  it("truncates a line rather than rendering an unbounded string", () => {
    const progress = qualifyProgress(body({
      pages: [page({ boxes: [{ bbox1000: [1, 1, 999, 40], confidence: 0.9, text: "가".repeat(2000) }] })],
    }));
    expect(progress!.pages[0].boxes[0].text).toHaveLength(400);
  });
});
