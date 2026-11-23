// Route-owned, not layout-owned: see the note in app/layout.tsx. First, so the modules below still follow it.
import "@/app/paper-product.css";
import Link from "next/link";
import ContactForm from "@/components/contact-form";
import { PublicSitePage } from "@/components/public-site-chrome";
import { activationPolicy } from "@/lib/activation-policy";
import styles from "./evaluation-page.module.css";

/*
  WO-CI-21 (D1): the page renders inside the V34 frame through `PublicSitePage`, whose root declares
  T2 and holds the one <main>. The paper tokens this page's body is drawn with stay on its own
  wrapper inside that <main>; the container is the frame's `--v34-shell`.
*/
export default function EvaluationPage() {
  return <PublicSitePage template="T2">
    <div className={`evaluation-page ${styles.page}`} lang="en">
    <div className={`evaluation-shell ${styles.shell}`}>
      <section className="evaluation-intro">
        <p className="paper-label">Your documents / a bounded evaluation</p>
        <h1>Find out what your AI<br />can actually rely on.</h1>
        <p>Start with a small, permitted document set and real questions. Agree on the scope and cost before any processing, then inspect the results, missing evidence, and remaining limitations.</p>
        <p className="evaluation-gate">{activationPolicy.customerData.reason}</p>
        {/* UX-L7 (§5.3 R7): no ↗ on a link that stays on the site. The label itself is R6's, for a copy lane. */}
        <Link className={styles.sample} href="/explore">Inspect the public sample first</Link>
        {/* A plain same-origin file download with no client state. Following the link is an ordinary GET that retrieves the blank static file; it submits no worksheet or form contents. */}
        <p className="fine">Preparing a pilot? The blank worksheet lists what to record: the task, document permissions, questions with expected answers, and how results will be counted. It is an empty template. Downloading it only retrieves the blank file: it does not start processing, enable a connection, or create a payment. Filling in your copy does not by itself send what you write to us. <a href="/evaluation/pilot-worksheet.en.md" download="tavonel-pilot-worksheet.en.md" type="text/markdown">Download the blank pilot evidence worksheet (Markdown, English)</a></p>
      </section>
      <div className="evaluation-grid">
        <aside>
          <h2>What happens next</h2>
          <ol className="evaluation-steps">
            <li><strong>Define the task</strong><p>Document types, intended AI use, and the questions that matter.</p></li>
            <li><strong>Agree on boundaries</strong><p>Authorized sources, retention, processing location, supported formats, and a total cost ceiling.</p></li>
            <li><strong>Review the evidence</strong><p>Trace answers to their source versions. Report failures, uncertainty, time, and cost alongside successful results.</p></li>
          </ol>
          <p className="fine">An inquiry does not start processing, enable a connection, or create a payment commitment.</p>
          <p><Link href="/sources">Source limits</Link> · <Link href="/pricing">Pricing conditions</Link> · <Link href="/trust">Data boundaries</Link></p>
        </aside>
        <section className="evaluation-form" aria-labelledby="evaluation-request-title">
          <h2 id="evaluation-request-title">Tell us what you want to verify</h2>
          <p>Keep the first message short; document details are optional. Please do not include private documents or credentials.</p>
          <ContactForm locale="en" />
        </section>
      </div>
    </div>
    </div>
  </PublicSitePage>;
}
