import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { PublicSitePage } from "@/components/public-site-chrome";
import { EVIDENCE, EVIDENCE_STATE } from "@/lib/evidence-record";

export const metadata: Metadata = {
  alternates: { canonical: "/research/notes" },
  openGraph: { url: "/research/notes" },
  title: "Research notes — TAVONEL",
  description:
    "What we measured, what we built without proving, and one hypothesis that failed and was not shipped.",
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
 *   MEASURED           a number we produced, with a scoring path we did not touch
 *   NOT SUPPORTED      a hypothesis that failed; not shipped as a feature
 *   BUILT, NOT PROVEN  code that passes its tests, which does not make its thresholds right
 */
export default function ResearchNotesPage() {
  return (
    <PublicSitePage>
      <section className="scene doc">
        <div className="shell">
          <div className="body">
            <div className="stack">
              <p className="slate"><b>RESEARCH</b><span />NOTES AND FINDINGS</p>
              <h1 className="document-title">What we measured,<br />and what we did not.</h1>
            </div>
            <div className="stack">
              <p className="lede">
                Every result carries the state of its evidence. A measurement is a number we
                produced and can describe the conditions for. Built is code that passes its tests,
                which is not the same as a threshold being right. Not supported is a hypothesis we
                tested, that failed, and that we did not ship anyway.
              </p>

              <div className="tiles">
                {EVIDENCE.map(([state, title, body]) => (
                  <article className="tile" key={title} data-state={state}>
                    <span className="n">{EVIDENCE_STATE[state]}</span>
                    <h3>{title}</h3>
                    <p>{body}</p>
                  </article>
                ))}
              </div>

              {/*
                B04. Five hubs answered five different questions with nothing saying which was
                which, so a reader looking for one of them read parts of three. One line, the
                same shape on each: what this page answers, and where the next question goes.
              */}
              <p className="fine">
                <b>This page answers one question:</b> what has actually been measured, and what
                has not. Which problems are still open is on <Link href={"/research" as Route}>Research</Link>;
                how a citation stays bound to its source is on <Link href={"/evidence" as Route}>Evidence</Link>;
                what a number has to carry before it is published is on <Link href={"/benchmarks" as Route}>Benchmarks</Link>;
                the security and compliance status is on <Link href={"/trust" as Route}>Trust</Link>.
              </p>

              {/*
                E02/E05. The two measured entries now state their figures and name the receipt
                each figure came from. A named receipt a reader cannot reach is only half an
                answer, so this says where they are and how to get one — rather than linking a
                URL that does not exist.
              */}
              <p className="fine">
                The receipts named above are files in the compiler repository, under
                <code> docs/evidence/artifacts/</code>, each bound by sha256 in the campaign&rsquo;s
                claims pack. They are not published at a public URL yet. Ask
                <a href="mailto:hello@tavonel.com">hello@tavonel.com</a> for the file whose hash is
                named here, and check the hash yourself.
              </p>

              <p className="fine">
                No number here is placed beside a competitor&rsquo;s result as though it were
                reproduced under the same conditions. Comparative work is published only after a
                baseline is reproduced on a frozen configuration, with the raw outputs and the
                failures included.
              </p>

              <div className="actions">
                <Link className="btn ghost" href="/research">Research areas</Link>
                <Link className="btn ghost" href="/evidence">How evidence is bound</Link>
                <Link className="btn ghost" href={"/reproducibility" as Route}>Reproducibility</Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </PublicSitePage>
  );
}
