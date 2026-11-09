import type { Route } from "next";
import Link from "next/link";
import SolutionProofSample from "@/components/solution-proof-sample";
import { exploreSampleArtifact } from "@/lib/explore-sample";
import { solutionWorkflowEvidence, solutionWorkflowPick, type ProofPick, type WorkflowKind } from "@/lib/solution-proof-picks";
import styles from "./solutions.module.css";

// Moved to `lib/solution-proof-picks` so /explore can resolve the same passages without importing this
// file and its stylesheets; re-exported so every existing caller keeps its import.
export { solutionWorkflowEvidence, solutionWorkflowPick } from "@/lib/solution-proof-picks";

const TITLES: Record<WorkflowKind, string> = {
  "ai-ready-knowledge": "A passage inside the retrieval projection.",
  "document-intelligence": "A read you can check against the source.",
  "knowledge-graph": "An export with inspectable evidence IDs.",
  "source-grounded-assistants": "A real question and a returned passage.",
  "knowledge-operations": "A candidate, before any activation.",
};

export default function SolutionWorkflowProof({ kind, pick }: { kind: WorkflowKind; pick: ProofPick }) {
  const { region, document, preview, question, validation } = solutionWorkflowEvidence(kind, pick);
  const selectedPick = solutionWorkflowPick(kind, pick);
  return (
    <section className={styles.workflowProof} aria-labelledby="solution-proof-title" data-workflow-proof={kind}>
      <p className={styles.proofLabel}>Check the sample</p>
      <h2 id="solution-proof-title">{TITLES[kind]}</h2>
      {kind === "source-grounded-assistants" && (
        <blockquote className={styles.question} data-sample-question>{question}</blockquote>
      )}
      <SolutionProofSample pick={selectedPick} variant="excerpt" />
      <p className={styles.proofContext}>{selectedPick.framing}</p>
      {preview && (
        <div className={styles.filePreview}>
          <p><code data-workflow-file={preview.path}>{preview.path}</code></p>
          <p id="solution-preview-label">{preview.label}</p>
          <pre tabIndex={0} aria-labelledby="solution-preview-label" data-workflow-preview={preview.path}>
            <code>{preview.content}</code>
          </pre>
          {kind === "knowledge-graph" && <p>This row binds evidence at document level. It shows the export’s shape, without establishing that this passage supports the relation’s meaning or qualifying identity resolution.</p>}
          <Link href="/product/compiled-world#public-package-proof">Inspect the full sample package</Link>
        </div>
      )}
      {kind === "document-intelligence" && (
        <div className={styles.locator}>
          <dl>
            <div><dt>Printed page</dt><dd>{region.page}</dd></div>
            <div><dt>Region box · 0–1000</dt><dd>{region.bbox.join(", ")}</dd></div>
            <div><dt>Read representation</dt><dd>{document.representationKind === "original" ? "Original PDF" : "Reference-render PDF"}</dd></div>
          </dl>
          <Link href={`/${document.href.replace(/^\/+/, "")}#page=${region.page}` as Route}>Open the read PDF at this page</Link>
          <p>This printed-region sample does not establish degraded-scan accuracy or recovered table grids.</p>
        </div>
      )}
      {kind === "source-grounded-assistants" && (
        <p className={styles.proofContext}>The passage above is one of the retriever’s actual matches for this curated question. Open its locator and judge the answer relevance; a returned citation alone does not establish open-ended retrieval accuracy.</p>
      )}
      {kind === "knowledge-operations" && (
        <div className={styles.locator}>
          <dl>
            <div><dt>Sample lifecycle</dt><dd data-sample-lifecycle>{exploreSampleArtifact.lifecycle}</dd></div>
            <div><dt>Candidate promotion</dt><dd>{String(exploreSampleArtifact.candidatePromotion)}</dd></div>
            <div><dt>validation/report.json</dt><dd>{validation.status}</dd></div>
          </dl>
          <p>“Passed” reports artifact validation. This public candidate has not been activated and is not a production activation receipt.</p>
          <Link href="/product/continuous-knowledge">Inspect the review and activation contract</Link>
        </div>
      )}
      <p className={styles.sampleQualifier}>
        Five Apple filings, compiled by this repository’s TypeScript sample compiler. These are
        mechanics demonstrations, not customer engagements or domain-accuracy results.
      </p>
    </section>
  );
}
