"use client";

/**
 * The error boundary.
 *
 * Without this, a render-time exception produces "Application error: a client-side exception has
 * occurred" -- a sentence that tells a person nothing except that something is broken, and which
 * on a product handling their documents reads far worse than it is.
 *
 * So the copy answers the question they actually have, which is not "what failed" but "what did
 * this do to my data". On this product the answer is genuinely reassuring and worth stating: the
 * surface that broke is a reader. Uploaded documents are immutable, credits move only on a signed
 * webhook, and nothing is promoted without a human decision -- so a failure here cannot have
 * changed any of them.
 */

import Link from "next/link";
import { useEffect } from "react";
import Logomark from "@/components/logomark";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest is the only handle on this failure in the server logs, so it goes to the console
    // where a pilot user can be asked to read it back.
    console.error("Render failed", error.digest ?? "", error);
  }, [error]);

  /*
    BQ-136. The same page shape as app/not-found.tsx, which is the other page a reader lands
    on when something did not work.

    This rendered inside `.auth` -- the sign-in shell: a centred card with a wordmark and
    nothing else, so a render failure on a documentation page looked like being logged out.
    The 404 was moved off that shell for the same reason (G2-030) and onto the document
    layout every public page uses, and these two pages are read by the same person on the
    same bad afternoon. They look like one thing now.

    What it does not take from the 404 is the navigation. An error boundary can be rendering
    precisely because something in the chrome threw, and a recovery page that re-renders the
    failing component is not a recovery. The wordmark is a plain link home, which is the one
    piece of navigation that cannot fail.
  */
  return (
    <div className="page">
      <header className="nav" data-stuck={1}>
        <Link href="/" className="wordmark" aria-label="TAVONEL home"><Logomark /><b>TAVONEL</b></Link>
      </header>

      <main id="main" tabIndex={-1}>
        <section className="scene doc">
          <div className="shell">
            <div className="body">
              <div className="stack">
                <h1 className="document-title">This page stopped rendering.</h1>
              </div>
              <div className="stack">
                <p className="lede">
                  The failure is in the screen, not in your data. Uploaded documents are
                  immutable, usage changes only when a signed event is persisted, and nothing
                  is activated into a live world without a person deciding it &mdash; none of
                  which a rendering failure can reach.
                </p>
                <div className="actions">
                  <button className="btn" type="button" onClick={reset}>Try again</button>
                  <Link className="btn ghost" href="/">Back to the site</Link>
                </div>
                {error.digest ? (
                  <p className="fine">
                    Reference <code>{error.digest}</code>. Quote it if you report the problem
                    &mdash; it identifies this exact failure in the server log.
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
