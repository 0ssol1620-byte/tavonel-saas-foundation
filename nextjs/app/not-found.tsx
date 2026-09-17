/**
 * 404.
 *
 * Without this file Next serves its own: "404 | This page could not be found" centred on a bare
 * page, with no wordmark and no way back. A visitor who mistypes a URL lands somewhere that looks
 * like a different site than the one they were reading.
 *
 * G2-030 -- it now lands on the site instead of on an island. What stood here was the auth shell:
 * no nav, no footer, no search, two buttons, and one of them ("Open your workspace") offered an
 * anonymous visitor a sign-in wall as the way out of a mistyped URL. The standard header and
 * footer are the recovery -- every section is one click away in the nav the visitor already knows
 * -- and the four tiles below are the destinations a broken or expired TAVONEL link is most often
 * reaching for. No new CSS: `scene doc` / `shell` / `body` / `stack` / `tiles` is the layout every
 * document page on this site already uses, and a 404 is not the page to invent a fifth one on.
 *
 * G2-029 -- and it stops claiming to be the homepage. The root layout declares `canonical: "/"`
 * as the safety net for pages that declare none, and this page declared none, so every junk URL
 * anyone ever linked was telling a crawler its content is the homepage's. `canonical: null`
 * removes the tag rather than pointing it somewhere else: one component answers for every
 * unmatched path, so there is no address to self-canonicalise to, and a 404 that prefers no
 * address is exactly right. Title, description and share card are its own for the same reason --
 * a dead link unfurling in Slack as the homepage's pitch is a preview that lies about where it
 * goes.
 */

import Link from "next/link";
import type { Metadata } from "next";
import { PublicSitePage } from "@/components/public-site-chrome";

export const metadata: Metadata = {
  title: "Not found — TAVONEL",
  description:
    "There is nothing at this address. The link may be out of date, or the page may never have existed — here is the way back into the site.",
  alternates: { canonical: null },
  // The 404 status is what decides indexing; this states the same thing for the crawlers that
  // read the tag rather than the status line, and keeps `follow` so the recovery links are walked.
  robots: { index: false, follow: true },
  openGraph: {
    title: "Not found — TAVONEL",
    description: "There is nothing at this address.",
    type: "website",
  },
};

/** The four places a broken or expired TAVONEL link is most often trying to reach. */
const RECOVERY = [
  ["Product", "What a Knowledge Compiler does, and what comes out of one.", "/product"],
  ["Documentation", "Quickstart, concepts, the API contract, error codes and limits.", "/docs"],
  ["Pricing", "Plans and measured compute, with the gates stated before you buy.", "/pricing"],
  ["Trust Center", "The data path, the processors, the legal terms and the open questions.", "/trust"],
] as const;

export default function NotFound() {
  return (
    <PublicSitePage>
      <section className="scene doc">
        <div className="shell">
          <div className="body">
            <div className="stack">
              <h1 className="document-title">There is nothing at this address.</h1>
            </div>
            <div className="stack">
              <p className="lede">
                The link may be out of date, or the page may never have existed. Nothing is wrong
                with your account, and nothing has been changed.
              </p>
              <h2>Where you might have been going</h2>
              <div className="tiles">
                {RECOVERY.map(([title, body, href]) => (
                  <Link className="tile trust-link" key={href} href={href}>
                    <h3>{title}</h3>
                    <p>{body}</p>
                  </Link>
                ))}
              </div>
              <p className="fine">
                Still stuck? <Link href="/contact">Tell us what you were looking for</Link> and we
                will point you at it.
              </p>
            </div>
          </div>
        </div>
      </section>
    </PublicSitePage>
  );
}
