/*
  The review queue: one row per document in a compile, ordered by the risk that already exists.

  Two audit items meet here (U03 risk-first review, U05 per-document partial breakdown) because
  they are one list. A reviewer asks "what do I look at first" and a reader asks "what is
  missing from this World"; both are answered by the same four-state breakdown over the same
  denominator -- the documents the compile was asked to read.

  Two rules this module exists to keep:

  - No invented severity number. The constitution forbids routing on an uncalibrated scalar, so
    ordering is categorical: a security stop outranks a review, a review outranks an unread
    source, and inside one bucket the document with more recorded reasons comes first. There is
    no score anywhere in here, and adding one would be the wrong fix.
  - No invented timestamp. Elapsed-time-to-first-review is (first review decision recorded) minus
    (compile settled). If either end is absent, the answer is `null` and the caller says "not
    recorded" -- never zero, never "now".
*/

/** Four states, in the order a reviewer should meet them. */
export const REVIEW_QUEUE_STATUSES = ["excluded", "under_review", "unprocessed", "read"] as const;

export type ReviewQueueStatus = (typeof REVIEW_QUEUE_STATUSES)[number];

export type ReviewQueueRow = {
  documentId: string;
  /** A recognisable name when one is known, else the id. Never a guess at a title. */
  name: string;
  status: ReviewQueueStatus;
  /** A security stop, which is never grouped with an ordinary input failure. */
  securityBlocked: boolean;
  /** Reason strings recorded against this document. Copied, never paraphrased. */
  reasons: string[];
  evidenceCount: number;
  /** When the first review decision on this document's evidence was recorded. */
  firstReviewAt: string | null;
  /** Compile settled -> first review decision. `null` when either timestamp is absent. */
  timeToFirstReviewMs: number | null;
};

export type ReviewQueueBreakdown = {
  rows: ReviewQueueRow[];
  /** The denominator: how many documents this compile was asked to read. */
  total: number;
  counts: Record<ReviewQueueStatus, number>;
  /**
   * What the breakdown could not be derived from, named rather than defaulted.
   *
   * An empty array means every input was present. `compile_job` means no compile-job row was
   * available, so excluded and unprocessed documents cannot be listed at all and the reader is
   * told so instead of being shown a reassuring zero.
   */
  missing: Array<"compile_job" | "compile_settled_at">;
};

export type ReviewQueueInput = {
  /** The compile's document set. When absent, the artifact's own documents are the denominator. */
  documentIds: string[] | null;
  blocked: Array<{ documentId: string; kind: "input" | "security"; reason: string }>;
  /** ISO time the compile settled; null while it is still running or when the row is gone. */
  compileSettledAt: string | null;
  /** Per-document processing state from the document list, when the caller has it. */
  documents?: Array<{ documentId: string; hasOcrJson: boolean; processingState: string; ocrReviewReasonCode?: string }>;
  /** The candidate's review reasons, verbatim. A reason naming a document is attributed to it. */
  reviewReasons: string[];
  /** Compiled evidence, used for the per-document count and to attribute review decisions. */
  evidence: Array<{ id: string; sourceId: string }>;
  /** Recorded review decisions, newest or oldest order irrelevant. */
  decisions: Array<{ evidenceId: string; recordedAt: string }>;
  names?: Record<string, string>;
};

const RANK: Record<ReviewQueueStatus, number> = { excluded: 0, under_review: 1, unprocessed: 2, read: 3 };

/**
 * Order by risk, using only signals the compile already recorded.
 *
 * Security stops first because continuing past one is never a one-click choice. Then the state
 * rank, then the number of recorded reasons, then documents nobody has decided on yet, then the
 * id so the order is stable across renders.
 */
export function compareReviewQueueRows(left: ReviewQueueRow, right: ReviewQueueRow): number {
  if (left.securityBlocked !== right.securityBlocked) return left.securityBlocked ? -1 : 1;
  if (RANK[left.status] !== RANK[right.status]) return RANK[left.status] - RANK[right.status];
  if (left.reasons.length !== right.reasons.length) return right.reasons.length - left.reasons.length;
  const leftDecided = left.firstReviewAt !== null;
  const rightDecided = right.firstReviewAt !== null;
  if (leftDecided !== rightDecided) return leftDecided ? 1 : -1;
  return left.documentId.localeCompare(right.documentId);
}

