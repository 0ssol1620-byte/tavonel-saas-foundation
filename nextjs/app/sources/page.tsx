import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { PublicSitePage } from "@/components/public-site-chrome";
import SourceCapabilityTable from "@/components/source-capability-table";
import { CAPABILITY_MANIFEST, isAcceptedAtUpload } from "../../../shared/capabilityManifest";

/*
  What this deployment can read, published as the thing the deployment reads.

  The support list used to exist five times -- twice as a MIME map, once as the file picker's
  `accept` attribute, once inside a rejection sentence and once as a row of marketing chips --
  and they had already disagreed. This page is not a sixth copy. It prints
  `shared/capabilityManifest.ts`, and so do the other five, so a format cannot be advertised
  here and refused at upload.

  It is deliberately unflattering. Every row today says BEST_EFFORT, preserves three things, and
  verifies nothing visually, because that is what the pipeline emits: sanitize to PDF, read with
  OCR, carry page, paragraph text and a bounding box. A support matrix whose only job is to look
  strong is a marketing page with a table in it.
*/

export const metadata: Metadata = {
  title: "Supported sources — TAVONEL",
  description:
    "The capability manifest this deployment reads: every source format, its support tier, what survives into the compiled world, and the limitations that come with it.",
  alternates: { canonical: "/sources" },
  openGraph: { url: "/sources" },
  robots: { index: true, follow: true },
};

export default function SourcesPage() {
  const qualified = CAPABILITY_MANIFEST.entries.filter(
    (entry) => entry.qualificationReceipt !== null,
  );
  const accepted = CAPABILITY_MANIFEST.entries.filter((entry) => isAcceptedAtUpload(entry.status));

  return (
    <PublicSitePage>
      <section className="scene doc">
        <div className="shell">
          <div className="body">
            <div className="stack">
              <p className="slate"><b>SOURCES</b><span />CAPABILITY MANIFEST</p>
              <h1 className="document-title">What this deployment<br />can actually read.</h1>
            </div>

            <div className="stack">
              <p className="lede">
                One list decides what the upload route accepts, what the file picker offers, what
                a rejection says and what this page prints. <b>They cannot disagree, because they
                are the same list.</b> Each row states its support tier, what survives into the
                compiled world, and what does not.
              </p>

              <p className="src-state">
                <b>
                  {qualified.length === 0
                    ? "No format on this deployment carries a qualification receipt."
                    : `${qualified.length} of ${accepted.length} accepted formats carry a qualification receipt.`}
                </b>{" "}
                A verified tier requires a receipt from a qualification run and the date it was
                produced. Until one exists, the highest tier a format may claim is best effort,
                and no row below claims more.
              </p>

              <SourceCapabilityTable manifest={CAPABILITY_MANIFEST} />

              <p className="src-refusal">Formats not listed are refused at upload.</p>

              <h2 className="slate src-section"><span />HOW A ROW IS FILLED IN</h2>
              <p className="src-para">
                <b>What is preserved</b> is what the compile request carries today, not what the
                file format contains. Every source here is sanitized to PDF and read by the OCR
                reader, so every row preserves the same three things: the page, the paragraph
                text and the bounding box that binds it back to an exact source location. A
                spreadsheet&rsquo;s cells and formulas are in the file and are not in that list,
                so the row says so rather than implying otherwise.
              </p>
              <p className="src-para">
                <b>Known limitations</b> are read out of the code that enforces them, not written
                as caveats. An archive is expanded in the browser and its members are validated
                one at a time; the archive itself is never compiled, which is why it appears
                below the tier that refuses it and still appears in the file picker.
              </p>
              <p className="src-para">
                A format moves up a tier when a native reader for it exists and a qualification
                run produces a receipt. That is a measurement, not a decision, and this page
                changes when the measurement does.
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
                has no reader here, and this deployment cannot hold an unlisted format for
                review: the upload route refuses it before any file is stored. Listing it under
                review would describe a queue that does not exist, so it is refused with
                everything else that is absent, and it appears here instead.
              </p>

              <div className="actions">
                <Link className="btn" href={"/docs/files-and-formats" as Route}>Files and formats</Link>
                <Link className="btn ghost" href="/evidence">How evidence is bound</Link>
                <Link className="btn ghost" href={"/api" as Route}>API</Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </PublicSitePage>
  );
}
