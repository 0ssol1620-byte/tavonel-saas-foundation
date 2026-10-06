import type { Route } from "next";
import Link from "next/link";
import SolutionProofSample from "@/components/solution-proof-sample";
import {
  EXPLORE_SAMPLE_QUESTIONS,
  exploreSampleAnswers,
  exploreSampleArtifact,
  exploreSampleDocuments,
  exploreSampleSources,
  exploreSampleWorld,
} from "@/lib/explore-sample";
import styles from "./solutions.module.css";

type WorkflowKind = "ai-ready-knowledge" | "document-intelligence" | "knowledge-graph"
  | "source-grounded-assistants" | "knowledge-operations";
type ProofPick = { form: string; match: RegExp; framing: string };

// The hub retains its existing committed crops. PDF and assistants details open readable
// figures and a supported question's returned passage; the old segment question is not revived.
export function solutionWorkflowPick(kind: WorkflowKind, pick: ProofPick): ProofPick {
  if (kind === "document-intelligence") return {
    form: "10-Q",
    match: /Three Months Ended December 27, December 28, 2025 2024 Net sales:/,
    framing: pick.framing,
  };
  return kind === "source-grounded-assistants" ? {
    form: "10-Q",
    match: /Operating expenses: Research and development/,
    framing: "A passage returned for the curated research-and-development question. Open the source and judge whether it answers the question.",
  } : pick;
}

// Resolve the published passage and its mechanics from the existing artifact. No authored
// outputs, customer results or extra fixture files sit beside the shared sample.
export function solutionWorkflowEvidence(kind: WorkflowKind, pick: ProofPick) {
  const selectedPick = solutionWorkflowPick(kind, pick);
  const region = exploreSampleWorld.evidence.find((item) => {
    const source = exploreSampleSources.find((entry) => entry.documentId === item.sourceId);
    return source?.form === selectedPick.form && item.page > 2 && selectedPick.match.test(item.excerpt);
  });
  if (!region) throw new Error(`solution_workflow_region_missing: ${kind}`);
  const document = exploreSampleDocuments.find((item) => item.documentId === region.sourceId);
  if (!document) throw new Error(`solution_workflow_source_missing: ${kind}`);
  const file = (name: string) => {
    const found = exploreSampleArtifact.package.files.find((item) => item.path === name);
    if (!found) throw new Error(`solution_workflow_file_missing: ${name}`);
    return found;
  };
  const question = EXPLORE_SAMPLE_QUESTIONS[0];
  const answer = exploreSampleAnswers.find((item) => item.question === question);
  const isReturnedPassage = answer?.citations.some((citation) =>
    citation.sourceId === region.sourceId && citation.pageNumber1 === region.page
      && citation.bbox1000.every((value, index) => value === region.bbox[index]));
  if (kind === "source-grounded-assistants" && !isReturnedPassage) {
    throw new Error("solution_workflow_passage_not_returned_for_question");
  }
  let preview: { path: string; label: string; content: string } | null = null;
  if (kind === "ai-ready-knowledge") {
    const chunkFile = file("rag/chunks.jsonl");
    const chunk = chunkFile.content.trim().split("\n").map((line) => JSON.parse(line)).find((item) =>
      item.sourceId === region.sourceId && item.pageNumber1 === region.page
        && item.bbox1000.every((value: number, index: number) => value === region.bbox[index]));
    if (!chunk) throw new Error("solution_workflow_chunk_missing");
    preview = {
      path: chunkFile.path,
      label: "Locator fields from this passage’s emitted chunk",
      content: JSON.stringify({ chunkId: chunk.chunkId, sourceId: chunk.sourceId,
        pageNumber1: chunk.pageNumber1, bbox1000: chunk.bbox1000, evidenceId: chunk.evidenceId }, null, 2),
    };
  } else if (kind === "knowledge-graph") {
    const relations = file("graph/relationships.csv");
    const lines = relations.content.trim().split("\n");
    const row = lines.slice(1).find((line) => line.includes(`"${region.id.split(":")[0]}"`));
    if (!row) throw new Error("solution_workflow_relation_missing");
    preview = { path: relations.path, label: "CSV header and one emitted relation with its evidence IDs",
      content: `${lines[0]}\n${row}` };
  }
  const validation = JSON.parse(file("validation/report.json").content);
  return { region, document, preview, question, answer, validation };
}

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
          <Link href={`${document.href}#page=${region.page}` as Route}>Open the read PDF at this page</Link>
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
