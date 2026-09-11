import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { PublicSitePage } from "@/components/public-site-chrome";
import BreadcrumbJsonLd from "@/components/breadcrumb-json-ld";
import { CAPABILITY_MANIFEST, isAcceptedAtUpload } from "../../../../shared/capabilityManifest";

export const metadata: Metadata = {
  // Each page declares its own address. Without this every route inherited the root
  // canonical ("/"), so a crawler was told 22 distinct pages were all the homepage.
  alternates: { canonical: "/product/document-understanding" },
  openGraph: { url: "/product/document-understanding" },
  title: "Document understanding — TAVONEL",
  description:
    "Reading scans and complex layouts while keeping the location of every region and the uncertainty around it for review.",
};

/*
  What the READ and LAYOUT cards say is read off the capability manifest, not written here.

  Audit M01. This page published "Tables keep their cell structure instead of collapsing into a
  paragraph" as a present-tense product fact while `shared/capabilityManifest.ts` -- the one list
  the upload route validates against, /sources prints and the compile request is built from --
  said every row preserves three things and carried `no_table_or_formula_extraction` as a known
  limitation of all of them. A page and a manifest disagreeing about the same deployment is the
  failure class the manifest exists to end, so the claim is derived from it here rather than
  restated beside it.

  The same pass took the LAYOUT card off "Headings, sections, columns and reading order are
  recovered". Nothing typed survives the read: what reaches the compiler is a paragraph of text
  and where on the page it sat. Reading order in that sequence is real and worth saying;
  recovered document structure is not, and was the second sentence here the manifest contradicted.
*/
const READING = CAPABILITY_MANIFEST.entries.find((entry) => entry.mime === "application/pdf");
if (!READING) {
  // Fail closed rather than fall back to prose: a page that cannot read the manifest must not
  // describe the reader from memory.
  throw new Error("capability manifest has no application/pdf entry; the READ card cannot be derived");
}

/*
  One phrase per preserved field, and a build error for a field with no phrase.

  A `?? field` fallback here would publish `bbox1000` to a reader, or -- worse -- quietly leave a
  newly preserved field out of a sentence that still claims to be the whole of what survives.
*/
const PRESERVED_PHRASE: Record<string, string> = {
  page: "the page it was read from",
  paragraph_text: "the paragraph text",
  bbox1000: "the box that paragraph sat in",
};
const PRESERVED = READING.preserved.map((field) => {
  const phrase = PRESERVED_PHRASE[field];
  if (!phrase) throw new Error(`capability manifest preserves "${field}" with no phrase on this page`);
  return phrase;
});
const PRESERVED_SENTENCE = PRESERVED.length > 1
  ? `${PRESERVED.slice(0, -1).join(", ")} and ${PRESERVED.at(-1)}`
  : PRESERVED[0]!;

const NO_TABLE_EXTRACTION = READING.knownLimitations.includes("no_table_or_formula_extraction");
const NO_STRUCTURE_READER = READING.knownLimitations.includes("no_native_structure_reader_yet");

/** The Office and OpenDocument formats the manifest accepts, every one of them through PDF. */
const OFFICE = CAPABILITY_MANIFEST.entries
  .filter((entry) => isAcceptedAtUpload(entry.status)
    && entry.mime !== "application/pdf"
    && ["document", "spreadsheet", "presentation"].includes(entry.sourceFamily)
    && (entry.knownLimitations as readonly string[]).includes("converted_to_pdf_before_reading"))
  .flatMap((entry) => entry.extensions.map((extension) => extension.toUpperCase()));
const OFFICE_SENTENCE = `${OFFICE.slice(0, -1).join(", ")} and ${OFFICE.at(-1)}`;

const READ_BODY = [
  "Native text layers are read, and a scan is read as an image rather than skipped.",
  `What survives that read into the compile is ${PRESERVED_SENTENCE} — after the file has been sanitized to PDF and passed through OCR.`,
  NO_TABLE_EXTRACTION
    ? "Structured tables and formulas are not extracted yet: a price table arrives as the paragraphs it was printed as, each with the box it sat in, so the figures are readable and the grid that arranged them is not."
    : "Structured tables and formulas are extracted, and the manifest names the fields that survive.",
  `${OFFICE_SENTENCE} are converted to PDF before anything reads them.`,
].join(" ");

const LAYOUT_BODY = [
  "Regions arrive in the order they were read, so a fact attaches to a place in the document rather than to an offset in a blob of text.",
  NO_STRUCTURE_READER
    ? "Typed document structure — heading levels, sections, columns — is not recovered on this deployment: there is no native structure reader yet, and what the compiler receives is a paragraph and where it sat."
    : "Heading levels, sections and columns are recovered as typed structure.",
  "The full list, per format, is the capability manifest.",
].join(" ");

/*
  Research states are a property of results, not of product capabilities.

  These cards were badged MEASURED / SCANS / LAYOUT / UNCERTAINTY, and the page closed with
  "Failures stay in the record" and "This page does not publish a closed accuracy number" —
  telling a prospect what they will not be given before telling them what they will. The
  measurements and their caveats are published in full at /research/notes and linked from here,
  which is the honest arrangement: the finding keeps its page, the product page describes the
  product.
*/
const PARTS = [
  ["READ", "Text, scans, and what survives them", READ_BODY],
  ["LOCATION", "The place, kept", "Every region keeps the address of where it was read — in a PDF, the page and the box on it. This is what later lets every compiled fact stay traceable to its exact source location."],
  ["LAYOUT", "Reading order, not recovered structure", LAYOUT_BODY],
  ["UNCERTAINTY", "Doubt is carried forward", "Low-confidence regions stay marked and arrive in review instead of being quietly resolved. A reader that never reports doubt cannot be believed later."],
] as const;

export default function DocumentUnderstandingPage() {
  return (
    <PublicSitePage>
      <BreadcrumbJsonLd trail={[{ name: "Product", path: "/product" }, { name: "Document understanding", path: "/product/document-understanding" }]} />
      <section className="scene doc">
        <div className="shell">
          <div className="body">
            <div className="stack">
              <p className="slate"><b>PRODUCT</b><span />DOCUMENT UNDERSTANDING</p>
              <h1 className="document-title">Reading is the first compile step.</h1>
            </div>
            <div className="stack">
              <p className="lede">
                Read scans and complex layouts while retaining the location of every region and
                the uncertainty around it. The compiler has to recover text and coordinates
                <b> before anything can be compiled into a world.</b>
              </p>
              <div className="tiles">
                {PARTS.map(([state, title, body]) => (
                  <article className="tile" key={title}>
                    <span className="n">{state}</span>
                    <h3>{title}</h3>
                    <p>{body}</p>
                  </article>
                ))}
              </div>
              <p className="fine">
                Every sentence above about what is read comes from the capability manifest this
                deployment validates uploads against — tier, preserved fields and limitations per
                format, published in full at{" "}
                <Link href={"/sources" as Route}>supported sources</Link>. Measurements and
                methodology are published in the{" "}
                <Link href={"/research/notes" as Route}>research notes</Link>.
              </p>
              <div className="actions">
                <Link className="btn" href={"/explore" as Route}>See a page and its regions</Link>
                <Link className="btn ghost" href={"/sources" as Route}>What this deployment reads</Link>
                <Link className="btn ghost" href="/knowledge-compiler">What happens after the read</Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </PublicSitePage>
  );
}
