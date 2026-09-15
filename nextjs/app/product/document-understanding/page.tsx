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
if (OFFICE.length === 0) {
  // Fail closed like the missing-phrase branch above: a manifest that accepts no
  // convert-to-PDF format makes this clause a claim about formats the deployment does not take,
  // and an empty join would print " and undefined are converted ..." on a public page.
  throw new Error("capability manifest accepts no converted Office/ODF format; this sentence cannot be derived");
}
const OFFICE_CLAUSE = OFFICE.length > 1
  ? `${OFFICE.slice(0, -1).join(", ")} and ${OFFICE.at(-1)} are converted to PDF before anything reads them.`
  : `${OFFICE[0]} is converted to PDF before anything reads it.`;

/*
  BA-014. Every branch reads forwards, and the fact in it is untouched.

  Three of the four cards opened on an absence: LAYOUT was titled "Reading order, not recovered
  structure", UNCERTAINTY followed "Doubt is carried forward" with a clause saying the doubt
  "does not route anything", and the two switches below printed "are not extracted yet" and "is
  not recovered on this deployment" in the middle of the page that answers what a reader does
  get. Honest, and written like an apology.

  What changed is the order and the subject of each sentence. Both switches are still read from
  the manifest, and both branches still say what the read does not recover -- a price table's
  grid, a heading level -- because that is a property of the read a buyer has to know before
  they compile a spreadsheet, and `product-claims-sync.test.ts` requires the claim to be derived
  from the manifest in either state. The per-format table those limits belong to is /sources,
  which prints `knownLimitations` for every accepted MIME type and is linked in the footnote
  below the cards.
*/
const READ_BODY = [
  // There is no native text read on any path: the CDR rasterizes every accepted source, and
  // test_office_conversion.py asserts the sanitized output has no extractable text at all.
  "Every accepted source is sanitized to an image-only PDF and read by OCR, so a scan is read the same way a born-digital file is.",
  `What survives that read into the compile is ${PRESERVED_SENTENCE} — after the file has been sanitized to PDF and passed through OCR.`,
  NO_TABLE_EXTRACTION
    ? "A price table arrives as the paragraphs it was printed as, each carrying the box it sat in, so every figure stays readable and locatable while the grid that arranged them is not yet recovered."
    : "Structured tables and formulas are extracted, and the manifest names the fields that survive.",
  OFFICE_CLAUSE,
].join(" ");

const LAYOUT_BODY = [
  "Regions arrive in the order they were read, so a fact attaches to a place in the document rather than to an offset in a blob of text.",
  NO_STRUCTURE_READER
    ? "What the compiler receives is that paragraph and where it sat, rather than typed structure: heading levels, sections and columns wait for a native structure reader."
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
  ["LAYOUT", "Read in the order it was printed", LAYOUT_BODY],
  // "arrive in review" was not supported: ocr-review.json is written only when the read fails,
  // and no threshold on confidence routes anything. The confidence is recorded, and that is all.
  // BA-014 keeps both halves of that and leads with the one a reader can use: the confidence
  // travels with the region it belongs to, and a failed read opens review rather than passing.
  ["UNCERTAINTY", "Confidence travels with the region", "Every region carries the read confidence recorded for it in the OCR output, and a failed read opens review rather than passing silently. No threshold routes on that confidence — it is recorded, and a reader that never reports doubt cannot be believed later."],
] as const;

export default function DocumentUnderstandingPage() {
  return (
    <PublicSitePage>
      <BreadcrumbJsonLd trail={[{ name: "Product", path: "/product" }, { name: "Document understanding", path: "/product/document-understanding" }]} />
      <section className="scene doc">
        <div className="shell">
          <div className="body">
            <div className="stack">
              {/* BA-026. The trail BreadcrumbJsonLd already declares, rendered for the reader. */}
              <p className="doc-breadcrumb"><Link href={"/product" as Route}>Product</Link> <span aria-hidden="true">/</span> Document understanding</p>
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
                    {/*
                      BA-025. h2, not h3: the four cards are the first sections under the h1, and
                      an h3 here left the outline h1 -> h3 so the page could not be walked by
                      heading. `.tiles .tile h2` keeps the card treatment.
                    */}
                    <h2>{title}</h2>
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
              {/*
                BA-019. Two actions, not three. The third pointed at /sources, which the footnote
                directly above already offers as "supported sources" -- the same destination
                twice in two adjacent elements, with the button competing with the primary.
              */}
              <div className="actions">
                <Link className="btn" href={"/explore" as Route}>See a page and its regions</Link>
                <Link className="btn ghost" href="/knowledge-compiler">What happens after the read</Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </PublicSitePage>
  );
}
