import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROCESSING_CEILING } from "../../shared/intakeCeiling";
import {
  canAuthorizeCharge,
  canReserveAgainst,
  estimateBillablePages,
  intakePageBasisLabel,
  pageCountLabel,
  pageEstimateConfidence,
  quoteCompilePages,
  quoteIntakeManifest,
  reservationPageCeiling,
  weakestConfidence,
} from "./usage-pricing";

describe("page-based compile pricing", () => {
  it("approves the complete manifest and includes unknown files at the full processing ceiling", () => {
    const pdf = "application/pdf";
    const docx = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const xlsx = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const known = quoteIntakeManifest([{ bytes: 80_000, mimeType: pdf, claimedPages: 4, claimedBasis: "pdf_page_tree" }]);
    expect(known.ok && known.quote.files[0]?.pageBasis).toBe("measured");
    expect(known.ok && known.quote.maximumCredits).toBe(24);

    const staleDocx = quoteIntakeManifest([{ bytes: 80_000, mimeType: docx, claimedPages: 75, claimedBasis: "docx_declared" }]);
    expect(staleDocx.ok && staleDocx.quote.files[0]?.pageBasis).toBe("declared");
    expect(staleDocx.ok && staleDocx.quote.maximumCredits).toBe(450);

    const unknownSheet = quoteIntakeManifest([{ bytes: 80_000, mimeType: xlsx, claimedPages: null, claimedBasis: null }]);
    expect(unknownSheet.ok && unknownSheet.quote.files[0]?.approvedMaxPages).toBe(80);
    expect(unknownSheet.ok && unknownSheet.quote.maximumCredits).toBe(480);

    const mixed = quoteIntakeManifest([
      { bytes: 80_000, mimeType: pdf, claimedPages: 4, claimedBasis: "pdf_page_tree" },
      { bytes: 80_000, mimeType: xlsx, claimedPages: null, claimedBasis: null },
    ]);
    expect(mixed.ok && mixed.quote.maximumPages).toBe(84);
    expect(mixed.ok && mixed.quote.maximumCredits).toBe(504);
  });

  /*
    ADR-0006: a PDF or DOCX is read as page ranges, so a counted one is approved up to 500 pages.
    Nothing else is segmented, and nothing uncounted is approved past one request's 80 pages --
    the database refuses either (20261110041500).
  */
  it("approves a counted PDF or DOCX up to the segmented ceiling, and nothing else past one request", () => {
    const pdf = "application/pdf";
    const docx = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const pptx = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    expect([PROCESSING_CEILING.maxSourcePages, PROCESSING_CEILING.maxUnsegmentedSourcePages]).toEqual([500, 80]);
    const quote = (mimeType: string, claimedPages: number | null, claimedBasis: "pdf_page_tree" | "docx_declared" | "pptx_slides" | null) =>
      quoteIntakeManifest([{ bytes: 80_000, mimeType, claimedPages, claimedBasis }]);

    const longPdf = quote(pdf, 500, "pdf_page_tree");
    expect(longPdf.ok && longPdf.quote.files[0]).toMatchObject({ pageBasis: "measured", approvedMaxPages: 500 });
    const longDocx = quote(docx, 500, "docx_declared");
    expect(longDocx.ok && longDocx.quote.files[0]).toMatchObject({ pageBasis: "declared", approvedMaxPages: 500 });

    expect(quote(pdf, 501, "pdf_page_tree")).toEqual({ ok: false, code: "SOURCE_EXCEEDS_PROCESSING_CEILING", index: 0 });
    expect(quote(docx, 501, "docx_declared")).toEqual({ ok: false, code: "SOURCE_EXCEEDS_PROCESSING_CEILING", index: 0 });
    // Counted, but not segmented: a deck stays at one request's pages.
    expect(quote(pptx, 80, "pptx_slides").ok).toBe(true);
    expect(quote(pptx, 81, "pptx_slides")).toEqual({ ok: false, code: "SOURCE_EXCEEDS_PROCESSING_CEILING", index: 0 });

    // No count: approved at 80 even for a segmented format, never at 500.
    for (const mimeType of [pdf, docx, pptx]) {
      const unknown = quote(mimeType, null, null);
      expect(unknown.ok && unknown.quote.files[0], mimeType).toMatchObject({ pageBasis: "unknown", approvedMaxPages: 80 });
    }
    // A claim borrowed from another format is no count at all.
    const borrowed = quote(pptx, 400, "pdf_page_tree");
    expect(borrowed.ok && borrowed.quote.files[0]).toMatchObject({ pageBasis: "unknown", approvedMaxPages: 80 });
    expect(intakePageBasisLabel("unknown")).toBe("Not counted yet — approved at the 80-page processing ceiling");
  });

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

  it("uses one page for an image", () => {
    expect(estimateBillablePages({ bytes: 8_000_000, mimeType: "image/png" }))
      .toEqual({ pages: 1, basis: "image", confidence: "verified" });
  });

  /*
    The failure path this module exists for: no count, and no number invented to stand in.

    `ceil(bytes / 65,536)` used to answer here, labelled an estimate. The label was honest and
    the number was not -- a 40MB scan and a 40MB text-layer report quoted the same -- so the
    answer is now the absence itself, and every caller has to show it rather than fill it in.
  */
  it.each([
    ["application/pdf"],
    ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ["text/csv"],
    ["application/vnd.oasis.opendocument.spreadsheet"],
    ["text/plain"],
  ])("returns no estimate at all for %s with no counted pages", (mimeType) => {
    expect(estimateBillablePages({ bytes: 8_000_000, mimeType })).toBeNull();
  });

  it("rejects a file whose byte length is not a usable integer", () => {
    expect(estimateBillablePages({ bytes: 0, mimeType: "image/png" })).toBeNull();
    expect(estimateBillablePages({ bytes: 1.5, mimeType: "image/png" })).toBeNull();
  });

  /*
    `provisional` no longer describes a basis, only a set with nothing counted in it -- which is
    exactly the set that may not hold a reservation or close a charge.
  */
  it("refuses to reserve or charge against a set with nothing counted", () => {
    const nothingCounted = weakestConfidence([]);
    expect(nothingCounted).toBe("provisional");
    expect(canAuthorizeCharge({ pages: 0, basis: "pdf_page_tree", confidence: nothingCounted })).toBe(false);
    expect(canReserveAgainst({ pages: 0, basis: "pdf_page_tree", confidence: nothingCounted })).toBe(false);
    expect(pageCountLabel(nothingCounted)).toBe("Pages not counted yet");
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


/*
  The reservation floor, which is a money question and not a page-count question.

  Removing the byte-derived fallback was right -- it put a number derived from file size under a
  heading that said "Pages" -- but it left both server reservation sites on `?? 1`, so an
  uncounted spreadsheet held one page of credit against work that settles at up to the
  rasterizer's page ceiling. These cases pin the direction: a real count is reserved as counted,
  an absent count is reserved at the documented ceiling, and neither is ever presented as a page
  count to a reader.
*/
describe("what an uncounted source reserves", () => {
  const SPREADSHEET = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  it("reserves the deployment's page ceiling when the format states no count", () => {
    expect(estimateBillablePages({ bytes: 2_000_000, mimeType: SPREADSHEET })).toBeNull();
    expect(reservationPageCeiling({ bytes: 2_000_000, mimeType: SPREADSHEET }))
      .toBe(PROCESSING_CEILING.maxUnsegmentedSourcePages);
    // Not one page, which is what both call sites held before this.
    expect(reservationPageCeiling({ bytes: 2_000_000, mimeType: SPREADSHEET })).toBeGreaterThan(1);
  });

  it("reserves a counted source at its count, and an image at one page", () => {
    expect(reservationPageCeiling({
      bytes: 131_073, mimeType: "application/pdf", declaredPages: 9, declaredBasis: "pdf_page_tree",
    })).toBe(9);
    expect(reservationPageCeiling({ bytes: 40_000, mimeType: "image/png" })).toBe(1);
  });

  it("reserves nothing above the ceiling for a source that cannot be read at all", () => {
    // An unreadable request (zero bytes) still gets a bounded hold rather than an unbounded one.
    expect(reservationPageCeiling({ bytes: 0, mimeType: SPREADSHEET }))
      .toBe(PROCESSING_CEILING.maxUnsegmentedSourcePages);
  });

  /*
    Both server call sites, asserted as call sites. The upload capability reserves the approved
    per-file quote, bound to the pricing fingerprint the customer approved; with the approval
    lineage off (legacyCapability, main's path) it reserves the ceiling, as the connector import
    does. Neither may go back to the `?? 1` that was once identical in both files.
  */
  it("is what the unapproved call site uses, the approved one reserves its quote, and neither falls back to one page", () => {
    const code = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");
    const capability = code("../app/api/uploads/capability/route.ts");
    const sourceImport = code("./source-import.ts");

    const legacyAt = capability.indexOf("async function legacyCapability(");
    expect(legacyAt).toBeGreaterThan(0);
    const approvedPath = capability.slice(0, legacyAt);
    const legacyPath = capability.slice(legacyAt);

    const approvedCall = approvedPath.match(/\breserveFoundationIntakeApprovedFile\(\{([^}]*)\}\)/);
    expect(approvedCall).not.toBeNull();
    expect(approvedCall![1]).toMatch(/\bpricingFingerprint\b/);
    expect(approvedPath).not.toContain("reservationPageCeiling(");
    expect(legacyPath).toContain("reservationPageCeiling(");
    expect(legacyPath).not.toContain("reserveFoundationIntakeApprovedFile(");

    expect(sourceImport).toContain("reservationPageCeiling(");

    for (const source of [capability, sourceImport]) {
      expect(source).not.toContain("?.pages ?? 1");
    }
  });

  it("is never shown as a page count: an uncounted set still refuses to reserve or charge", () => {
    expect(pageCountLabel("provisional")).toBe("Pages not counted yet");
    expect(canReserveAgainst({ pages: PROCESSING_CEILING.maxSourcePages, basis: "docx_declared", confidence: "provisional" }))
      .toBe(false);
    expect(canAuthorizeCharge({ pages: PROCESSING_CEILING.maxSourcePages, basis: "docx_declared", confidence: "provisional" }))
      .toBe(false);
  });
});
