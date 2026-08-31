import type { Metadata } from "next";
import Link from "next/link";
import Logomark from "@/components/logomark";

export const metadata: Metadata = {
  // Each page declares its own address. Without this every route inherited the root
  // canonical ("/"), so a crawler was told 22 distinct pages were all the homepage.
  alternates: { canonical: "/product/document-understanding" },
  openGraph: { url: "/product/document-understanding" },
  title: "Document understanding — TAVONEL",
  description:
    "The compiler recovers text, layout and structure from documents and scans before knowledge is compiled.",
};

const PARTS = [
  ["MEASURED", "Document reading", "GPU OCR path, layout recovery and scan quality on declared corpora. Failures stay in the record."],
  ["SCANS", "Pages without a text layer", "A scan is read as an image, not skipped. Uncertainty is reported rather than filled in."],
  ["LAYOUT", "Structure recovery", "Headings, tables and regions have to be recovered before a fact can be attached to a place on the page."],
  ["UNCERTAINTY", "Doubt is part of the read", "Low-confidence regions stay marked. A reader that never reports doubt cannot be believed later."],
] as const;

export default function DocumentUnderstandingPage() {
  return (
    <div className="page">
      <header className="nav" data-stuck={1}>
        <Link href="/" className="wordmark" aria-label="TAVONEL home">
          <Logomark />
          <b>TAVONEL</b>
        </Link>
        <nav aria-label="Sections">
          <Link href="/product">Product</Link>
          <Link href="/research">Research</Link>
          <Link href="/evidence">Evidence</Link>
        </nav>
        <Link className="btn small" href="/login">Sign in</Link>
      </header>
      <main id="main">
        <section className="scene doc">
          <div className="shell">
            <div className="body">
              <div className="stack">
                <p className="slate"><b>PRODUCT</b><span />DOCUMENT UNDERSTANDING</p>
                <h2>Reading is the first compile step.</h2>
              </div>
              <div className="stack">
                <p className="lede">
                  Files arrive as PDFs, scans, spreadsheets, pages and repositories.
                  The compiler has to recover text, layout and structure
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
                  Measured results and failures live on <Link href="/research">/research</Link> and <Link href="/evidence">/evidence</Link>.
                  This page does not publish a closed accuracy number.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
