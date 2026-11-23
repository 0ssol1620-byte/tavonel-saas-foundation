import { evaluateAnswerability, type AnswerabilityReason, type AnswerabilityStatus } from "./answerability";
import { ANSWERABILITY_COVERAGE_THRESHOLD } from "./answerability-shadow";
import { answerGroundedQuestion, parseChunks } from "./grounded-ask";
import { expandedTokens } from "./lexical-tokens";

/*
  WO-KS-2: competency coverage (knowledge-steward.md §6). Pure.

  Per competency question: the evidence packet the ask route's artifact-chunk path builds
  (`answerGroundedQuestion` over `parseChunks`), never the DB retrieval index, so the result depends
  only on the artifact's bytes; the answerability verdict over every chunk of the cited evidenceIds
  (the ask route's shadow input); and the structural links, the Topic/Entity/Claim nodes whose own
  evidenceIds, or whose outgoing `supported_by` edges' evidenceIds, intersect the packet's, with the
  edges among them. Core V2 gives Claim nodes evidenceIds [] and binds evidence on those edges.

  Held conflicts: the chunk path carries none of its own, so the count is the artifact's `contradicts`
  edges (Core V2 contradiction candidates, held for review and never resolved) whose evidenceIds
  intersect the packet or that touch a linked Claim. A fallback-compiled artifact has no
  `contradicts` edge, and 0 is then what it holds.

  No clock, no randomness, no network, not metered. The threshold is the shadow's uncalibrated 0 and
  the output says so. CQ text never reaches the output.

  An artifact that cannot be read whole, or questions outside the store's bounds, throw: an integrity
  failure is never reported as a World that does not hold the answer.

  ponytail: recomputed per call, and each CQ re-parses the chunks inside answerGroundedQuestion;
  cache by (manifestDigest, setDigest) if function time shows up.
*/

export const COMPETENCY_COVERAGE_SCHEMA = "tavonel.competency_coverage.v1" as const;
export const MAX_COMPETENCY_QUESTIONS = 25;
const MAX_EVIDENCE_IDS = 8;
const MAX_LINKED_OBJECTS = 16;
const MAX_LINKED_RELATIONS = 16;

const CQ_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const COLLECTION_ID = /^collection-[a-f0-9]{32}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const NODE_KINDS = new Set(["Document", "Topic", "Entity", "Claim", "Evidence"]);
const LINKABLE = new Set(["Topic", "Entity", "Claim"]);

export type CompetencyQuestion = Readonly<{ cqId: string; text: string }>;

export type CompetencyCoverageRow = {
  cqId: string;
  status: AnswerabilityStatus;
  reason: AnswerabilityReason | null;
  evidenceIds: string[];
  linkedObjectIds: string[];
  linkedRelations: string[];
};

export type CompetencyCoverage = {
  schema: typeof COMPETENCY_COVERAGE_SCHEMA;
  manifestDigest: string;
  threshold: { value: number; calibrated: false };
  rows: CompetencyCoverageRow[];
};

type Node = { id: string; kind: string; evidenceIds: string[] };
type Edge = { id: string; type: string; from: string; to: string; evidenceIds: string[] };

function fail(code: "COVERAGE_ARTIFACT_INVALID" | "COVERAGE_QUESTIONS_INVALID"): never {
  throw new Error(code);
}

const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(item => typeof item === "string");

function readOntology(value: unknown): { nodes: Node[]; edges: Edge[] } {
  const ontology = (value as { ontology?: { nodes?: unknown; edges?: unknown } }).ontology;
  if (!ontology || !Array.isArray(ontology.nodes) || !Array.isArray(ontology.edges)) fail("COVERAGE_ARTIFACT_INVALID");
  const nodes = ontology.nodes.map(raw => {
    const node = raw as Record<string, unknown> | null;
    if (!node || typeof node.id !== "string" || typeof node.kind !== "string" || !NODE_KINDS.has(node.kind) || !isStrings(node.evidenceIds)) {
      fail("COVERAGE_ARTIFACT_INVALID");
    }
    return { id: node.id, kind: node.kind, evidenceIds: node.evidenceIds };
  });
  const edges = ontology.edges.map(raw => {
    const edge = raw as Record<string, unknown> | null;
    if (!edge || typeof edge.id !== "string" || typeof edge.type !== "string" || typeof edge.from !== "string" || typeof edge.to !== "string" || !isStrings(edge.evidenceIds)) {
      fail("COVERAGE_ARTIFACT_INVALID");
    }
    return { id: edge.id, type: edge.type, from: edge.from, to: edge.to, evidenceIds: edge.evidenceIds };
  });
  return { nodes, edges };
}

