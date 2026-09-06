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
    "How a compiled result stays bound to the source version and the exact location inside it that it came from, and how to verify a signed package.",
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
    "Source-location binding",
    "Reading produces regions, and a qualified claim keeps the region it came from. Every compiled fact stays traceable to its exact source location, which is why opening evidence shows the place in the source rather than a quoted snippet.",
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
  ["Reach the location", "The evidence record names the source version and the exact location inside it, and opens that location."],
  ["Export the world", "Download the signed package: ontology, graph, retrieval corpus, provenance and validation."],
  ["Verify independently", "Check every file digest against the manifest, and the manifest signature against the published key."],
] as const;

/*
  The locator model, published as a model rather than as a capability list.

  "Page number and bounding box" is what a PDF locator looks like, and it was written across
  the site as though it were what evidence *is*. It is not: a cell in a spreadsheet, a shape on
  a slide, a MIME part in an email and a span in a source file are all exact locations, and none
  of them has a page. So the abstraction is named here in full, and the sentence directly under
  it sends the reader to /sources for the only question this list does not answer -- which of
  these representations this deployment reads today.

  Nothing here may be read as a claim that all of them are qualified. Today exactly one is
  implemented: PDF page and region, through the sanitize-to-PDF OCR path, which is why /sources
  says every accepted format preserves the same three things. The rest are the shape the
  evidence contract is built to, listed so that the shape is legible before the readers exist.
*/
const LOCATORS = [
  ["PDF", "Page and region on that page."],
  ["Spreadsheet", "Sheet, and the cell or range inside it."],
  ["Presentation", "Slide, and the shape on that slide."],
  ["Email", "Message, and the attachment or MIME part inside it."],
  ["JSON / XML", "Pointer or path to the node."],
  ["Code", "Commit, file, and the symbol or line span."],
  ["CAD / BIM", "Object, by its GUID."],
  ["Audio / video", "Timestamp, or frame."],
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
                A compiled world is only worth as much as its ability to show its work.{" "}
                <b>Every compiled fact stays traceable to its exact source location.</b> This is
                the mechanism that keeps it there — and how to check it yourself, without taking
                our word for it.
              </p>

              <p className="slate"><span />WHAT AN EXACT SOURCE LOCATION IS</p>
              <p className="fine">
                A location is whatever addresses one place inside that kind of source. These are
                the forms the evidence contract is built to hold:
              </p>
              <div className="tiles">
                {LOCATORS.map(([family, locator]) => (
                  <article className="tile" key={family}>
                    <span className="n">{family}</span>
                    <p>{locator}</p>
                  </article>
                ))}
              </div>
              <p className="fine">
                That is the model, not a support list. This deployment reads one of these today —
                PDF page and region, through the sanitize-to-PDF reading path — and every other
                format it accepts is read through that same path.{" "}
                <Link href={"/sources" as Route}>The capability manifest at /sources</Link> is the
                truth about which representations are read here; nothing above should be taken as
                a locator that has been qualified.
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
