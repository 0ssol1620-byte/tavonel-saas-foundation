export const PROCESSING_UNIT_USD = 0.01;
export const STANDARD_UNITS_PER_PAGE = 4;
export const MAX_UNITS_PER_PAGE = 6;
export const MAX_QUOTED_PAGES = 10_000;

export type CompileQuote = {
  pages: number;
  standardUnits: number;
  maximumUnits: number;
  estimatedUsd: number;
  maximumUsd: number;
};

/**
 * How a page count was arrived at, and therefore what may be said about it.
 *
 * A PDF that does not declare a page count falls back to `ceil(bytes / 65,536)`. That number is
 * a defensible spend ceiling and a terrible fact: it is derived from file size and has no
 * relationship to how many pages the document has. It was reaching the customer under the
 * heading "Pages", next to a dollar figure they were being asked to authorise.
 *
 * A byte-derived count is `provisional` and must be labelled as an estimate wherever it is
 * shown. Only a count read out of the document itself — a declared page count, or one image
 * being one page — is `verified` and may carry a final authorisation.
 */
export type PageEstimateBasis = "image" | "declared" | "byte_upper_bound";
export type PageEstimateConfidence = "provisional" | "verified";

export type PageEstimate = {
  pages: number;
  basis: PageEstimateBasis;
  confidence: PageEstimateConfidence;
};

export function pageEstimateConfidence(basis: PageEstimateBasis): PageEstimateConfidence {
  return basis === "byte_upper_bound" ? "provisional" : "verified";
}

/** The heading a page count is allowed to appear under, given how it was derived. */
export function pageCountLabel(confidence: PageEstimateConfidence) {
  return confidence === "verified" ? "Verified pages" : "Estimated pages";
}

/** True when this count may back a final charge authorisation rather than a preview. */
export function canAuthorizeCharge(estimate: PageEstimate) {
  return estimate.confidence === "verified";
}

export function quoteCompilePages(pages: number): CompileQuote | null {
  if (!Number.isSafeInteger(pages) || pages < 1 || pages > MAX_QUOTED_PAGES) return null;
  const standardUnits = pages * STANDARD_UNITS_PER_PAGE;
  const maximumUnits = pages * MAX_UNITS_PER_PAGE;
  return {
    pages,
    standardUnits,
    maximumUnits,
    estimatedUsd: standardUnits * PROCESSING_UNIT_USD,
    maximumUsd: maximumUnits * PROCESSING_UNIT_USD,
  };
}

export function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

export function estimateBillablePages(value: {
  bytes: number;
  mimeType: string;
  declaredPages?: number | null;
}): PageEstimate | null {
  if (!Number.isSafeInteger(value.bytes) || value.bytes < 1) return null;
  if (value.declaredPages && Number.isSafeInteger(value.declaredPages)
    && value.declaredPages >= 1 && value.declaredPages <= MAX_QUOTED_PAGES) {
    return { pages: value.declaredPages, basis: "declared", confidence: "verified" };
  }
  if (value.mimeType.toLowerCase().startsWith("image/")) {
    return { pages: 1, basis: "image", confidence: "verified" };
  }
  return {
    pages: Math.min(MAX_QUOTED_PAGES, Math.max(1, Math.ceil(value.bytes / 65_536))),
    basis: "byte_upper_bound",
    confidence: "provisional",
  };
}

