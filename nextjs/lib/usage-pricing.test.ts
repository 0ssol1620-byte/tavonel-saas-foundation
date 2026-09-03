import { describe, expect, it } from "vitest";
import {
  canAuthorizeCharge,
  estimateBillablePages,
  pageCountLabel,
  quoteCompilePages,
} from "./usage-pricing";

describe("page-based compile pricing", () => {
  it("quotes standard and hard maximum usage in pages and dollars", () => {
    expect(quoteCompilePages(348)).toEqual({
      pages: 348,
      standardUnits: 1_392,
      maximumUnits: 2_088,
      estimatedUsd: 13.92,
      maximumUsd: 20.88,
    });
  });

  it.each([0, -1, 10_001, 1.5, Number.NaN])("rejects an invalid page count: %s", (pages) => {
    expect(quoteCompilePages(pages)).toBeNull();
  });

  it("uses one page for an image and a conservative byte bound otherwise", () => {
    expect(estimateBillablePages({ bytes: 8_000_000, mimeType: "image/png" }))
      .toEqual({ pages: 1, basis: "image", confidence: "verified" });
    expect(estimateBillablePages({ bytes: 131_073, mimeType: "application/pdf" }))
      .toEqual({ pages: 3, basis: "byte_upper_bound", confidence: "provisional" });
  });

  /*
    The byte bound is a spend ceiling, not a page count. It is the only basis derived from file
    size rather than read from the document, so it must never be presented under a heading that
    asserts a fact, and must never back a final charge authorisation.
  */
  it("refuses to call a byte-derived count verified", () => {
    const bytes = estimateBillablePages({ bytes: 131_073, mimeType: "application/pdf" })!;
    expect(bytes.confidence).toBe("provisional");
    expect(canAuthorizeCharge(bytes)).toBe(false);
    expect(pageCountLabel(bytes.confidence)).toBe("Estimated pages");
  });

  it("treats a declared page count as verified and chargeable", () => {
    const declared = estimateBillablePages({
      bytes: 131_073,
      mimeType: "application/pdf",
      declaredPages: 9,
    })!;
    expect(declared).toEqual({ pages: 9, basis: "declared", confidence: "verified" });
    expect(canAuthorizeCharge(declared)).toBe(true);
    expect(pageCountLabel(declared.confidence)).toBe("Verified pages");
  });
});

