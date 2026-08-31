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
    "The document boundary this deployment enforces, and our own record of what has been measured, what failed, and what has only been built.",
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
                <h2>What we enforce,<br />and what we actually measured.</h2>
              </div>
              <div className="stack">
                <p className="lede">
                  Everything on the front page is a demonstration. Nothing here is. There are no
                  customer logos anywhere on this site and no certifications &mdash; a brand rule
                  bars them without registered evidence &mdash; so this is our own record instead,
                  <b> including the part of it that did not work.</b>
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
                  Two of the four entries above are things that did not work or are not proven.
                  That ratio is the point. A record that only listed the wins would be a claim
                  about our marketing rather than about our engineering, and it would tell you
                  nothing you could check.
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
            Nothing on this page is a demonstration. The staged sequence, and the disclosure that
            goes with it, is on the front page. No customer, certification or competitor
            comparison is represented anywhere on this site, and no performance claim beyond the
            two measurements above.
          </p>
        </div>
      </footer>
    </div>
  );
}
