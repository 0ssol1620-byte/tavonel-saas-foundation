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
    recorded" -- never zero, never "now". A decision recorded before the compile settled is not
    a zero gap either, and the earliest decision in a truncated read is not the first one.
*/

import { displayName } from "@/lib/document-names";

/**
 * How many review decisions a caller must ask for before building a queue.
 *
 * `listFoundationReviewDecisions` orders `created_at.desc` and caps at 200, so a World with
 * more decisions than the window hands back rows that do not contain the *first* decision on
 * an older document -- and a later decision presented as the first one is a wrong number, not
 * a rounded one. A caller that filled its window says so (`decisionsTruncated`) and the
 * breakdown reports `review_decisions` under `missing` instead of reading as a measurement.
 */
export const REVIEW_DECISION_READ_LIMIT = 200;

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
  /**
   * The earliest review decision on this document's evidence among the decisions that were
   * read. It is the first decision only when that read was complete -- see `firstReviewAt`.
   * Optional so a row built outside `buildReviewQueue` still type-checks; absent reads as
   * `firstReviewAt`.
   */
  observedReviewAt?: string | null;
  /**
   * When the first review decision on this document's evidence was recorded. `null` when none
   * was read, and when the decision read was truncated: the earliest decision it holds may not
   * be the first, and `observedReviewAt` still carries it.
   */
  firstReviewAt: string | null;
  /**
   * Compile settled -> first review decision. `null` when either timestamp is unknown, and when
   * the first decision was recorded before the compile settled -- never a clamped zero.
   */
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
   * told so instead of being shown a reassuring zero. `review_decisions` means the decision
   * read was truncated, so a document decided only outside that window reads as undecided (and
   * sorts as one), and no row names a first decision or an elapsed time to it. `review_ledger`
   * means the decision ledger was not read at all (still loading, no session, or a failed read),
   * so no row is called decided, undecided or timed.
   */
  missing: Array<"compile_job" | "compile_settled_at" | "review_decisions" | "review_ledger">;
  /** The state of the decision read this breakdown was built from. */
  decisionsRead: ReviewLedgerStatus;
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
  /**
   * True when `decisions` is a truncated window -- the read returned as many rows as it asked
   * for, so older decisions exist that it cannot see. The queue then names the gap instead of
   * calling the earliest row it happens to hold the first decision.
   */
  decisionsTruncated?: boolean;
  /**
   * Whether `decisions` is the result of a completed, validated read. Absent means it is -- a
   * caller handing over decisions it already holds. Anything else means the ledger was not
   * read: `decisions` is ignored, and an empty list is not taken to mean "nobody decided".
   */
  decisionsRead?: ReviewLedgerStatus;
  names?: Record<string, string>;
};

/*
  The decision-ledger read, as the states it can actually be in.

  Only `ready` is an answer. Before the read settles, without a session to read with, or after
  a request that failed or came back in a shape this module does not recognise, the honest
  answer is "not known" -- and the queue must not print "no review decision recorded yet" over
  a read that never happened. `unavailable` (nothing to read with, or nothing to read for) and
  `error` (a read was attempted and did not give an answer) are kept apart so the copy can say
  which.
*/
export type ReviewLedgerReadState =
  | { status: "loading" }
  | { status: "unavailable"; reason: "collection" | "session" }
  | { status: "error"; reason: "session" | "request" | "status" | "malformed" }
  | { status: "ready"; decisions: Array<{ evidenceId: string; recordedAt: string }>; truncated: boolean };

export type ReviewLedgerStatus = ReviewLedgerReadState["status"];

/** A read result tagged with the collection and manifest it was read for. */
export type ScopedReviewLedger = { scope: string; state: ReviewLedgerReadState };

/** The identity a ledger read belongs to, or null when there is no compiled collection to read for. */
export function reviewLedgerScope(collectionId: string | null | undefined, manifestDigest: string | null | undefined): string | null {
  return collectionId && manifestDigest ? `${collectionId}\u0000${manifestDigest}` : null;
}

/**
 * The ledger state for the scope on screen now.
 *
 * A stored result for another collection or manifest is never shown: between a render that
 * changes the collection and the effect that starts the new read, the old decisions would
 * otherwise sit under the new compile for a frame. A mismatch reads as `loading`.
 */
export function currentReviewLedger(stored: ScopedReviewLedger | null, scope: string | null): ReviewLedgerReadState {
  if (scope === null) return { status: "unavailable", reason: "collection" };
  return stored !== null && stored.scope === scope ? stored.state : { status: "loading" };
}

