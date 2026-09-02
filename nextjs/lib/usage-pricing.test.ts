import { describe, expect, it } from "vitest";
import { estimateBillablePages, quoteCompilePages } from "./usage-pricing";

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
    expect(estimateBillablePages({ bytes: 8_000_000, mimeType: "image/png" })).toEqual({ pages: 1, basis: "image" });
    expect(estimateBillablePages({ bytes: 131_073, mimeType: "application/pdf" })).toEqual({ pages: 3, basis: "byte_upper_bound" });
  });
});

