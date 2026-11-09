/*
  The proof each Solutions page opens, and the passage it resolves to, with no component and no
  stylesheet attached.

  2026-11-09 (Launch QA, /explore LCP). These lived in `app/solutions/[slug]/page.tsx` and
  `app/solutions/solution-workflow-proof.tsx`, and `app/explore/page.tsx` imported both to keep each
  Solutions passage in its bounded model. Importing a page module imports its CSS, so /explore
  shipped the Solutions sheets as render-blocking stylesheets it never draws. When the shared CSS
  chunk passed Next's 100 KB merge cap (the nav panels' rules, PR #204), `solution-proof-sample`
  spilled into a tenth stylesheet on /explore and its Lighthouse LCP crossed 3,000 ms. Reading the
  picks from here keeps the same IDs and the same build-time throw, without the stylesheets.
*/
import {
  EXPLORE_SAMPLE_QUESTIONS,
  exploreSampleAnswers,
  exploreSampleArtifact,
  exploreSampleDocuments,
  exploreSampleSources,
  exploreSampleWorld,
} from "@/lib/explore-sample";

export type WorkflowKind = "ai-ready-knowledge" | "document-intelligence" | "knowledge-graph"
  | "source-grounded-assistants" | "knowledge-operations";
export type ProofPick = { form: string; match: RegExp; framing: string };

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

/** Each Solutions page's proof pick, keyed by its slug. The page reads `proof` from here. */
export const SOLUTION_PROOF_PICKS = {
  "ai-ready-knowledge": {
    form: "10-K",
    match: /PART I Item 1\. Business Company Background/,
    framing: "One region out of the annual filing, in the shape every project downstream receives it: the passage, the page it was printed on and the box it sat in.",
  },
  "document-intelligence": {
    form: "10-Q",
    match: /CONDENSED CONSOLIDATED STATEMENTS OF OPERATIONS/,
    framing: "A printed financial statement, read the way TAVONEL reads one: every figure stays readable and locatable as the paragraphs it was printed as, while the grid that arranged them is not recovered.",
  },
  "knowledge-graph": {
    form: "DEF 14A",
    match: /Nominees to Apple’s Board of Directors Apple is overseen/,
    framing: "A proxy passage naming people and roles — the kind of region an object and its relations are compiled from, with the evidence that supports each one still attached.",
  },
  "source-grounded-assistants": {
    form: "10-Q",
    match: /Segment Operating Performance The following table shows net sales by reportable segment/,
    framing: "A source region from the quarterly filing. The workflow proof uses the curated question’s actual returned passage.",
  },
  "knowledge-operations": {
    form: "DEF 14A",
    match: /Audit Committee Ron Sugar/,
    framing: "A governance passage from the proxy — the kind of region a reviewer opens beside the compiled result before activating a candidate.",
  },
} as const satisfies Record<WorkflowKind, ProofPick>;