/** The queue's decision inputs from a ledger state. Only a `ready` read contributes decisions. */
export function reviewQueueDecisionInput(
  state: ReviewLedgerReadState,
): Pick<ReviewQueueInput, "decisions" | "decisionsTruncated" | "decisionsRead"> {
  return state.status === "ready"
    ? { decisions: state.decisions, decisionsTruncated: state.truncated, decisionsRead: "ready" }
    : { decisions: [], decisionsTruncated: false, decisionsRead: state.status };
}

/** The subset of `fetch` the ledger read uses, so a test can hand it a deferred response. */
export type ReviewLedgerFetch = (
  url: string,
  init: { cache: "no-store"; headers: Record<string, string>; signal: AbortSignal },
) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

/*
  The identifier contract of the route that writes the ledger: `SHA256` and `EVIDENCE_ID` in
  app/api/v1/reviews/route.ts, copied verbatim (the route imports this module, so it cannot be
  imported back). POST refuses a decision whose manifest digest or evidence id does not match,
  so a listed row that does not match was not recorded through it -- and
  `listFoundationReviewDecisions` turns a null column into "", so a blank id does arrive as a
  string. Such a row is tested as-is, never trimmed or lower-cased into a valid one.
*/
const LEDGER_MANIFEST_DIGEST = /^sha256:[a-f0-9]{64}$/;
const LEDGER_EVIDENCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

function parseReviewLedgerBody(
  body: unknown,
  manifestDigest: string,
): Extract<ReviewLedgerReadState, { status: "ready" }> | null {
  if (typeof body !== "object" || body === null) return null;
  const { decisions, truncated } = body as { decisions?: unknown; truncated?: unknown };
  if (!Array.isArray(decisions)) return null;
  // Absent `truncated` keeps the route's earlier meaning (a window that was not full); any other non-boolean is not a reading.
  if (truncated !== undefined && typeof truncated !== "boolean") return null;
  const scoped: Array<{ evidenceId: string; recordedAt: string }> = [];
  for (const entry of decisions) {
    if (typeof entry !== "object" || entry === null) return null;
    const { evidenceId, recordedAt, manifestDigest: digest } = entry as Record<string, unknown>;
    // One unrecognisable row makes the read unknown: dropping it could hide the only decision on a document.
    if (typeof evidenceId !== "string" || typeof recordedAt !== "string" || typeof digest !== "string") return null;
    /*
      Checked before the manifest filter, on every row: a blank digest would otherwise be filtered
      out as "another revision" and a blank evidence id would match no evidence, and either way
      the queue would print "no decision yet" over a decision it could not read.
    */
    if (!LEDGER_MANIFEST_DIGEST.test(digest) || !LEDGER_EVIDENCE_ID.test(evidenceId)) return null;
    // A timestamp that does not parse is just as unrecognisable: the model would skip it and report no decision.
    if (!Number.isFinite(Date.parse(recordedAt))) return null;
    // Decisions on another revision of this collection are not decisions on this compile's evidence.
    if (digest === manifestDigest) scoped.push({ evidenceId, recordedAt });
  }
  return { status: "ready", decisions: scoped, truncated: truncated === true };
}

/**
 * Read the decision ledger for one collection revision.
 *
 * Resolves to `null` when `signal` was aborted at any point -- the caller has moved on to
 * another collection, manifest or refresh, and must publish nothing. An abort is never turned
 * into an empty `ready`. Every other outcome resolves to a state; this never rejects, so a
 * failing session lookup cannot surface as an unhandled rejection.
 */
export async function readReviewLedger(options: {
  collectionId: string;
  manifestDigest: string;
  /** The caller's bearer token; null or undefined when there is no session. May reject. */
  accessToken: () => Promise<string | null | undefined>;
  fetch: ReviewLedgerFetch;
  signal: AbortSignal;
}): Promise<ReviewLedgerReadState | null> {
  const { collectionId, manifestDigest, accessToken, fetch: request, signal } = options;
  if (signal.aborted) return null;
  let token: string | null | undefined;
  try {
    token = await accessToken();
  } catch {
    return signal.aborted ? null : { status: "error", reason: "session" };
  }
  if (signal.aborted) return null;
  if (!token) return { status: "unavailable", reason: "session" };
  let response: Awaited<ReturnType<ReviewLedgerFetch>>;
  try {
    response = await request(`/api/v1/reviews?collectionId=${encodeURIComponent(collectionId)}`, {
      cache: "no-store",
      headers: { authorization: `Bearer ${token}` },
      signal,
    });
  } catch {
    return signal.aborted ? null : { status: "error", reason: "request" };
  }
  if (signal.aborted) return null;
  if (!response.ok) return { status: "error", reason: "status" };
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return signal.aborted ? null : { status: "error", reason: "malformed" };
  }
  if (signal.aborted) return null;
  return parseReviewLedgerBody(body, manifestDigest) ?? { status: "error", reason: "malformed" };
}

