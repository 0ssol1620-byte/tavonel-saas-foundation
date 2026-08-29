/**
 * The reading, as the browser receives it.
 *
 * The progress object is written by the CDR worker while the OCR worker streams pages back. It is
 * mutable, it expires, and it is explicitly not evidence -- `ocr.json` is the record. This module
 * validates it before anything is drawn from it, for the ordinary reason that it arrives over the
 * network, and for a specific one: a viewer that trusts these numbers would happily draw a page
 * count of 40 for a document with 3 pages, and that is a lie the product cannot afford.
 *
 * Nothing here reads or exposes document text. The stream deliberately does not carry it.
 */

export type ProgressBox = {
  /** [x0, y0, x1, y1] in a 0-1000 space, so it can be drawn without knowing the page size. */
  bbox1000: [number, number, number, number];
  confidence: number;
};

export type ProgressPage = {
  pageNumber1: number;
  pageCount: number;
  path: string;
  regionCount: number;
  meanConfidence: number;
  boxes: ProgressBox[];
};

export type OcrProgress = {
  state: "reading" | "read" | "refused";
  pagesRead: number;
  pageCount: number | null;
  regionsFound: number;
  pages: ProgressPage[];
};

const SCHEMA = "tavonel.ocr_progress.v1";

function number(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : null;
}

function qualifyPage(value: unknown): ProgressPage | null {
  if (!value || typeof value !== "object") return null;
  const page = value as Record<string, unknown>;
  const pageCount = number(page.pageCount, 1, 100_000);
  const pageNumber1 = number(page.pageNumber1, 1, 100_000);
  const regionCount = number(page.regionCount, 0, 1_000_000);
  const meanConfidence = number(page.meanConfidence, 0, 1);
  if (pageCount === null || pageNumber1 === null || regionCount === null || meanConfidence === null) return null;
  if (pageNumber1 > pageCount) return null;
  const boxes = Array.isArray(page.boxes) ? page.boxes : [];
  return {
    pageNumber1,
    pageCount,
    path: typeof page.path === "string" ? page.path : "",
    regionCount,
    meanConfidence,
    boxes: boxes.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const box = entry as Record<string, unknown>;
      const bbox = Array.isArray(box.bbox1000) ? box.bbox1000 : [];
      if (bbox.length !== 4) return [];
      const values = bbox.map((v) => number(v, 0, 1000));
      if (values.some((v) => v === null)) return [];
      const [x0, y0, x1, y1] = values as number[];
      // A box that is inverted or empty cannot be drawn honestly, so it is not drawn at all.
      if (x1 <= x0 || y1 <= y0) return [];
      return [{ bbox1000: [x0, y0, x1, y1] as [number, number, number, number], confidence: number(box.confidence, 0, 1) ?? 0 }];
    }),
  };
}

/** Returns null for anything that is not a progress document this version understands. */
export function qualifyProgress(value: unknown): OcrProgress | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (body.schemaVersion !== SCHEMA) return null;
  if (body.state !== "reading" && body.state !== "read" && body.state !== "refused") return null;
  const pagesRead = number(body.pagesRead, 0, 100_000);
  const regionsFound = number(body.regionsFound, 0, 1_000_000);
  if (pagesRead === null || regionsFound === null) return null;
  const pageCount = body.pageCount === null ? null : number(body.pageCount, 1, 100_000);
  if (body.pageCount !== null && pageCount === null) return null;
  // Reading more pages than the document has is not a display problem, it is a broken report.
  if (pageCount !== null && pagesRead > pageCount) return null;
  const pages = (Array.isArray(body.pages) ? body.pages : []).flatMap((page) => {
    const qualified = qualifyPage(page);
    return qualified ? [qualified] : [];
  });
  return { state: body.state, pagesRead, pageCount, regionsFound, pages };
}

/** The page to draw: the latest one reported. Null when nothing has been read yet. */
export function currentPage(progress: OcrProgress): ProgressPage | null {
  return progress.pages.length > 0 ? progress.pages[progress.pages.length - 1] : null;
}

/**
 * How far through the document the read is, as a fraction.
 *
 * Returns null rather than a guess when the page count is unknown. A bar that fills without
 * knowing what it is filling toward is the exact thing this product does not do.
 */
export function readFraction(progress: OcrProgress): number | null {
  if (progress.pageCount === null || progress.pageCount <= 0) return null;
  return Math.min(1, progress.pagesRead / progress.pageCount);
}