export function buildReviewQueue(input: ReviewQueueInput): ReviewQueueBreakdown {
  const missing: ReviewQueueBreakdown["missing"] = [];
  if (input.documentIds === null) missing.push("compile_job");
  if (!input.compileSettledAt || Number.isNaN(Date.parse(input.compileSettledAt))) missing.push("compile_settled_at");

  const blockedById = new Map(input.blocked.map((entry) => [entry.documentId, entry]));
  const documentById = new Map((input.documents ?? []).map((entry) => [entry.documentId, entry]));

  const evidenceByDocument = new Map<string, string[]>();
  for (const item of input.evidence) {
    const list = evidenceByDocument.get(item.sourceId);
    if (list) list.push(item.id);
    else evidenceByDocument.set(item.sourceId, [item.id]);
  }

  const firstDecisionByEvidence = new Map<string, number>();
  for (const decision of input.decisions) {
    const at = Date.parse(decision.recordedAt);
    if (Number.isNaN(at)) continue;
    const seen = firstDecisionByEvidence.get(decision.evidenceId);
    if (seen === undefined || at < seen) firstDecisionByEvidence.set(decision.evidenceId, at);
  }

  const settledAt = missing.includes("compile_settled_at") ? null : Date.parse(input.compileSettledAt as string);

  /*
    The denominator. The compile's own document set when we have it, otherwise the union of
    everything we can see -- which is smaller, and `missing` says so rather than pretending.
  */
  const ids = input.documentIds ?? [...new Set([
    ...evidenceByDocument.keys(),
    ...blockedById.keys(),
    ...documentById.keys(),
  ])];

  const rows = [...new Set(ids)].map<ReviewQueueRow>((documentId) => {
    const blocker = blockedById.get(documentId);
    const document = documentById.get(documentId);
    const evidenceIds = evidenceByDocument.get(documentId) ?? [];
    const reasons: string[] = [];
    if (blocker) reasons.push(blocker.reason);
    if (document?.processingState === "operator_review" && document.ocrReviewReasonCode) {
      reasons.push(document.ocrReviewReasonCode);
    }
    /*
      A review reason is attributed to a document when it names it -- the document id, or an
      evidence id compiled from it. Anything else stays a World-level reason and is not pinned
      to a row it cannot be shown to belong to.
    */
    for (const reason of input.reviewReasons) {
      if (reason.includes(documentId) || evidenceIds.some((id) => reason.includes(id))) reasons.push(reason);
    }

    const status: ReviewQueueStatus = blocker
      ? (blocker.kind === "security" ? "excluded" : "unprocessed")
      : document?.processingState === "operator_review"
        ? "under_review"
        : reasons.length > 0
          ? "under_review"
          : evidenceIds.length > 0
            ? "read"
            : "unprocessed";

    const decisionTimes = evidenceIds
      .map((id) => firstDecisionByEvidence.get(id))
      .filter((value): value is number => value !== undefined);
    const firstReview = decisionTimes.length > 0 ? Math.min(...decisionTimes) : null;

    return {
      documentId,
      name: input.names?.[documentId] ?? documentId,
      status,
      securityBlocked: blocker?.kind === "security",
      reasons: [...new Set(reasons)],
      evidenceCount: evidenceIds.length,
      firstReviewAt: firstReview === null ? null : new Date(firstReview).toISOString(),
      timeToFirstReviewMs: firstReview === null || settledAt === null ? null : Math.max(0, firstReview - settledAt),
    };
  }).sort(compareReviewQueueRows);

  const counts: Record<ReviewQueueStatus, number> = { excluded: 0, under_review: 0, unprocessed: 0, read: 0 };
  for (const row of rows) counts[row.status] += 1;

  return { rows, total: rows.length, counts, missing };
}

/** Every distinct reason string present in the queue, for a filter control. */
export function reviewQueueReasons(rows: ReviewQueueRow[]): string[] {
  return [...new Set(rows.flatMap((row) => row.reasons))].sort();
}

/** Filter by an exact recorded reason string. An empty filter keeps every row. */
export function filterReviewQueue(rows: ReviewQueueRow[], reason: string): ReviewQueueRow[] {
  if (reason === "") return rows;
  return rows.filter((row) => row.reasons.includes(reason));
}

/**
 * Elapsed time in the coarsest unit that is still true.
 *
 * Returns null for an unmeasured gap so the caller prints why rather than printing "0m".
 */
export function formatElapsed(ms: number | null): string | null {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return null;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ${minutes % 60} min`;
  return `${Math.floor(hours / 24)} d ${hours % 24} h`;
}

export const REVIEW_QUEUE_STATUS_COPY: Record<ReviewQueueStatus, string> = {
  excluded: "excluded by a safety check",
  under_review: "waiting for a review decision",
  unprocessed: "not read into this World",
  read: "read and bound to evidence",
};
