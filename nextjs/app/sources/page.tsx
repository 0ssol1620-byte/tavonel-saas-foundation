import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { PublicSitePage } from "@/components/public-site-chrome";
import SourceCapabilityTable from "@/components/source-capability-table";
import {
  publicCapabilityRows,
  sharedAcceptedLimitationLabels,
} from "../../../shared/capabilityManifest";

/*
  Every source TAVONEL reads, published as the thing it reads.

  The support list used to exist five times -- twice as a MIME map, once as the file picker's
  `accept` attribute, once inside a rejection sentence and once as a row of marketing chips --
  and they had already disagreed. This page is not a sixth copy. It prints
  `shared/capabilityManifest.ts`, and so do the other five, so a format cannot be advertised
  here and refused at upload.

  It is precise rather than flattering. Every accepted row is read the same way -- sanitize to
  PDF, read with OCR, carry the page, the paragraph text and the exact region -- and says so.
  A support matrix whose only job is to look strong is a marketing page with a table in it.

  What the 2026-09-11 brand audit changed here, and why:

  BA-063  "this deployment" is our operations vocabulary, and it appeared four times. A buyer
          does not know what a deployment is or why there might be several. The product has a
          name.
  BA-058  The first thing under the lede was a bordered callout saying nothing here is verified.
          Nothing requires it: the table states a tier on every row, and what a tier costs to
          earn belongs in the fold that explains how a row is filled in.
  BA-059  The dominant content of the table was the same six negations printed twelve times,
          plus two columns whose every cell was identical. What is true of every accepted format
          is one sentence above the table; a row now carries what is true of that format.
  BA-068  The refusal rule was a tracked-uppercase line floating between two folds, where it
          read as a system error. It is a clause of the lede, which is where a policy belongs.
  BA-069  The primary action on a primary-navigation page was a link to the documentation, so a
          reader who was convinced had no way to start.
*/

export const metadata: Metadata = {
  title: "Supported sources — TAVONEL",
  description:
    "Every source format TAVONEL reads, its support tier, what survives into the compiled world, and the limits that come with it.",
  alternates: { canonical: "/sources" },
  openGraph: { url: "/sources" },
  robots: { index: true, follow: true },
};

