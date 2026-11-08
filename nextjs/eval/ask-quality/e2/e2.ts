/**
 * E2 answerability gate -- offline replay over the E1 gold (PREREG-E2.json).
 *
 * Real here: answerGroundedQuestion (lib/grounded-ask.ts, the production excerpt-concatenation Ask
 * path), evaluateAnswerability (lib/answerability.ts, the gate the Ask route shadows), the E1 question
 * sets, splits and span rule (score.ts containsSpan).
 * NOT real: the corpus build. Production compiles OCR regions of a PDF; this chunks the pinned 10-K
 * HTML (chunkDocument below). Page 1 and the full-page bbox on every chunk are placeholders the chunk
 * schema requires; they are eval fixtures, never stored as fact, and nothing here reads them.
 */
import { createHash } from "node:crypto";
import { answerGroundedQuestion } from "../../../lib/grounded-ask";
import { evaluateAnswerability, REFUSING_STATUSES, type Answerability, type AnswerabilityStatus } from "../../../lib/answerability";
import { containsSpan, wilson, type EvalQuestion } from "../score";

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

// ------------------------------------------------------------------------------------ corpus

export const CHUNK_MAX_CHARS = 400;
const HEADER_MAX_CHARS = 150;
const YEAR = /\b(?:19|20|21)\d{2}\b/;

