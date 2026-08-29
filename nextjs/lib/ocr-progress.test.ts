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
  boxes: [{ bbox1000: [100, 100, 900, 140], confidence: 0.9 }],
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

  it("never surfaces document text, because the report does not carry it", () => {
    const progress = qualifyProgress(body({ pages: [page({ text: "SECRET CONTRACT TEXT" })] }));
    expect(JSON.stringify(progress)).not.toContain("SECRET CONTRACT TEXT");
  });
});
