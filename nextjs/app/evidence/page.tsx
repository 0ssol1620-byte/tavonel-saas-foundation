import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { PublicSitePage } from "@/components/public-site-chrome";
import { TrustNext } from "@/components/trust-next";
import styles from "./evidence.module.css";

export const metadata: Metadata = {
  // Each page declares its own address. Without this every route inherited the root
  // canonical ("/"), so a crawler was told 22 distinct pages were all the homepage.
  alternates: { canonical: "/evidence" },
  openGraph: { url: "/evidence" },
  /*
    BA-109. One page had three names: "Technical evidence" in the navigation, the hub tile and
    this title; "Evidence" in every cross-link from /research, /benchmarks and /reproducibility;
    and an h1 matching neither. The page is Evidence. The h1 stays a headline -- that is what an
    h1 is for -- and the name is the same word everywhere it is a name.

    The navigation label and the hub tile label live in `lib/site-navigation.ts`, which nav-global
    owns; that half is a cross-lane request.
  */
  title: "Evidence — TAVONEL",
  description:
    "How a compiled result stays bound to the source version and the exact location inside it that it came from, and how to verify a signed package.",
};

/**
 * Evidence: how the mechanism works, for the person evaluating whether to trust it.
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
  /*
    BA-114. The raw endpoint path was typeset as body prose in a marketing card. A reader who
    needs the URL is reading /docs; a reader here needs to know the key is public, which is the
    fact that makes the verification independent. The path is the link's target now.
  */
  [
    "Signed packages",
    "An export carries a manifest with a digest for every file, signed on the way out. The public key is published, so a recipient verifies a package without asking us.",
    "/api/export/trust",
    "Fetch the public key",
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
  of them has a page. So the abstraction is named here in full, and the reader is sent to
  /sources for the only question the list does not answer -- which of these representations
  TAVONEL reads today.

  Nothing here may be read as a claim that all of them are qualified. Today exactly one is
  implemented: PDF page and region, through the sanitize-to-PDF OCR path, which is why /sources
  says every accepted format preserves the same three things. The rest are the shape the
  evidence contract is built to, listed so that the shape is legible before the readers exist.

  BA-078. The model was right and the presentation contradicted /sources.

  Eight capability-shaped tiles, each stating a locator in the present tense, were the largest
  visual element on the page -- and exactly one of the eight is implemented. /sources says the
  opposite in as many words: every accepted format preserves page, paragraph text and region,
  because everything is read through the sanitize-to-PDF OCR path. A buyer who read both pages
  caught the brand contradicting itself on the one subject the brand is built on, and the
  correction was a folded line in the smallest type on the page.

  The model stays -- it is the right abstraction, and deleting it would make one locator shape
  look like the shape of all evidence again, which RESOLVED A-1 retired. What changes is that the
  state is inside the grid rather than under it, and visible without a click: the one that reads
  today leads, at full width, and the other seven sit under a heading that says what they are,
  each carrying its own status.

  BA-099: one casing rule. The grid had four -- an all-caps acronym, title case, space-slash
  caps, and space-slash with a lowercase second word ("Audio / video"). The site writes "and",
  so the slashes go.
*/
const READING_TODAY = ["PDF", "Page and region on that page."] as const;

const CONTRACTED_LOCATORS = [
  ["Spreadsheet", "Sheet, and the cell or range inside it."],
  ["Presentation", "Slide, and the shape on that slide."],
  ["Email", "Message, and the attachment or MIME part inside it."],
  ["JSON and XML", "Pointer or path to the node."],
  ["Code", "Commit, file, and the symbol or line span."],
  ["CAD and BIM", "Object, by its GUID."],
  ["Audio and video", "Timestamp, or frame."],
] as const;

export default function EvidencePage() {
  return (
    <PublicSitePage>
      <section className="scene doc">
        <div className="shell">
          <div className="body">
            <div className="stack">
              <p className="slate"><b>EVIDENCE</b><span />SOURCE BINDING</p>
              <h1 className="document-title">Follow grounded results<br />back to the source.</h1>
            </div>
            <div className="stack">
              {/*
                B04 asked each of the five hubs to say which question it answers. BA-088 is about
                how it was done: the same 11px mono template sentence opened five consecutive
                pages, each followed by the same four cross-links in the same order, which reads
                as scaffolding and puts a navigation paragraph where the argument starts. The role
                is part of the lede now; the cross-links are one labelled row at the foot.
              */}
              <p className="lede">
                A compiled world is only worth as much as its ability to show its work.{" "}
                <b>Every compiled fact stays traceable to its exact source location.</b> This page
                is <b>how a compiled result stays bound to the source it came from</b>, and how to
                check that yourself, without taking our word for it.
              </p>
              {/*
                BA-072. B07's label was right that an absence nothing names reads as an oversight.

                The sentence that was here, ending on "no customer has given it", was
                printed identically on /benchmarks and /reproducibility too -- three pages
                volunteering to a reader who had not asked, and to no legal requirement, that we
                have no customers. The consent policy is a policy, so it is stated once, on
                /trust, as one. What is gone is the count.
              */}

              <p className="slate"><span />WHAT AN EXACT SOURCE LOCATION IS</p>
              <p className="fine">
                A location is whatever addresses one place inside that kind of source. One of
                these forms is what TAVONEL reads today; the rest are the shape the evidence
                contract is built to hold.
              </p>
              {/*
                BA-078. The state is in the grid, without a click. The lead tile is the locator
                that exists, at full width; the seven under it carry a status chip that says what
                they are, and the heading above them says it in words as well.
              */}
              <div className={styles.leadLocator}>
                <p className={styles.leadMark}>Reading today</p>
                <h3>{READING_TODAY[0]}</h3>
                <p>{READING_TODAY[1]}</p>
                <p className="fine">
                  Every format TAVONEL accepts is read through this one, which is why{" "}
                  <Link href={"/sources" as Route}>every row on Sources</Link> preserves the page,
                  the paragraph text and the region.
                </p>
              </div>
              {/* BA-113: one heading level per card grid, in document order. This is h3's grid. */}
              <p className="slate"><span />THE CONTRACT IS BUILT TO HOLD THESE TOO</p>
              <div className="tiles">
                {CONTRACTED_LOCATORS.map(([family, locator]) => (
                  <article className="tile" key={family}>
                    <h3>{family}</h3>
                    <p>{locator}</p>
                    <p className={styles.locatorState}>Reader not shipped</p>
                  </article>
                ))}
              </div>

              <p className="slate"><span />HOW EVIDENCE IS BOUND</p>
              <div className="tiles">
                {MECHANISM.map(([title, body, href, label]) => (
                  <article className="tile" key={title}>
                    <h3>{title}</h3>
                    <p>{body}</p>
                    {href ? <p className="fine"><a href={href}>{label}</a></p> : null}
                  </article>
                ))}
              </div>

              <p className="slate"><span />VERIFY IT YOURSELF</p>
              <div className="chain">
                {VERIFY.map(([title, body], index) => (
                  <article className="link" key={title}>
                    <span className="st">{String(index + 1).padStart(2, "0")}</span>
                    {/*
                      BA-113. This was an h2 under an h3-level context, so the document outline
                      lost its order: the first grid had no headings at all, the second used h3,
                      and these steps used h2. All three are h3 now, one level per grid.
                    */}
                    <h3>{title}</h3>
                    <p>{body}</p>
                  </article>
                ))}
              </div>

              {/*
                The proof link is a deep link, not the front door.

                "Follow a result to its page" landed the reader on Explore's entry act, where
                the evidence trace this page has just described is two clicks away and has to be
                found. `?act=evidence` is the query `lib/explore-story.ts` resolves to the
                Evidence Act, so the claim and the thing that demonstrates it are one click
                apart. The label also stops naming a page: RESOLVED A-1 retires one locator
                shape as the shape of all evidence, and this page is where that is explained.
              */}
              <div className="actions">
                <Link className="btn" href={"/explore?act=evidence" as Route}>Open a result at its exact source location</Link>
                <Link className="btn ghost" href={"/research/notes" as Route}>Research notes and findings</Link>
              </div>

              {/*
                BA-098. The page's last word was "did not hold up" and "did not ship" -- an
                Evidence page, reached by a buyer deciding whether to trust the mechanism, closing
                on failure. The same link and the same facts, with the work first: nothing is
                hidden and nothing new is claimed.
              */}
              <p className="fine">
                Every measurement behind these claims, with its denominator and its receipt, is in
                the <Link href={"/research/notes" as Route}>research notes</Link> — including the
                hypotheses that did not hold.
              </p>

              {/* BA-088. The cross-links the deleted template sentence carried. */}
              <p className="fine">
                <b>Also in the trust case:</b>{" "}
                <Link href={"/research/notes" as Route}>Research notes</Link> ·{" "}
                <Link href={"/benchmarks" as Route}>Benchmarks</Link> ·{" "}
                <Link href={"/reproducibility" as Route}>Reproducibility</Link> ·{" "}
                <Link href={"/research" as Route}>Research</Link> ·{" "}
                <Link href={"/trust" as Route}>Trust</Link>
              </p>
            </div>
            {/*
              BA-097. The page renders its own filled primary 200px above this -- the proof it
              has just spent a screen promising -- so a second filled button made one view carry
              two "main next actions". The step stays, quietly.
            */}
            <TrustNext from="/evidence" emphasis="quiet" />
          </div>
        </div>
      </section>
    </PublicSitePage>
  );
}
