import type { Metadata, Route } from "next";
import Link from "next/link";
import { PublicPageShell } from "@/components/public-page-shell";
import SolutionProofSample from "@/components/solution-proof-sample";
import DesignPartners from "@/components/design-partners";
import PublicPrimaryCta from "@/components/public-primary-cta";
import { SOLUTIONS } from "./[slug]/page";
import styles from "./solutions.module.css";
import { EXPLORE_CTA } from "@/lib/site-navigation";

export const metadata: Metadata = {
  title: "Solutions — TAVONEL",
  description: "Choose a document workflow by its input, the action you need and the result you can inspect. Five uses, with sample evidence and published limits.",
  alternates: { canonical: "/solutions" },
  openGraph: { url: "/solutions" },
};

// One record owns the task choice, audience and destination on both hub and detail.
const ENTRIES = Object.entries(SOLUTIONS);

export default function SolutionsPage() {
  return (
    <PublicPageShell>
      <section className={`scene doc ${styles.surface}`}><div className="shell">
        <div className={styles.hubIntro}>
          <h1 className="document-title">Start with the work you need to do.</h1>
          <p className="lede">
            Five ways teams put the compiler to work. Choose the input you have and the output
            you need, then inspect the workflow, sample evidence and limits.
          </p>
        </div>
        <div className={`tiles ${styles.hubList}`}>
          {ENTRIES.map(([slug, solution]) => (
            <article className={`tile ${styles.card}`} key={slug}>
              <div className={styles.cardIntro}>
                <p className="n">{solution.eyebrow}</p>
                <h2 className={styles.cardTitle}>
                  <Link href={`/solutions/${slug}` as Route}>{solution.title}</Link>
                </h2>
                <p className={styles.audience}>For: {solution.audience}</p>
              </div>
              <dl className={styles.task} aria-label="Input, action and output">
                <div><dt>Input</dt><dd>{solution.task.input}</dd></div>
                <div><dt>Action</dt><dd>{solution.task.action}</dd></div>
                <div><dt>Output</dt><dd>{solution.task.output}</dd></div>
              </dl>
              <div className={styles.cardProof}>
                <SolutionProofSample pick={solution.proof} variant="thumb" />
                <p>Sample source · inspect the workflow →</p>
              </div>
            </article>
          ))}
        </div>
        <DesignPartners className={styles.partnership} />
        <div className="actions">
          <PublicPrimaryCta className="btn" />
          <Link className="btn ghost" href={EXPLORE_CTA.href as Route}>{EXPLORE_CTA.label}</Link>
        </div>
        <p className="fine">
          Next: the guides, samples and research in the <Link href="/resources">resources hub</Link>,
          or the exact product contract in the <Link href="/docs">documentation</Link>.
          These five pages describe how the compiler is used, not completed customer engagements.
        </p>
      </div></section>
    </PublicPageShell>
  );
}