const RANK: Record<ReviewQueueStatus, number> = { excluded: 0, under_review: 1, unprocessed: 2, read: 3 };

/**
 * Order by risk, using only signals the compile already recorded.
 *
 * Security stops first because continuing past one is never a one-click choice. Then the state
 * rank, then the number of recorded reasons, then documents with no decision observed, then the
 * id so the order is stable across renders. A decision that was read counts as decided even when
 * it cannot be called the first one.
 */
export function compareReviewQueueRows(left: ReviewQueueRow, right: ReviewQueueRow): number {
  if (left.securityBlocked !== right.securityBlocked) return left.securityBlocked ? -1 : 1;
  if (RANK[left.status] !== RANK[right.status]) return RANK[left.status] - RANK[right.status];
  if (left.reasons.length !== right.reasons.length) return right.reasons.length - left.reasons.length;
  const leftDecided = (left.observedReviewAt ?? left.firstReviewAt) !== null;
  const rightDecided = (right.observedReviewAt ?? right.firstReviewAt) !== null;
  if (leftDecided !== rightDecided) return leftDecided ? 1 : -1;
  return left.documentId.localeCompare(right.documentId);
}

export function buildReviewQueue(input: ReviewQueueInput): ReviewQueueBreakdown {
  const missing: ReviewQueueBreakdown["missing"] = [];
  if (input.documentIds === null) missing.push("compile_job");
  if (!input.compileSettledAt || Number.isNaN(Date.parse(input.compileSettledAt))) missing.push("compile_settled_at");
  const decisionsRead = input.decisionsRead ?? "ready";
  if (decisionsRead !== "ready") missing.push("review_ledger");
  else if (input.decisionsTruncated === true) missing.push("review_decisions");

  const blockedById = new Map(input.blocked.map((entry) => [entry.documentId, entry]));
  const documentById = new Map((input.documents ?? []).map((entry) => [entry.documentId, entry]));

  const evidenceByDocument = new Map<string, string[]>();
  for (const item of input.evidence) {
    const list = evidenceByDocument.get(item.sourceId);
    if (list) list.push(item.id);
    else evidenceByDocument.set(item.sourceId, [item.id]);
  }

  const firstDecisionByEvidence = new Map<string, number>();
  // An unread ledger contributes nothing, even if a caller passed decisions alongside it.
  for (const decision of decisionsRead === "ready" ? input.decisions : []) {
    const at = Date.parse(decision.recordedAt);
    if (Number.isNaN(at)) continue;
    const seen = firstDecisionByEvidence.get(decision.evidenceId);
    if (seen === undefined || at < seen) firstDecisionByEvidence.set(decision.evidenceId, at);
  }

  const settledAt = missing.includes("compile_settled_at") ? null : Date.parse(input.compileSettledAt as string);
  const historyComplete = decisionsRead === "ready" && !missing.includes("review_decisions");

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
    // ponytail: substring match. Ceiling: one document id contained in another id, or in an
    // evidence id, attributes the reason to both rows. Production ids are UUID-shaped
    // (lib/compile-job-store.ts), so this does not arise today; an anchored match needs the
    // reason string itself to delimit the id it names, which is lib/collection-compiler.ts's
    // format to change, not this module's.
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
    const earliestObserved = decisionTimes.length > 0 ? Math.min(...decisionTimes) : null;
    /*
      The earliest decision held is the first one only when the read was complete. A full window
      may have cut off an older decision, so the row keeps what was observed and leaves "first"
      unmeasured rather than promoting a later decision into it.
    */
    const firstReview = historyComplete ? earliestObserved : null;
    /*
      A first decision recorded before the compile settled has no honest elapsed time. It is not
      clamped to zero, and nothing here guesses why the order is reversed.
    */
    const elapsed = firstReview === null || settledAt === null || firstReview < settledAt
      ? null
      : firstReview - settledAt;

    return {
      documentId,
      // The same display rule as every other list: a remembered filename, else a readable form of the id.
      name: displayName(documentId, input.names ?? {}),
      status,
      securityBlocked: blocker?.kind === "security",
      reasons: [...new Set(reasons)],
      evidenceCount: evidenceIds.length,
      observedReviewAt: earliestObserved === null ? null : new Date(earliestObserved).toISOString(),
      firstReviewAt: firstReview === null ? null : new Date(firstReview).toISOString(),
      timeToFirstReviewMs: elapsed,
    };
  }).sort(compareReviewQueueRows);

  const counts: Record<ReviewQueueStatus, number> = { excluded: 0, under_review: 0, unprocessed: 0, read: 0 };
  for (const row of rows) counts[row.status] += 1;

  return { rows, total: rows.length, counts, missing, decisionsRead };
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
