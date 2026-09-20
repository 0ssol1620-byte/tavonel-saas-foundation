import type { SignedProductDemo } from "@/lib/signed-product-demo";
import styles from "./signed-product-demo.module.css";

const shortDigest = (value: string) => `${value.slice(0, 19)}…${value.slice(-10)}`;

export default function SignedProductDemo({ demo }: { demo: SignedProductDemo }) {
  const checks = Object.entries(demo.candidate.validationChecks);
  return (
    <article className={styles.demo} aria-labelledby="signed-demo-title">
      <header className={styles.hero}>
        <p className={styles.disclosure}>{demo.disclosure}</p>
        <div className={styles.heroGrid}>
          <div>
            <p className={styles.eyebrow}>One source revision · one inspectable path</p>
            <h1 id="signed-demo-title">Follow one change all the way out.</h1>
          </div>
          <p className={styles.lede}>
            Open the synthetic source, inspect the candidate and review event, then follow the
            activated sample World into a grounded answer and a cryptographically verified export.
          </p>
        </div>
        <p className={styles.boundary}>
          This page executes repository contracts at build time. Its activation event is a fixed
          sample record, never a production database mutation. Its public fixture key proves only
          that the displayed manifest bytes have not changed.
        </p>
      </header>

      <ol className={styles.story} aria-label="Source to signed export">
        <li className={styles.step}>
          <div className={styles.stepHeading}>
            <span aria-hidden="true">01</span>
            <div><p>Source</p><h2>Four files, with their bytes named.</h2></div>
          </div>
          <ul className={styles.sources} aria-label="Synthetic source files">
            {demo.fixture.sources.map((source) => (
              <li key={source.documentId}>
                <a href={source.href} target="_blank" rel="noreferrer">{source.label}</a>
                <small>{source.pageCount} page · <code>{shortDigest(source.sha256)}</code></small>
              </li>
            ))}
          </ul>
        </li>

        <li className={styles.step}>
          <div className={styles.stepHeading}>
            <span aria-hidden="true">02</span>
            <div><p>Change</p><h2>The interval moved; the old value stays visible.</h2></div>
          </div>
          <div className={styles.change} aria-label="Detected source change">
            <div><span>Revision B</span><del>{demo.change.from}</del></div>
            <span className={styles.arrow} aria-hidden="true">→</span>
            <div><span>Revision C</span><ins>{demo.change.to}</ins></div>
          </div>
          <p className={styles.meta}>Bound to source version <code>{demo.change.sourceVersionId}</code>.</p>
        </li>

        <li className={styles.step}>
          <div className={styles.stepHeading}>
            <span aria-hidden="true">03</span>
            <div><p>Compile and review</p><h2>A candidate first. A durable decision second.</h2></div>
          </div>
          <div className={styles.facing}>
            <section aria-labelledby="candidate-heading">
              <p className={styles.state}>CANDIDATE · VALIDATION {demo.candidate.validationStatus.toUpperCase()}</p>
              <h3 id="candidate-heading">Compiled output</h3>
              <dl>
                <div><dt>Collection</dt><dd><code>{demo.candidate.collectionId}</code></dd></div>
                <div><dt>Manifest</dt><dd><code>{shortDigest(demo.candidate.manifestDigest)}</code></dd></div>
                <div><dt>Promotion</dt><dd><code>candidatePromotion=false</code></dd></div>
              </dl>
              <ul className={styles.checks} aria-label="Candidate validation checks">
                {checks.map(([label, passed]) => <li key={label}>{passed ? "Passed" : "Failed"} · {label}</li>)}
              </ul>
            </section>
            <section aria-labelledby="review-heading">
              <p className={styles.state}>REVIEW · {demo.review.decision.toUpperCase()}</p>
              <h3 id="review-heading">Human decision record</h3>
              <blockquote>{demo.review.reason}</blockquote>
              <dl>
                <div><dt>Event</dt><dd><code>{demo.review.eventId}</code></dd></div>
                <div><dt>Evidence</dt><dd><code>{demo.review.evidenceId}</code></dd></div>
                <div><dt>Recorded</dt><dd>{demo.review.recordedAt}</dd></div>
              </dl>
            </section>
          </div>
        </li>

        <li className={styles.step}>
          <div className={styles.stepHeading}>
            <span aria-hidden="true">04</span>
            <div><p>Activation</p><h2>The pointer moves only after review.</h2></div>
          </div>
          <div className={styles.activation}>
            <p><span className={styles.activeDot} aria-hidden="true" />{demo.activation.status} · revision {demo.activation.revision}</p>
            <code>{demo.activation.worldStateId}</code>
            <small>Atomic sample transition · manifest {shortDigest(demo.activation.manifestDigest)}</small>
          </div>
        </li>

        <li className={styles.step}>
          <div className={styles.stepHeading}>
            <span aria-hidden="true">05</span>
            <div><p>Answer and evidence</p><h2>The answer keeps a way home.</h2></div>
          </div>
          <div className={styles.facing}>
            <section aria-labelledby="answer-heading">
              <p className={styles.state}>GROUNDED ANSWER</p>
              <h3 id="answer-heading">{demo.answer.question}</h3>
              <p className={styles.answer}>{demo.answer.text}</p>
              <small>Receipt <code>{shortDigest(demo.answer.receipt.outputSha256)}</code></small>
            </section>
            <section className={styles.evidence} aria-labelledby="evidence-heading">
              <p className={styles.state}>EXACT SOURCE REGION</p>
              <h3 id="evidence-heading">Page {demo.answer.citation.pageNumber1}</h3>
              <blockquote>{demo.answer.citation.excerpt}</blockquote>
              <p className={styles.coordinates}>bbox [{demo.answer.citation.bbox1000.join(", ")}]</p>
              <a href={demo.answer.sourceHref} target="_blank" rel="noreferrer">Open the source page</a>
            </section>
          </div>
        </li>

        <li className={styles.step}>
          <div className={styles.stepHeading}>
            <span aria-hidden="true">06</span>
            <div><p>Signed export</p><h2>Integrity is verifiable away from TAVONEL.</h2></div>
          </div>
          <div className={styles.exportRecord}>
            <p className={styles.verified}><span aria-hidden="true">✓</span> Ed25519 signature verified against this sample manifest</p>
            <dl>
              <div><dt>Manifest schema</dt><dd>{demo.signedExport.schemaVersion}</dd></div>
              <div><dt>Package files</dt><dd>{demo.signedExport.fileCount}</dd></div>
              <div><dt>Lifecycle</dt><dd>{demo.signedExport.lifecycle}</dd></div>
              <div><dt>Promotion claim</dt><dd><code>candidatePromotion=false</code></dd></div>
              <div><dt>Key</dt><dd><code>{demo.signedExport.signature.keyId}</code></dd></div>
              <div><dt>Signed payload</dt><dd><code>{shortDigest(demo.signedExport.signature.signedPayloadSha256)}</code></dd></div>
            </dl>
            <p className={styles.boundary}>
              A valid signature proves manifest integrity. It does not certify semantic quality,
              customer approval, or current activation status.
            </p>
            <a href={demo.signedExport.verifierHref} download>Download the offline verifier</a>
          </div>
        </li>
      </ol>
    </article>
  );
}
