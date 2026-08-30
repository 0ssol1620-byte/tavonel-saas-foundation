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

  return (
    <main id="main" className="auth">
      <header>
        <Link href="/" className="wordmark"><Logomark /><b>TAVONEL</b></Link>
        <span className="mode"><i aria-hidden="true" />FOUNDATION MODE</span>
      </header>

      <div className="auth-body">
        <div className="auth-card">
          <p className="eyebrow">SOMETHING FAILED</p>
          <h1>This page stopped rendering.</h1>
          <p className="lead">
            The failure is in the screen, not in your data. Uploaded documents are immutable,
            credits change only when a signed webhook is persisted, and nothing is promoted into a
            live world without a person deciding it &mdash; none of which a rendering failure can
            reach.
          </p>

          <div className="auth-actions">
            <button className="btn" type="button" onClick={reset}>Try again</button>
            <Link className="btn ghost" href="/">Back to the site</Link>
          </div>

          {error.digest ? (
            <p className="notice static" role="status">
              <strong>Reference {error.digest}.</strong> Quote this if you report the problem
              &mdash; it identifies this exact failure in the server log.
            </p>
          ) : null}
        </div>
      </div>
    </main>
  );
}
