import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { PublicSitePage } from "@/components/public-site-chrome";

export const metadata: Metadata = {
  // Each page declares its own address. Without this every route inherited the root
  // canonical ("/"), so a crawler was told 22 distinct pages were all the homepage.
  alternates: { canonical: "/evidence" },
  openGraph: { url: "/evidence" },
  title: "Technical evidence — TAVONEL",
  description:
    "How a compiled result stays bound to the document version, page and region it came from, and how to verify a signed package.",
};

/**
 * Technical evidence: how the mechanism works, for the person evaluating whether to trust it.
 *
 * This page carried the research ledger — MEASURED / NOT SUPPORTED / BUILT, NOT PROVEN — under
 * the heading "WHAT WE MEASURED, AND WHAT WE DID NOT". That record is worth publishing and is
 * still published, in full, at /research/notes, where a reader who came for research findings
 * will look for it. It was in the wrong place: a buyer following "Technical evidence" from the
 * navigation wants to know how evidence binding works, and was handed a list of experiments
 * that did not.
 *
 * Nothing was deleted in the move. The failed hypothesis, the uncalibrated thresholds and the
 * fixture caveat are all still on the site, linked from the bottom of this page.
 */

const MECHANISM = [
  [
    "Source identity",
    "Each source is stored as an immutable object under a content hash. A later revision of the same file is a new version, not an overwrite, so a result can always name the exact bytes it was compiled from.",
  ],
  [
    "Page and region binding",
    "Reading produces regions with page numbers and bounding boxes. A qualified claim keeps the region it came from, which is why opening evidence shows the actual page with the box drawn on it rather than a quoted snippet.",
  ],
  [
    "Version binding",
    "Objects, relations and claims belong to a world version. When sources change, the previous version stays intact and readable, so an answer given last month can still be traced to what was true then.",
  ],
  [
    "Review decisions",
    "Accepting, rejecting or changing a candidate item writes an append-only record of who decided, when, and on what item. The record states the action taken and nothing beyond it.",
  ],
  [
    "Signed packages",
    "An export carries a manifest with a digest for every file, signed on the way out. The public key is published at /api/export/trust so a recipient can verify a package without asking us.",
  ],
  [
    "Fail-closed emission",
    "A world with an unresolved link is not emitted. Broken knowledge fails visibly instead of arriving looking complete.",
  ],
] as const;

const VERIFY = [
  ["Open a result", "Ask a question, or open any object in a compiled world, and follow its citation."],
  ["Reach the region", "The evidence record names the source version, page and bounding box, and opens the page itself."],
  ["Export the world", "Download the signed package: ontology, graph, retrieval corpus, provenance and validation."],
  ["Verify independently", "Check every file digest against the manifest, and the manifest signature against the published key."],
] as const;

export default function EvidencePage() {
  return (
    <PublicSitePage>
      <section className="scene doc">
        <div className="shell">
          <div className="body">
            <div className="stack">
              <p className="slate"><b>TECHNICAL EVIDENCE</b><span />SOURCE BINDING</p>
              <h1 className="document-title">Follow grounded results<br />back to the source.</h1>
            </div>
            <div className="stack">
              <p className="lede">
                A compiled world is only worth as much as its ability to show its work. This is
                the mechanism that keeps a result attached to the document version, page and
                region it came from — and how to check it yourself, without taking our word for it.
              </p>

              <p className="slate"><span />HOW EVIDENCE IS BOUND</p>
              <div className="tiles">
                {MECHANISM.map(([title, body]) => (
                  <article className="tile" key={title}>
                    <h3>{title}</h3>
                    <p>{body}</p>
                  </article>
                ))}
              </div>

              <p className="slate"><span />VERIFY IT YOURSELF</p>
              <div className="chain">
                {VERIFY.map(([title, body], index) => (
                  <article className="link" key={title}>
                    <span className="st">{String(index + 1).padStart(2, "0")}</span>
                    <h2>{title}</h2>
                    <p>{body}</p>
                  </article>
                ))}
              </div>

              <div className="actions">
                <Link className="btn" href={"/explore" as Route}>Follow a result to its page</Link>
                <Link className="btn ghost" href="/security">How your documents are handled</Link>
                <Link className="btn ghost" href={"/research/notes" as Route}>Research notes and findings</Link>
              </div>

              <p className="fine">
                Measurements, methodology and results that did not hold up are published in the{" "}
                <Link href={"/research/notes" as Route}>research notes</Link>, including a
                hypothesis we tested and did not ship.
              </p>
            </div>
          </div>
        </div>
      </section>
    </PublicSitePage>
  );
}
