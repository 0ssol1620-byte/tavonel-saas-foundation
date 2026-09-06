import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { PublicSitePage } from "@/components/public-site-chrome";

export const metadata: Metadata = {
  // Each page declares its own address. Without this every route inherited the root
  // canonical ("/"), so a crawler was told 22 distinct pages were all the homepage.
  alternates: { canonical: "/product/document-understanding" },
  openGraph: { url: "/product/document-understanding" },
  title: "Document understanding — TAVONEL",
  description:
    "Reading scans, tables and complex layouts while keeping page geometry and uncertainty for review.",
};

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
  ["READ", "Text, tables and figures", "Native text layers, and scans read as images rather than skipped. Tables keep their cell structure instead of collapsing into a paragraph."],
  ["LOCATION", "The place, kept", "Every region keeps the address of where it was read — in a PDF, the page and the region on it. This is what later lets every compiled fact stay traceable to its exact source location."],
  ["LAYOUT", "Structure recovery", "Headings, sections, columns and reading order are recovered, so a fact attaches to a place in the document rather than an offset in a blob of text."],
  ["UNCERTAINTY", "Doubt is carried forward", "Low-confidence regions stay marked and arrive in review instead of being quietly resolved. A reader that never reports doubt cannot be believed later."],
] as const;

export default function DocumentUnderstandingPage() {
  return (
    <PublicSitePage>
      <section className="scene doc">
        <div className="shell">
          <div className="body">
            <div className="stack">
              <p className="slate"><b>PRODUCT</b><span />DOCUMENT UNDERSTANDING</p>
              <h1 className="document-title">Reading is the first compile step.</h1>
            </div>
            <div className="stack">
              <p className="lede">
                Read scans, tables and complex layouts while retaining page geometry and
                uncertainty for review. The compiler has to recover text, structure and
                coordinates
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
                Supported formats are listed in the <Link href="/docs">documentation</Link>.
                Measurements and methodology are published in the{" "}
                <Link href={"/research/notes" as Route}>research notes</Link>.
              </p>
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