const NAMED: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", mdash: "—", ndash: "–",
  rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', bull: "•", middot: "·",
};
function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : " ";
    }
    return NAMED[body.toLowerCase()] ?? " ";
  });
}
const plain = (html: string) => decode(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

export type Block = { kind: "text"; text: string } | { kind: "table"; rows: string[] };

/** Visible text blocks of an inline-XBRL 10-K: hidden ix:header, scripts, styles and comments removed. */
export function htmlBlocks(html: string): Block[] {
  const visible = html
    .replace(/<ix:header\b[\s\S]*?<\/ix:header>/gi, " ")
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const blocks: Block[] = [];
  const pushText = (segment: string) => {
    for (const line of segment.replace(/<\/(?:p|div|li|h[1-6]|section|tr)>|<br\s*\/?>/gi, "\n").split("\n")) {
      const text = plain(line);
      if (text) blocks.push({ kind: "text", text });
    }
  };
  let last = 0;
  for (const match of visible.matchAll(/<table\b[\s\S]*?<\/table>/gi)) {
    pushText(visible.slice(last, match.index));
    const rows = [...match[0].matchAll(/<tr\b[\s\S]*?<\/tr>/gi)]
      .map(row => [...row[0].matchAll(/<t[dh]\b[\s\S]*?<\/t[dh]>/gi)].map(cell => plain(cell[0])).filter(Boolean).join(" "))
      .filter(Boolean);
    if (rows.length > 0) blocks.push({ kind: "table", rows });
    last = (match.index ?? 0) + match[0].length;
  }
  pushText(visible.slice(last));
  return blocks;
}

/** Word-bounded pieces of at most `max` characters (a single longer word is cut). */
function split(text: string, max: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const cut = rest.lastIndexOf(" ", max);
    const at = cut > 0 ? cut : max;
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** Greedy packing of units into chunks of at most `max` characters, each starting with `prefix`. */
function pack(units: string[], max: number, prefix: string | null): string[] {
  const room = prefix ? max - prefix.length - 1 : max;
  const chunks: string[] = [];
  let current = "";
  for (const unit of units.flatMap(item => split(item, room))) {
    if (current && current.length + 1 + unit.length > room) {
      chunks.push(current);
      current = unit;
    } else current = current ? `${current} ${unit}` : unit;
  }
  if (current) chunks.push(current);
  return chunks.map(chunk => (prefix ? `${prefix} ${chunk}` : chunk));
}

/**
 * Chunks of at most CHUNK_MAX_CHARS. Consecutive text blocks pack together; a table packs its rows
 * apart from text, and each of its chunks repeats the table's header -- the first of its first five
 * rows that names a year, when that row is at most 150 characters -- so a row of amounts keeps the
 * period it belongs to. 400 keeps three chunks inside the fallback's 3 x 420 answer envelope, so a
 * baseline abstention here is a retrieval outcome, never an envelope overflow.
 */
export function chunkDocument(html: string): string[] {
  const chunks: string[] = [];
  let text: string[] = [];
  const flush = () => {
    chunks.push(...pack(text, CHUNK_MAX_CHARS, null));
    text = [];
  };
  for (const block of htmlBlocks(html)) {
    if (block.kind === "text") {
      text.push(block.text);
      continue;
    }
    flush();
    const headerIndex = block.rows.slice(0, 5).findIndex(row => YEAR.test(row) && row.length <= HEADER_MAX_CHARS);
    const header = headerIndex >= 0 ? block.rows[headerIndex]! : null;
    const rows = block.rows.filter((_, index) => index !== headerIndex);
    chunks.push(...(rows.length > 0 ? pack(rows, CHUNK_MAX_CHARS, header) : header ? [header] : []));
  }
  flush();
  return chunks;
}

export type CorpusDocument = { accession: string; html: string };
export type CorpusArtifact = {
  collectionId: string;
  manifestDigest: string;
  package: { files: Array<{ path: string; content: string }> };
  textByEvidenceId: Map<string, string>;
  chunkCount: number;
};

/** One collection per corpusRef, shaped as the promoted artifact answerGroundedQuestion reads. Fails closed on its limits. */
export function buildCorpusArtifact(corpusRef: string, documents: CorpusDocument[]): CorpusArtifact {
  const textByEvidenceId = new Map<string, string>();
  const rows: string[] = [];
  for (const document of documents) {
    chunkDocument(document.html).forEach((text, index) => {
      const n = String(index).padStart(5, "0");
      const evidenceId = `ev-${document.accession}-${n}`;
      textByEvidenceId.set(evidenceId, text);
      rows.push(JSON.stringify({
        chunkId: `chunk-${document.accession}-${n}`, logicalId: `logical-${document.accession}-${n}`, text,
        sourceId: `source-${document.accession}`, sourceVersionId: `version-${document.accession}`, evidenceId,
        pageNumber1: 1, bbox1000: [0, 0, 1000, 1000], authority: "regulatory_filing",
      }));
    });
  }
  const content = `${rows.join("\n")}\n`;
  if (rows.length === 0 || rows.length > 50_000 || content.length > 8 * 1024 * 1024) {
    throw new Error(`${corpusRef}: ${rows.length} chunks / ${content.length} characters is outside the artifact limits the Ask path reads`);
  }
  return {
    collectionId: `collection-${sha256(corpusRef).slice(0, 32)}`,
    manifestDigest: `sha256:${sha256(content)}`,
    package: { files: [{ path: "rag/chunks.jsonl", content }] },
    textByEvidenceId,
    chunkCount: rows.length,
  };
}

// ------------------------------------------------------------------------------------ replay

export type Replay = {
  id: string;
  kind: "answerable" | "unanswerable";
  rule: string | null;
  corpusRef: string;
  question: string;
  /** The baseline served an answer: answerGroundedQuestion status "grounded" (E1 abstention rule). */
  baselineAnswered: boolean;
  baselineReason: string | null;
  /** Answerable only: a citation preview contains a gold span (E1 containsSpan). */
  goldHit: boolean | null;
  evidence: Array<{ evidenceId: string; text: string }>;
};

export function replayQuestion(question: EvalQuestion & { generation?: { rule?: string } }, artifact: CorpusArtifact): Replay {
  const answer = answerGroundedQuestion(artifact, question.question);
  if (!answer) throw new Error(`${question.id}: the Ask path refused the artifact or the question`);
  const evidence = answer.citations.map(citation => {
    const text = artifact.textByEvidenceId.get(citation.evidenceId);
    if (text === undefined) throw new Error(`${question.id}: cited ${citation.evidenceId} is not in the corpus`);
    return { evidenceId: citation.evidenceId, text };
  });
  const gold = question.gold;
  return {
    id: question.id,
    kind: question.kind,
    rule: question.generation?.rule ?? null,
    corpusRef: question.corpusRef,
    question: question.question,
    baselineAnswered: answer.status === "grounded",
    baselineReason: answer.reason,
    goldHit: question.kind === "answerable" && gold
      ? answer.citations.some(citation => gold.spans.some(span => containsSpan(citation.excerpt, span)))
      : null,
    evidence,
  };
}

/** The gate exactly as the Ask route's fallback branch shadows it: no conflict information, both sources processed. */
export function gate(replay: Replay, coverageThreshold: number): Answerability {
  return evaluateAnswerability({
    question: replay.question,
    evidence: replay.evidence,
    heldConflicts: null,
    worldCoverage: { processedSources: 2, unprocessedSources: 0 },
  }, { coverageThreshold });
}

const refuses = (status: AnswerabilityStatus) => REFUSING_STATUSES.has(status);

// ------------------------------------------------------------------------------- calibration

export const THRESHOLD_GRID: readonly number[] = Object.freeze([0, ...Array.from({ length: 21 }, (_, i) => Number((0.5 + i * 0.025).toFixed(3)))]);
export const CALIBRATION_MAX_REFUSED_OVER_ANSWERABLE = 0.05;

export type CalibrationRow = { threshold: number; refusedUnanswerable: number; unanswerable: number; refusedAnswerable: number; answerable: number; feasible: boolean };

/**
 * PREREG-E2 calibration rule: among thresholds whose refused/answerable is <= 0.05 on the calibration
 * split, the one refusing the most unanswerable questions; ties go to the smaller threshold. When none
 * is feasible the threshold is 0 (the coverage rule off) and constraintMet is false.
 */
export function chooseThreshold(replays: Replay[], grid: readonly number[] = THRESHOLD_GRID) {
  const answerable = replays.filter(row => row.kind === "answerable");
  const unanswerable = replays.filter(row => row.kind === "unanswerable");
  const table: CalibrationRow[] = grid.map(threshold => {
    const refusedAnswerable = answerable.filter(row => refuses(gate(row, threshold).status)).length;
    return {
      threshold,
      refusedUnanswerable: unanswerable.filter(row => refuses(gate(row, threshold).status)).length,
      unanswerable: unanswerable.length,
      refusedAnswerable,
      answerable: answerable.length,
      feasible: answerable.length > 0 && refusedAnswerable / answerable.length <= CALIBRATION_MAX_REFUSED_OVER_ANSWERABLE,
    };
  });
  const best = table.filter(row => row.feasible)
    .sort((left, right) => right.refusedUnanswerable - left.refusedUnanswerable || left.threshold - right.threshold)[0];
  return { threshold: best?.threshold ?? 0, constraintMet: best !== undefined, table };
}

// ----------------------------------------------------------------------------------- holdout

export type Rate = { id: string; numerator: number; denominator: number; value: number | null; wilson95: { low: number; high: number } | null; role: "criterion" | "reported" };
const rate = (id: string, numerator: number, denominator: number, role: Rate["role"] = "reported"): Rate => ({
  id, numerator, denominator, value: denominator === 0 ? null : numerator / denominator, wilson95: wilson(numerator, denominator), role,
});

export const MAX_REFUSED_OVER_ANSWERABLE_UPPER = 0.1;
export const MAX_GOLD_HITS_LOST_UPPER = 0.1;
export type Criterion = { id: "C1" | "C2" | "C3"; rule: string; result: "PASS" | "FAIL" | "NOT_EVALUABLE" };

export function holdoutReport(replays: Replay[], threshold: number) {
  const rows = replays.map(replay => ({ replay, verdict: gate(replay, threshold) }));
  const refused = rows.filter(row => refuses(row.verdict.status));
  const narrow = rows.filter(row => row.verdict.status === "NOT_IN_WORLD" || row.verdict.status === "OUT_OF_SCHEMA");
  const U = rows.filter(row => row.replay.kind === "unanswerable");
  const A = rows.filter(row => row.replay.kind === "answerable");
  const isRefused = (row: (typeof rows)[number]) => refuses(row.verdict.status);
  const isNarrow = (row: (typeof rows)[number]) => row.verdict.status === "NOT_IN_WORLD" || row.verdict.status === "OUT_OF_SCHEMA";
  const goldHits = A.filter(row => row.replay.goldHit === true);
  const metrics: Rate[] = [
    rate("refuse_precision", refused.filter(row => row.replay.kind === "unanswerable").length, refused.length),
    rate("refuse_recall", U.filter(isRefused).length, U.length),
    rate("baseline_wrong_answer_over_unanswerable", U.filter(row => row.replay.baselineAnswered).length, U.length, "criterion"),
    rate("gated_wrong_answer_over_unanswerable", U.filter(row => row.replay.baselineAnswered && !isRefused(row)).length, U.length, "criterion"),
    rate("refused_over_answerable", A.filter(isRefused).length, A.length, "criterion"),
    rate("gold_span_hits_lost", goldHits.filter(isRefused).length, goldHits.length, "criterion"),
    rate("baseline_gold_span_recall", goldHits.length, A.length),
    rate("baseline_abstained_over_answerable", A.filter(row => !row.replay.baselineAnswered).length, A.length),
    rate("gated_abstained_over_answerable", A.filter(row => !row.replay.baselineAnswered || isRefused(row)).length, A.length),
    rate("narrow_refuse_precision", narrow.filter(row => row.replay.kind === "unanswerable").length, narrow.length),
    rate("narrow_refuse_recall", U.filter(isNarrow).length, U.length),
    ...[...new Set(U.map(row => row.replay.rule ?? "UNKNOWN"))].sort().map(rule => {
      const group = U.filter(row => (row.replay.rule ?? "UNKNOWN") === rule);
      return rate(`refuse_recall.${rule}`, group.filter(isRefused).length, group.length);
    }),
  ];
  const get = (id: string) => metrics.find(metric => metric.id === id)!;
  const baselineWrong = get("baseline_wrong_answer_over_unanswerable").wilson95;
  const gatedWrong = get("gated_wrong_answer_over_unanswerable").wilson95;
  const refusedAnswerable = get("refused_over_answerable").wilson95;
  const hitsLost = get("gold_span_hits_lost").wilson95;
  const criteria: Criterion[] = [
    { id: "C1", rule: "Wilson95 upper(gated_wrong_answer_over_unanswerable) < Wilson95 lower(baseline_wrong_answer_over_unanswerable)",
      result: !baselineWrong || !gatedWrong ? "NOT_EVALUABLE" : gatedWrong.high < baselineWrong.low ? "PASS" : "FAIL" },
    { id: "C2", rule: `Wilson95 upper(refused_over_answerable) <= ${MAX_REFUSED_OVER_ANSWERABLE_UPPER}`,
      result: !refusedAnswerable ? "NOT_EVALUABLE" : refusedAnswerable.high <= MAX_REFUSED_OVER_ANSWERABLE_UPPER ? "PASS" : "FAIL" },
    { id: "C3", rule: `Wilson95 upper(gold_span_hits_lost) <= ${MAX_GOLD_HITS_LOST_UPPER}`,
      result: !hitsLost ? "NOT_EVALUABLE" : hitsLost.high <= MAX_GOLD_HITS_LOST_UPPER ? "PASS" : "FAIL" },
  ];
  const statusCounts: Record<string, Record<string, number>> = {};
  for (const row of rows) {
    const key = row.replay.kind;
    statusCounts[key] ??= {};
    statusCounts[key][row.verdict.status] = (statusCounts[key][row.verdict.status] ?? 0) + 1;
  }
  return {
    metrics,
    criteria,
    verdict: criteria.every(criterion => criterion.result === "PASS") ? "SUPPORTED" as const : "NOT_SUPPORTED" as const,
    statusCounts,
    rows: rows.map(({ replay, verdict }) => ({
      id: replay.id, kind: replay.kind, rule: replay.rule, corpusRef: replay.corpusRef,
      baselineAnswered: replay.baselineAnswered, baselineReason: replay.baselineReason, goldHit: replay.goldHit,
      status: verdict.status, reason: verdict.reason, termCoverage: verdict.termCoverage, numericAnchor: verdict.numericAnchor,
      evidenceIds: replay.evidence.map(item => item.evidenceId),
    })),
  };
}
