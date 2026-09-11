"use client";

import { useMemo, useState } from "react";
import {
  buildReviewQueue,
  filterReviewQueue,
  formatElapsed,
  REVIEW_QUEUE_STATUS_COPY,
  reviewQueueReasons,
  type ReviewQueueInput,
  type ReviewQueueStatus,
} from "@/lib/review-queue";
import { formatTimestamp } from "@/lib/format";

/*
  The queue a reviewer works, and the breakdown a reader needs.

  The workspace already had accept/correct/reject and a side-by-side of source and result. What
  it did not have was an order: the list was whatever order the compiler emitted, so a security
  stop sat below a clean document and the reviewer found it by scrolling. This orders by the
  risk the compile already recorded, filters by the reason strings it already wrote, and says
  per document how long the first decision took.

  It is deliberately not a dashboard. No aggregate score, no chart, no derived "health": every
  number on screen is either a count of rows or a difference between two recorded timestamps.
*/

const ORDER: ReviewQueueStatus[] = ["excluded", "under_review", "unprocessed", "read"];

export default function ReviewQueue({
  input,
  compact = false,
  selectedDocumentId,
  onSelectDocument,
}: {
  input: ReviewQueueInput;
  /** Compile-panel form: the breakdown and the denominator, without the filter controls. */
  compact?: boolean;
  selectedDocumentId?: string | null;
  onSelectDocument?: (documentId: string) => void;
}) {
  const [reason, setReason] = useState("");
  const queue = useMemo(() => buildReviewQueue(input), [input]);
  const reasons = useMemo(() => reviewQueueReasons(queue.rows), [queue.rows]);
  const rows = useMemo(
    () => filterReviewQueue(queue.rows, reasons.includes(reason) ? reason : ""),
    [queue.rows, reason, reasons],
  );

  if (queue.total === 0) {
    return (
      <p className="world-empty" role="status">
        No document set is bound to this compile yet, so there is nothing to break down.
      </p>
    );
  }

  return (
    <div className="workspace-review-queue">
      <p className="fine">
        {ORDER.map((status) => `${queue.counts[status]} ${REVIEW_QUEUE_STATUS_COPY[status]}`).join(" · ")}
        {" · "}of {queue.total} source{queue.total === 1 ? "" : "s"} in this compile
      </p>
      {/*
        The breakdown is only as complete as its inputs, and saying so is the whole point: a
        missing compile-job row means excluded and unread documents cannot be listed, and a
        zero in those columns would be a lie the reader has no way to check.
      */}
      {queue.missing.includes("compile_job") ? (
        <p className="fine" role="status">
          No compile-job record was available for this World, so documents that were excluded or
          never read cannot be listed here. What is shown is what the compiled artifact carries.
        </p>
      ) : null}
      {queue.missing.includes("compile_settled_at") ? (
        <p className="fine" role="status">
          This compile has no settled time recorded, so time-to-first-review is not measured.
        </p>
      ) : null}

      {compact ? null : (
        <div>
          {/*
            Block layout, not the flex row the rest of this card uses, and an elided option
            label: a review reason may be 500 characters, and a `select` sizes itself to its
            widest option, which is how a filter control walks off the side of a 360px screen.
            The option's value stays the exact reason -- only the label is shortened, and every
            row below prints its reasons in full.
          */}
          <label className="fine" htmlFor="review-queue-reason-filter">Filter by review reason</label>
          <select
            id="review-queue-reason-filter"
            style={{ maxWidth: "100%" }}
            value={reasons.includes(reason) ? reason : ""}
            onChange={(event) => setReason(event.target.value)}
          >
            <option value="">All {queue.total} sources</option>
            {reasons.map((value) => (
              <option key={value} value={value}>{value.length > 40 ? `${value.slice(0, 39)}…` : value}</option>
            ))}
          </select>
          <p className="fine">
            {rows.length} of {queue.total} shown · ordered by safety stops, then review state, then
            recorded reasons. No severity score is computed.
          </p>
        </div>
      )}

      <ul className="document-meta" aria-label="Documents in this compile, most at risk first">
        {rows.map((row) => {
          const elapsed = formatElapsed(row.timeToFirstReviewMs);
          return (
            <li key={row.documentId} data-review-status={row.status} data-security={row.securityBlocked || undefined}>
              <strong>{row.name}</strong>
              <small>
                {row.securityBlocked ? "Stopped by a safety check · " : ""}
                {REVIEW_QUEUE_STATUS_COPY[row.status]}
                {row.evidenceCount > 0 ? ` · ${row.evidenceCount} evidence region${row.evidenceCount === 1 ? "" : "s"}` : ""}
              </small>
              {row.reasons.map((value) => <small key={value}>Reason: {value}</small>)}
              <small>
                {row.firstReviewAt === null
                  ? "No review decision recorded yet"
                  : elapsed === null
                    ? `First review decision ${formatTimestamp(row.firstReviewAt) ?? row.firstReviewAt} · elapsed not measured`
                    : `First review decision after ${elapsed}`}
              </small>
              {onSelectDocument && row.evidenceCount > 0 ? (
                <button
                  type="button"
                  aria-pressed={selectedDocumentId === row.documentId}
                  onClick={() => onSelectDocument(row.documentId)}
                >
                  Open its evidence
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