function normalized(text: string) {
  return text.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function readQuestions(value: unknown): CompetencyQuestion[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_COMPETENCY_QUESTIONS) fail("COVERAGE_QUESTIONS_INVALID");
  const seen = new Set<string>();
  return value.map(raw => {
    const question = raw as Record<string, unknown> | null;
    if (
      !question ||
      typeof question.cqId !== "string" ||
      !CQ_ID.test(question.cqId) ||
      seen.has(question.cqId) ||
      typeof question.text !== "string" ||
      question.text.length > 300 ||
      CONTROL.test(question.text) ||
      normalized(question.text).length < 8 ||
      normalized(question.text).length > 300
    ) fail("COVERAGE_QUESTIONS_INVALID");
    seen.add(question.cqId);
    return { cqId: question.cqId, text: question.text };
  });
}

export function evaluateCompetencyCoverage(artifact: unknown, questions: unknown): CompetencyCoverage {
  if (!artifact || typeof artifact !== "object") fail("COVERAGE_ARTIFACT_INVALID");
  const { collectionId, manifestDigest } = artifact as { collectionId?: unknown; manifestDigest?: unknown };
  if (typeof collectionId !== "string" || !COLLECTION_ID.test(collectionId) || typeof manifestDigest !== "string" || !DIGEST.test(manifestDigest)) {
    fail("COVERAGE_ARTIFACT_INVALID");
  }
  const cqs = readQuestions(questions);
  const { nodes, edges } = readOntology(artifact);

  // parseChunks skips a malformed row and answers [] past its bounds; here every row must parse.
  const chunks = parseChunks(artifact as Parameters<typeof parseChunks>[0]);
  const file = (artifact as { package?: { files?: Array<{ path?: unknown; content?: unknown }> } }).package?.files
    ?.find(item => item.path === "rag/chunks.jsonl");
  const rowCount = typeof file?.content === "string" ? file.content.split("\n").filter(Boolean).length : 0;
  if (chunks.length === 0 || chunks.length !== rowCount) fail("COVERAGE_ARTIFACT_INVALID");
  const processedSources = new Set(chunks.map(chunk => chunk.sourceVersionId)).size;

  const rows = cqs.map((cq): CompetencyCoverageRow => {
    const answer = answerGroundedQuestion(artifact, cq.text);
    // Inputs were checked above, so null means the question has no searchable term: an empty packet.
    if (answer === null && expandedTokens(normalized(cq.text)).length > 0) fail("COVERAGE_ARTIFACT_INVALID");
    const packetIds = [...new Set((answer?.citations ?? []).map(citation => citation.evidenceId))];
    const packet = new Set(packetIds);
    const touches = (ids: string[]) => ids.some(id => packet.has(id));
    const supported = new Set(edges.filter(edge => edge.type === "supported_by" && touches(edge.evidenceIds)).map(edge => edge.from));

    const linked = nodes
      .filter(node => LINKABLE.has(node.kind) && (touches(node.evidenceIds) || supported.has(node.id)))
      .map(node => node.id)
      .sort();
    const linkedSet = new Set(linked);
    const linkedClaims = new Set(nodes.filter(node => node.kind === "Claim" && linkedSet.has(node.id)).map(node => node.id));
    const heldConflicts = edges.filter(edge =>
      edge.type === "contradicts" && (touches(edge.evidenceIds) || linkedClaims.has(edge.from) || linkedClaims.has(edge.to))
    ).length;
    const relations = edges
      .filter(edge => linkedSet.has(edge.from) && linkedSet.has(edge.to))
      .map(edge => edge.id)
      .sort();

    const verdict = evaluateAnswerability({
      question: cq.text,
      // Every chunk of each cited evidenceId, as the ask route's shadow builds it: the fallback
      // compiler gives all chunks of a document one evidenceId.
      evidence: chunks.filter(chunk => packet.has(chunk.evidenceId)).map(chunk => ({ evidenceId: chunk.evidenceId, text: chunk.text })),
      heldConflicts,
      worldCoverage: { processedSources, unprocessedSources: null },
    }, { coverageThreshold: ANSWERABILITY_COVERAGE_THRESHOLD });

    return {
      cqId: cq.cqId,
      status: verdict.status,
      reason: verdict.reason,
      // ponytail: fixed display bounds from the tool contract; the packet holds at most 3 today.
      evidenceIds: packetIds.slice(0, MAX_EVIDENCE_IDS),
      linkedObjectIds: linked.slice(0, MAX_LINKED_OBJECTS),
      linkedRelations: relations.slice(0, MAX_LINKED_RELATIONS),
    };
  });

  return {
    schema: COMPETENCY_COVERAGE_SCHEMA,
    manifestDigest,
    threshold: { value: ANSWERABILITY_COVERAGE_THRESHOLD, calibrated: false },
    rows,
  };
}
