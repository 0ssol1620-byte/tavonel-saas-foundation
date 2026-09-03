import { unzipSync } from "fflate";

/*
  How many pages this file really has, before anyone is quoted for it.

  The preflight panel used to divide the file size by 64KB. That is an upper bound, and it was
  labelled as one, but it is a bad number to show somebody who is deciding whether to spend
  money: a 40MB scanned brochure and a 40MB text-layer report quote the same and bill nothing
  like the same. Masterplan 4 asks for the real count where the format states one.

  The rule this module follows is the repository's, not a convenience: never invent data to
  satisfy a schema. Where a format does not state a page count, this returns null with a
  reason, and the caller falls back to the byte bound and says so. It does not guess.
*/

export type MeasuredPages = {
  pages: number;
  /** Where the number came from, so the UI can say it and a receipt can cite it. */
  basis: "pdf_page_tree" | "image" | "pptx_slides" | "docx_declared";
};

export type UnmeasuredPages = {
  pages: null;
  reason:
    | "DOCX_PAGE_COUNT_NOT_DECLARED"
    | "XLSX_BILLABLE_UNIT_UNDECIDED"
    | "FORMAT_DOES_NOT_STATE_PAGES"
    | "FILE_UNREADABLE";
};

export type PageCountResult = MeasuredPages | UnmeasuredPages;

/** Guards a hostile archive: an OOXML file is a ZIP, and a ZIP can be a bomb. */
const MAX_OOXML_BYTES = 64 * 1024 * 1024;

/*
  A spreadsheet has no pages, and nobody has decided what it is billed in.

  A sheet is not a page, a print area is not a page, and the rendered pagination depends on
  settings the file may not carry. Masterplan 4 leaves the billable unit for XLSX to the
  founder, so this refuses to produce a number rather than picking one that would immediately
  become the number customers were charged.
*/
export function countXlsxPages(): UnmeasuredPages {
  return { pages: null, reason: "XLSX_BILLABLE_UNIT_UNDECIDED" };
}

/** Slides, counted from the package rather than inferred. */
export function countPptxSlides(bytes: Uint8Array): PageCountResult {
  if (bytes.byteLength > MAX_OOXML_BYTES) return { pages: null, reason: "FILE_UNREADABLE" };
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, { filter: (file) => /^ppt\/slides\/slide\d+\.xml$/i.test(file.name) });
  } catch {
    return { pages: null, reason: "FILE_UNREADABLE" };
  }
  const slides = Object.keys(entries).length;
  if (slides < 1) return { pages: null, reason: "FORMAT_DOES_NOT_STATE_PAGES" };
  return { pages: slides, basis: "pptx_slides" };
}

/*
  Word's own page count, if Word wrote one.

  There is no page count in a .docx in any structural sense -- pagination is a property of a
  rendering, and the file describes a document. What `docProps/app.xml` carries is the count
  from the last application that saved it, which is exactly the "page equivalent" a customer
  means when they look at the file. When it is absent (a generated document, a converter that
  did not write app.xml) there is nothing here to read, and this says so.
*/
export function countDocxPages(bytes: Uint8Array): PageCountResult {
  if (bytes.byteLength > MAX_OOXML_BYTES) return { pages: null, reason: "FILE_UNREADABLE" };
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, { filter: (file) => file.name.toLowerCase() === "docprops/app.xml" });
  } catch {
    return { pages: null, reason: "FILE_UNREADABLE" };
  }
  const app = Object.values(entries)[0];
  if (!app) return { pages: null, reason: "DOCX_PAGE_COUNT_NOT_DECLARED" };
  const match = new TextDecoder().decode(app).match(/<Pages>(\d+)<\/Pages>/i);
  const pages = match ? Number(match[1]) : NaN;
  if (!Number.isSafeInteger(pages) || pages < 1) return { pages: null, reason: "DOCX_PAGE_COUNT_NOT_DECLARED" };
  return { pages, basis: "docx_declared" };
}

export type PdfPageReader = (bytes: Uint8Array) => Promise<number | null>;

/**
 * pdf.js, loaded only when a PDF is actually present.
 *
 * Reading the page tree is all this needs, so the fetch and stream options are off: a local
 * File is already in memory and there is nothing to stream. The document is destroyed
 * immediately, because holding 128 of them open to learn 128 integers is how a preflight of a
 * folder becomes a tab crash.
 */
export const readPdfPageCount: PdfPageReader = async (bytes) => {
  try {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
    const task = pdfjs.getDocument({ data: bytes, disableAutoFetch: true, disableStream: true });
    const document = await task.promise;
    const pages = document.numPages;
    await task.destroy();
    return Number.isSafeInteger(pages) && pages >= 1 ? pages : null;
  } catch {
    return null;
  }
};

const OOXML = {
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
} as const;

export type PageCountInput = {
  mimeType: string;
  name: string;
  bytes: () => Promise<Uint8Array>;
};

/**
 * The real page count for one file, or an honest null.
 *
 * `readPdf` is injectable so this can be exercised without a PDF engine; production passes
 * `readPdfPageCount` and nothing else ever should.
 */
export async function measurePages(
  input: PageCountInput,
  readPdf: PdfPageReader = readPdfPageCount,
): Promise<PageCountResult> {
  const mime = input.mimeType.toLowerCase();
  const name = input.name.toLowerCase();

  // One image is one page, and this was already true before the format-aware pass. It is here
  // so every answer comes from one place.
  if (mime.startsWith("image/")) return { pages: 1, basis: "image" };

  if (mime === "application/pdf" || name.endsWith(".pdf")) {
    const pages = await readPdf(await input.bytes());
    return pages === null ? { pages: null, reason: "FILE_UNREADABLE" } : { pages, basis: "pdf_page_tree" };
  }

  const kind = OOXML[mime as keyof typeof OOXML]
    ?? (name.endsWith(".pptx") ? "pptx" : name.endsWith(".docx") ? "docx" : name.endsWith(".xlsx") ? "xlsx" : null);
  if (kind === "xlsx") return countXlsxPages();
  if (kind === "pptx") return countPptxSlides(await input.bytes());
  if (kind === "docx") return countDocxPages(await input.bytes());

  // ODF, plain text and anything else. A format that does not state a page count gets the
  // byte bound from the pricing module, clearly labelled as an upper bound.
  return { pages: null, reason: "FORMAT_DOES_NOT_STATE_PAGES" };
}

/**
 * Measure a whole selection without freezing the tab.
 *
 * Bounded because each PDF costs a page-tree parse and a folder drop can be 128 of them, and
 * yielding between batches because a preflight that locks the UI for six seconds reads as a
 * crash. Nothing here fails the selection: a file that cannot be measured is quoted from its
 * size, which is what happened to every file before this existed.
 */
export async function measureSelection(
  inputs: readonly PageCountInput[],
  options: { concurrency?: number; readPdf?: PdfPageReader; onProgress?: (done: number) => void } = {},
): Promise<PageCountResult[]> {
  const concurrency = Math.max(1, options.concurrency ?? 4);
  const results = new Array<PageCountResult>(inputs.length);
  let cursor = 0;
  let done = 0;

  const run = async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= inputs.length) return;
      try {
        results[index] = await measurePages(inputs[index], options.readPdf ?? readPdfPageCount);
      } catch {
        results[index] = { pages: null, reason: "FILE_UNREADABLE" };
      }
      done += 1;
      options.onProgress?.(done);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, inputs.length) }, run));
  return results;
}
