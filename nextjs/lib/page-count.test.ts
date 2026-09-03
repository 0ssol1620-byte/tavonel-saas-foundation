import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  countDocxPages,
  countPptxSlides,
  countXlsxPages,
  measurePages,
  measureSelection,
} from "./page-count";

/*
  Page counts, and the counts this refuses to produce.

  The second half is the one worth having. Every format here could be given a plausible number
  -- a sheet could be called a page, a byte count could be divided by something -- and the
  moment one is, it becomes the number a customer is charged. So the assertions below are as
  much about the nulls as the integers.
*/

const encode = (text: string) => new TextEncoder().encode(text);

function pptx(slides: number) {
  const files: Record<string, Uint8Array> = { "[Content_Types].xml": encode("<Types/>") };
  for (let index = 1; index <= slides; index += 1) {
    files[`ppt/slides/slide${index}.xml`] = encode("<p:sld/>");
  }
  // Layouts and masters are also XML under ppt/ and must not be counted as slides.
  files["ppt/slideLayouts/slideLayout1.xml"] = encode("<p:sldLayout/>");
  files["ppt/slideMasters/slideMaster1.xml"] = encode("<p:sldMaster/>");
  return zipSync(files);
}

function docx(pages: number | null) {
  const files: Record<string, Uint8Array> = { "word/document.xml": encode("<w:document/>") };
  if (pages !== null) {
    files["docProps/app.xml"] = encode(`<Properties><Pages>${pages}</Pages><Words>120</Words></Properties>`);
  }
  return zipSync(files);
}

describe("counting what the format actually states", () => {
  it("counts slides, not every XML part in the package", () => {
    expect(countPptxSlides(pptx(14))).toEqual({ pages: 14, basis: "pptx_slides" });
  });

  it("reads the page count Word wrote", () => {
    expect(countDocxPages(docx(37))).toEqual({ pages: 37, basis: "docx_declared" });
  });

  it("says so when a .docx never declared one", () => {
    // A generated document, or a converter that did not write app.xml. There is no page count
    // in a .docx in any structural sense, so there is nothing to fall back to but honesty.
    expect(countDocxPages(docx(null))).toEqual({ pages: null, reason: "DOCX_PAGE_COUNT_NOT_DECLARED" });
  });

  it("refuses to decide what a spreadsheet is billed in", () => {
    expect(countXlsxPages()).toEqual({ pages: null, reason: "XLSX_BILLABLE_UNIT_UNDECIDED" });
  });

  it("treats a corrupt package as unreadable rather than as zero pages", () => {
    const result = countPptxSlides(encode("this is not a zip"));
    expect(result.pages).toBeNull();
  });
});

describe("measuring one file", () => {
  const bytesOf = (data: Uint8Array) => async () => data;

  it("counts an image as one page", async () => {
    const result = await measurePages({ mimeType: "image/png", name: "scan.png", bytes: bytesOf(encode("x")) });
    expect(result).toEqual({ pages: 1, basis: "image" });
  });

  it("asks the PDF engine for the page tree", async () => {
    const result = await measurePages(
      { mimeType: "application/pdf", name: "report.pdf", bytes: bytesOf(encode("%PDF")) },
      async () => 412,
    );
    expect(result).toEqual({ pages: 412, basis: "pdf_page_tree" });
  });

  it("does not fall back to a size guess when a PDF cannot be parsed", async () => {
    const result = await measurePages(
      { mimeType: "application/pdf", name: "broken.pdf", bytes: bytesOf(encode("not a pdf")) },
      async () => null,
    );
    expect(result).toEqual({ pages: null, reason: "FILE_UNREADABLE" });
  });

  it("routes by extension when the browser reported no MIME type", async () => {
    const result = await measurePages({ mimeType: "", name: "deck.pptx", bytes: bytesOf(pptx(3)) });
    expect(result).toEqual({ pages: 3, basis: "pptx_slides" });
  });

  it("leaves a format that states no page count to the byte bound", async () => {
    const result = await measurePages({ mimeType: "application/vnd.oasis.opendocument.text", name: "notes.odt", bytes: bytesOf(encode("x")) });
    expect(result).toEqual({ pages: null, reason: "FORMAT_DOES_NOT_STATE_PAGES" });
  });
});

describe("measuring a whole selection", () => {
  it("keeps results in the order the files were staged", async () => {
    const inputs = [
      { mimeType: "image/png", name: "a.png", bytes: async () => encode("x") },
      { mimeType: "", name: "b.pptx", bytes: async () => pptx(9) },
      { mimeType: "", name: "c.xlsx", bytes: async () => encode("x") },
      { mimeType: "application/pdf", name: "d.pdf", bytes: async () => encode("%PDF") },
    ];
    const results = await measureSelection(inputs, { concurrency: 3, readPdf: async () => 5 });
    // Order matters because the caller zips these against the staged file list by index.
    expect(results.map((entry) => entry.pages)).toEqual([1, 9, null, 5]);
  });

  it("does not let one unreadable file fail the preflight", async () => {
    // An image answers without reading anything, which is why the failing file here is a
    // format that has to be opened.
    const inputs = [
      { mimeType: "image/png", name: "a.png", bytes: async () => encode("x") },
      { mimeType: "", name: "b.pptx", bytes: async () => { throw new Error("read failed"); } },
    ];
    const results = await measureSelection(inputs);
    expect(results[0].pages).toBe(1);
    expect(results[1]).toEqual({ pages: null, reason: "FILE_UNREADABLE" });
  });

  it("reports progress so a folder of 128 files is not a frozen panel", async () => {
    const seen: number[] = [];
    await measureSelection(
      Array.from({ length: 6 }, (_, index) => ({
        mimeType: "image/png",
        name: `${index}.png`,
        bytes: async () => encode("x"),
      })),
      { concurrency: 2, onProgress: (done) => seen.push(done) },
    );
    expect(seen.at(-1)).toBe(6);
  });
});
