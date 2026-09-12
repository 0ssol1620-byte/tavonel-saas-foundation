import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { PublicSitePage } from "@/components/public-site-chrome";
import { EVIDENCE, EVIDENCE_STATE, shortDigest } from "@/lib/evidence-record";

export const metadata: Metadata = {
  alternates: { canonical: "/research/notes" },
  openGraph: { url: "/research/notes" },
  title: "Research notes — TAVONEL",
  description:
    "What we measured and how: the figures, their denominators, their receipts, and the hypotheses that did not hold.",
};

/**
 * The research record, given the page it always needed.
 *
 * These entries used to sit on /evidence, between a product claim and a price link, which put
 * a failed experiment in front of someone still deciding what the product is. They are not
 * softened or dropped here — a failed hypothesis is a result, and publishing it is the point.
 * They are addressed to the reader who came looking for findings.
 *
 * The states are load-bearing and stay:
 *   MEASURED       a number we produced, with a scoring path we did not touch
 *   NOT SUPPORTED  a hypothesis that failed; not shipped as a feature
 *   OPEN           code that passes its tests, which does not make its thresholds right
 *
 * What the 2026-09-11 brand audit changed:
 *
 * BA-090  Half the headline and the whole share card were an absence. Publishing the failure is
 *         right and stays; leading with "what we did not" is a separate choice, and it was the
 *         first thing a searcher and a link preview saw. The lede carries the honesty now.
 * BA-073  The receipts were named by internal filename, so the retired campaign name was
 *         published twice on the page a technical evaluator reads most closely.
 * BA-074  One paragraph published an internal repository path, the internal words "campaign" and
 *         "claims pack", the admission that our evidence is effectively unreachable, and then
 *         asked the reader to email for an attachment.
 * BA-092  Two 64-character digests were typeset as body prose and wrapped mid-string.
 * BA-088  Five consecutive pages opened with the same 11px mono template sentence followed by
 *         the same four cross-links in the same order. The role each page plays is now part of
 *         its own opening argument, and the cross-links are one labelled row at the foot.
 * BA-089  "Ask{' '}<a>" was missing its space, rendering as "Askhello@tavonel.com". The
 *         sentence it was in is gone with BA-074; its replacement carries the space.
 * BA-110  The page was a dead end -- three equal ghosts, no primary -- while four other pages
 *         send readers here.
 */
export default function ResearchNotesPage() {
  return (
    <PublicSitePage>
      <section className="scene doc">
        <div className="shell">
          <div className="body">
            <div className="stack">
              <p className="slate"><b>RESEARCH</b><span />NOTES AND FINDINGS</p>
              <h1 className="document-title">What we measured,<br />and how.</h1>
            </div>
            <div className="stack">
              <p className="lede">
                This is the record of <b>what has actually been measured</b>, and what has not.
                Every result carries the state of its evidence: a measurement is a number we
                produced and can describe the conditions for, open is code that passes its tests
                without that making a threshold right, and not supported is a hypothesis we
                tested, that failed, and that we did not ship anyway.
              </p>

              <div className="tiles">
                {EVIDENCE.map((entry) => (
                  <article className="tile" key={entry.title} data-state={entry.state}>
                    <span className="n">{EVIDENCE_STATE[entry.state]}</span>
                    <h3>{entry.title}</h3>
                    <p>{entry.body}</p>
                    {/*
                      BA-073 / BA-092. The receipt as a footer line rather than the last clause
                      of the paragraph: its public identifier, what it is of, its date, and a
                      shortened digest whose whole value sits in the `title` attribute. The
                      internal filename is not rendered at all -- it is what we quote back to
                      someone who asks for the file, and renaming the artifact would break the
                      reproducibility the hash exists for.
                    */}
                    {entry.receipt ? (
                      <p className="fine">
                        <b>Receipt {entry.receipt.id}</b> · {entry.receipt.of} ·{" "}
                        {entry.receipt.date} ·{" "}
                        <code title={`sha256 ${entry.receipt.digest}`}>
                          sha256 {shortDigest(entry.receipt.digest)}
                        </code>
                      </p>
                    ) : null}
                  </article>
                ))}
              </div>

              {/*
                BA-074. What is left of a paragraph that published a repository path, two
                internal words, a confession and a request for an attachment: the two facts a
                reader can act on.
              */}
              <p className="fine">
                Every receipt above is bound by sha256. Request any receipt named here at{" "}
                <a href="mailto:hello@tavonel.com">hello@tavonel.com</a> and check the hash
                yourself.
              </p>

              <p className="fine">
                No number here is placed beside a competitor&rsquo;s result as though it were
                reproduced under the same conditions. Comparative work is published only after a
                baseline is reproduced on a frozen configuration, with the raw outputs and the
                failures included.
              </p>

              {/*
                BA-110. A primary and one ghost, instead of three equal ghosts and no primary on
                a page four others link into.
              */}
              <div className="actions">
                <Link className="btn" href={"/benchmarks" as Route}>See the benchmark protocol</Link>
                <Link className="btn ghost" href={"/reproducibility" as Route}>Rerun a published sample</Link>
              </div>

              {/*
                BA-088. The cross-links the template sentence used to carry, as a labelled row at
                the foot -- where a reader who has finished the page is looking for the next one.
              */}
              <p className="fine">
                <b>Also in the trust case:</b>{" "}
                <Link href={"/evidence" as Route}>Evidence</Link> ·{" "}
                <Link href={"/benchmarks" as Route}>Benchmarks</Link> ·{" "}
                <Link href={"/reproducibility" as Route}>Reproducibility</Link> ·{" "}
                <Link href={"/research" as Route}>Research</Link> ·{" "}
                <Link href={"/trust" as Route}>Trust</Link>
              </p>
            </div>
          </div>
        </div>
      </section>
    </PublicSitePage>
  );
}
