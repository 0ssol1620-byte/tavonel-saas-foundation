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

export type PageEstimate = {
  pages: number;
  basis: "image" | "declared" | "byte_upper_bound";
};

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
    return { pages: value.declaredPages, basis: "declared" };
  }
  if (value.mimeType.toLowerCase().startsWith("image/")) return { pages: 1, basis: "image" };
  return {
    pages: Math.min(MAX_QUOTED_PAGES, Math.max(1, Math.ceil(value.bytes / 65_536))),
    basis: "byte_upper_bound",
  };
}

