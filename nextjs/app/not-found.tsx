/**
 * 404.
 *
 * Without this file Next serves its own: "404 | This page could not be found" centred on a bare
 * page, with no wordmark and no way back. A visitor who mistypes a URL lands somewhere that looks
 * like a different site than the one they were reading.
 */

import Link from "next/link";
import type { Metadata } from "next";
import Logomark from "@/components/logomark";

export const metadata: Metadata = { title: "Not found — TAVONEL" };

export default function NotFound() {
  return (
    <main id="main" className="auth" tabIndex={-1}>
      <header>
        <Link href="/" className="wordmark"><Logomark /><b>TAVONEL</b></Link>
        <span className="mode"><i aria-hidden="true" />PRIVATE PILOT</span>
      </header>

      <div className="auth-body">
        <div className="auth-card">
          <p className="eyebrow">404</p>
          <h1>There is nothing at this address.</h1>
          <p className="lead">
            The link may be out of date, or the page may never have existed. Nothing is wrong with
            your account and nothing has been changed.
          </p>
          <div className="auth-actions">
            <Link className="btn" href="/">Back to the site</Link>
            <Link className="btn ghost" href="/workspace">Open your workspace</Link>
          </div>
        </div>
      </div>
    </main>
  );
}
