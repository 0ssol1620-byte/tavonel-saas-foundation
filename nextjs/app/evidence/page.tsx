import type { Metadata } from "next";
import Link from "next/link";
import Logomark from "@/components/logomark";
import { EVIDENCE, EVIDENCE_STATE } from "@/lib/evidence-record";

export const metadata: Metadata = {
  // Each page declares its own address. Without this every route inherited the root
  // canonical ("/"), so a crawler was told 22 distinct pages were all the homepage.
  alternates: { canonical: "/evidence" },
  openGraph: { url: "/evidence" },
  title: "What we measured — TAVONEL",
  description:
    "The source boundary TAVONEL enforces and the product evidence available for inspection.",
};

/**
 * D1 -- the evidence record, out of the demonstration and onto a page of its own.
 *
 * On the landing page this was scene 07: four boundary controls and four findings, sitting
 * between a live demonstration and a price list. It was the most convincing material on the
 * site and the worst-placed, because it answers a question nobody asks until they have already
 * decided the product might be real. The landing page now makes the claim in one line and links
 * here; this page is where the claim is honoured.
 *
 * It is a static server component on purpose. There is nothing here to interact with, nothing to
 * animate and nothing to fetch: a reader who followed a link that said "we publish what failed"
 * should get the list, immediately, with no ceremony in front of it.
 */
export default function EvidencePage() {
  return (
    <div className="page">
      <header className="nav" data-stuck={1}>
        <Link href="/" className="wordmark" aria-label="TAVONEL home">
          <Logomark />
          <b>TAVONEL</b>
        </Link>
        <nav className="links">
          <Link href="/">Back to the compiler</Link>
        </nav>
        <Link className="btn small" href="/login">Sign in</Link>
      </header>

      <main id="main" tabIndex={-1}>
        <section className="scene doc">
          <div className="shell">
            <div className="body">
              <div className="stack">
                <p className="slate"><b>RECORD</b><span />EVIDENCE &amp; BOUNDARY</p>
                <h2>Follow product results<br />back to their source.</h2>
              </div>
              <div className="stack">
                <p className="lede">
                  TAVONEL keeps the document boundary, processing receipts, compiled evidence, and
                  source coordinates inspectable. Product previews are labeled where they appear;
                  operational records remain tied to the system that produced them.
                </p>

                <p className="slate"><span />WHAT WE MEASURED, AND WHAT WE DID NOT</p>
                <div className="tiles">
                  {EVIDENCE.map(([state, title, body]) => (
                    <article className="tile" key={title} data-state={state}>
                      <span className="n">{EVIDENCE_STATE[state]}</span>
                      <h3>{title}</h3>
                      <p>{body}</p>
                    </article>
                  ))}
                </div>
                <p className="fine">
                  Each state names the evidence currently available. Technical detail stays here
                  so the main product journey can remain focused without obscuring the boundary.
                </p>

                <div className="actions">
                  <Link className="btn" href="/security">Where your documents go</Link>
                  <Link className="btn ghost" href="/#s5">See what access is open</Link>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="site">
        <div className="shell">
          <span className="wordmark"><Logomark /><b>TAVONEL</b></span>
          <p className="fine">
            Inspect source boundaries, reproducibility material, and deployment status from their
            dedicated records.
          </p>
        </div>
      </footer>
    </div>
  );
}
