import { describe, expect, it } from "vitest";
import {
  canAuthorizeCharge,
  canReserveAgainst,
  estimateBillablePages,
  pageCountLabel,
  pageEstimateConfidence,
  quoteCompilePages,
  weakestConfidence,
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
    expect(canReserveAgainst(bytes)).toBe(false);
    expect(pageCountLabel(bytes.confidence)).toBe("Estimated page-equivalents");
  });

  it("treats a counted page tree as verified and chargeable", () => {
    const counted = estimateBillablePages({
      bytes: 131_073,
      mimeType: "application/pdf",
      declaredPages: 9,
      declaredBasis: "pdf_page_tree",
    })!;
    expect(counted).toEqual({ pages: 9, basis: "pdf_page_tree", confidence: "verified" });
    expect(canAuthorizeCharge(counted)).toBe(true);
    expect(pageCountLabel(counted.confidence)).toBe("Verified pages");
  });

  /*
    The distinction this pair exists for.

    Both are "a page count read out of the file". One was counted; the other is the number Word
    wrote the last time it saved, about a rendering that is not the one that will happen. They
    were the same value -- basis "declared", confidence "verified" -- so a stale count appeared
    under the heading "Verified pages" beside a dollar figure the customer was authorising.
  */
  it("will not call a Word file's saved page count verified", () => {
    const docx = estimateBillablePages({
      bytes: 131_073,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      declaredPages: 9,
      declaredBasis: "docx_declared",
    })!;
    expect(docx).toEqual({ pages: 9, basis: "docx_declared", confidence: "declared" });
    expect(pageCountLabel(docx.confidence)).toBe("Declared pages");
  });

  it("lets a declared count hold a reservation but not close the charge", () => {
    const docx = estimateBillablePages({
      bytes: 131_073,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      declaredPages: 9,
      declaredBasis: "docx_declared",
    })!;
    // A reservation is a ceiling being held; settlement is a measurement being billed.
    expect(canReserveAgainst(docx)).toBe(true);
    expect(canAuthorizeCharge(docx)).toBe(false);
  });

  it("does not grant verified to a caller that did not say where its count came from", () => {
    const unattributed = estimateBillablePages({
      bytes: 131_073, mimeType: "application/pdf", declaredPages: 9,
    })!;
    expect(unattributed.confidence).toBe("declared");
    expect(canAuthorizeCharge(unattributed)).toBe(false);
  });

  it.each([
    ["pdf_page_tree", "verified"],
    ["image", "verified"],
    ["pptx_slides", "verified"],
    ["docx_declared", "declared"],
    ["byte_upper_bound", "provisional"],
  ] as const)("maps %s to %s", (basis, confidence) => {
    expect(pageEstimateConfidence(basis)).toBe(confidence);
  });

  it("takes the weakest confidence in a mixed selection", () => {
    expect(weakestConfidence(["verified", "verified"])).toBe("verified");
    expect(weakestConfidence(["verified", "declared"])).toBe("declared");
    expect(weakestConfidence(["declared", "provisional"])).toBe("provisional");
    expect(weakestConfidence([])).toBe("provisional");
  });
});