export default function SourcesPage() {
  /*
    BA-060: the projection, not the manifest.

    `SourceCapabilityTable` is a client component, so whatever it is handed is serialized into
    the page every visitor downloads. It was handed the manifest, which carries the reader
    plan's internal component ids and revisions, a per-format receipt state and the default
    status -- none of it rendered, all of it shipped.

    `publicCapabilityRows` is what may cross, and it resolves the labels here rather than passing
    the keys through, so the payload holds no manifest identifier at all -- no `BEST_EFFORT`, no
    `bbox1000`, no `no_table_or_formula_extraction`. Those are the server's words for comparing
    things. §6.1's DTO sweep asks for exactly this.
  */
  const rows = publicCapabilityRows();
  const shared = sharedAcceptedLimitationLabels();

  return (
    <PublicSitePage>
      <section className="scene doc">
        <div className="shell">
          <div className="body">
            <div className="stack">
              <p className="slate"><b>SOURCES</b><span />CAPABILITY MANIFEST</p>
              <h1 className="document-title">Every source TAVONEL reads,<br />and what survives the read.</h1>
            </div>

            <div className="stack">
              <p className="lede">
                One list decides what the upload route accepts, what the file picker offers, what
                a rejection says and what this page prints. <b>They cannot disagree, because they
                are the same list.</b> Each row states its support tier and what survives into the
                compiled world; anything not listed here is refused at upload rather than accepted
                and quietly mishandled.
              </p>

              {/*
                BA-059. The sentence that used to be seventy-two table cells.

                The shared limitations are computed from the manifest rather than typed out, so
                this cannot go on saying "no table extraction" after a reader lands that does.
                The two ceilings come from `shared/intakeCeiling.ts` through the same labels the
                table uses, so a change to the deployed processors rewrites this sentence.
              */}
              <p className="src-para">
                <b>Every accepted format is read the same way.</b> It is sanitized to PDF and read
                by the OCR reader, so every row below preserves the page, the paragraph text and
                the exact region that binds a result back to its source. What that path does not
                do, it does not do for any of them: {shared.join(" · ")}.
              </p>

              <SourceCapabilityTable rows={rows} />

              {/*
                The four paragraphs explaining the table are technical detail, and §14.3 asks for
                technical detail collapsed on a long page. They sat as four screens of prose
                between the table and the way out: read by the reader who wants to know how a row
                is filled in, scrolled past by everyone else. Opening is one click and the summary
                says what is inside.

                §14.4's lifecycle definition belongs in here too, because it is the caveat the
                table cannot state row by row. The table is about formats; "supported" for a
                *connector* means the ten behaviours listed below (RESOLVED B-7). Without the
                paragraph a reader can take a format's tier as a statement about a Drive folder
                staying in step, which is a different claim entirely.

                BA-067: the summary is the label, not the definition. A definition typed into a
                tracked-uppercase mono string rendered its own curly quotes as debris, and "will
                mean" was a future tense for a word the page uses in the present.
              */}
              <details className="status-fold">
                <summary>How a row is filled in</summary>
                <div className="stack">
              <p className="src-para">
                <b>What is preserved</b> is what the compile request carries today, not what the
                file format contains. A spreadsheet&rsquo;s cells and formulas are in the file and
                are not in that list, so the row says so rather than implying otherwise.
              </p>
              <p className="src-para">
                <b>Known limitations</b> are read out of the code that enforces them, not written
                as caveats. An archive is expanded in the browser and its members are validated
                one at a time; the archive itself is never compiled, which is why it appears
                below the tier that refuses it and still appears in the file picker.
              </p>
              {/*
                BA-058's other half. The qualification definition is what the deleted callout was
                actually for, written forwards: what earns a tier, rather than what nothing has.
              */}
              <p className="src-para">
                <b>A tier is earned by a measurement.</b> A format moves up when a native reader
                for it exists and a qualification run produces a receipt with the date it was
                produced. That is a measurement, not a decision, and this page changes when the
                measurement does.
              </p>
              {/*
                Named because a Korean reader will look for it and find silence otherwise.

                The review tier is not a waiting room: an upload is held for review only if the
                upload route accepts it, and both the capability issue and the quarantine
                completion re-run the same whitelist (`completeQuarantineUpload` calls
                `validateQualifiedDocumentInput`). A format with no reader and no review path is
                a refusal, so it is written as one rather than given a tier it cannot occupy.
              */}
              <p className="src-para">
                <b>Legacy binary HWP</b> (<i>application/x-hwp</i>, .hwp) is not in the table. It
                has no reader here, and an unlisted format cannot be held for review: the upload
                route refuses it before any file is stored. Listing it under review would describe
                a queue that does not exist, so it is refused with everything else that is absent,
                and it appears here instead.
              </p>
              {/*
                BA-065's counterpart. The lifecycle definition stays; what left is the sentence
                that ended it on our internal qualification state. What each connector does at
                each of those events is written on /integrations, read off the adapters.
              */}
              <p className="src-para">
                <b>A format is not a connector.</b> Every row above is about reading one file
                that has already arrived. Supported, for a connected system, means the whole
                lifecycle: create, update, rename, move, delete, permission change, tombstone
                behaviour, source-version propagation, world update and ACL enforcement. The
                current readers checkpoint provider changes, suspend a bound source when deletion
                or lost access is observed, and fail closed before governed use. What each
                connector does at each of those events is on{" "}
                <Link href="/integrations">Integrations</Link>.
              </p>
                </div>
              </details>

              {/*
                BA-069. A primary-navigation page whose primary action was a documentation link
                left a convinced reader with nowhere to go, so the primary is now the conversation
                this page leads to. The third ghost went with it: /developers owns the API path
                and already says so.
              */}
              <div className="actions">
                <Link className="btn" href="/contact">Talk to us about your sources</Link>
                <Link className="btn ghost" href={"/docs/files-and-formats" as Route}>Files and formats</Link>
                <Link className="btn ghost" href="/evidence">How evidence is bound</Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </PublicSitePage>
  );
}
