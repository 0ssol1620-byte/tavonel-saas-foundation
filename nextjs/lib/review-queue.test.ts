import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ReviewQueue from "@/components/review-queue";
import {
  buildReviewQueue,
  filterReviewQueue,
  formatElapsed,
  REVIEW_DECISION_READ_LIMIT,
  reviewQueueReasons,
  type ReviewQueueInput,
} from "./review-queue";

/*
  Audit U03 (risk-first review) and U05 (per-document partial breakdown).

  The failure paths are the point of most of these: a missing compile-job row, a compile that
  has not settled, an unparseable decision time. Each one has exactly one honest answer -- say
  what is absent -- and the wrong answer in every case is a zero or a default that reads like a
  measurement.
*/

const SETTLED = "2026-09-11T00:00:00.000Z";

const base: ReviewQueueInput = {
  documentIds: ["doc-read", "doc-security", "doc-input", "doc-unread", "doc-reasoned"],
  blocked: [
    { documentId: "doc-security", kind: "security", reason: "ARCHIVE_ENCRYPTED" },
    { documentId: "doc-input", kind: "input", reason: "READING_DID_NOT_FINISH" },
  ],
  compileSettledAt: SETTLED,
  documents: [
    { documentId: "doc-read", hasOcrJson: true, processingState: "ocr_ready" },
    { documentId: "doc-reasoned", hasOcrJson: true, processingState: "ocr_ready" },
    { documentId: "doc-unread", hasOcrJson: false, processingState: "sanitized" },
  ],
  reviewReasons: ["AUTHORITY_CONFLICT doc-reasoned", "GLOBAL_REASON_WITH_NO_DOCUMENT"],
  evidence: [
    { id: "ev-1:chunk-1", sourceId: "doc-read" },
    { id: "ev-1:chunk-2", sourceId: "doc-read" },
    { id: "ev-2:chunk-1", sourceId: "doc-reasoned" },
  ],
  decisions: [{ evidenceId: "ev-1:chunk-1", recordedAt: "2026-09-11T00:45:00.000Z" }],
  names: { "doc-read": "Master agreement.pdf" },
};

describe("review queue ordering", () => {
  it("puts the security stop first and the clean read last", () => {
    const queue = buildReviewQueue(base);
    expect(queue.rows.map((row) => row.documentId)).toEqual([
      "doc-security",
      "doc-reasoned",
      "doc-input",
      "doc-unread",
      "doc-read",
    ]);
    expect(queue.rows[0].securityBlocked).toBe(true);
    expect(queue.total).toBe(5);
    expect(queue.counts).toEqual({ excluded: 1, under_review: 1, unprocessed: 2, read: 1 });
  });

  it("orders a document with more recorded reasons ahead of one with fewer, inside the same state", () => {
    const queue = buildReviewQueue({
      ...base,
      documentIds: ["doc-one-reason", "doc-two-reasons"],
      blocked: [],
      documents: [],
      reviewReasons: ["A doc-one-reason", "B doc-two-reasons", "C doc-two-reasons"],
      evidence: [],
      decisions: [],
      names: {},
    });
    expect(queue.rows.map((row) => row.documentId)).toEqual(["doc-two-reasons", "doc-one-reason"]);
    expect(queue.rows[0].reasons).toHaveLength(2);
  });

  it("orders an undecided document ahead of a decided one that is otherwise identical", () => {
    const queue = buildReviewQueue({
      ...base,
      documentIds: ["doc-a", "doc-b"],
      blocked: [],
      documents: [],
      reviewReasons: [],
      evidence: [{ id: "ev-a:1", sourceId: "doc-a" }, { id: "ev-b:1", sourceId: "doc-b" }],
      decisions: [{ evidenceId: "ev-a:1", recordedAt: "2026-09-11T01:00:00.000Z" }],
      names: {},
    });
    expect(queue.rows.map((row) => row.documentId)).toEqual(["doc-b", "doc-a"]);
  });

  it("never attributes a review reason that does not name the document or its evidence", () => {
    const queue = buildReviewQueue(base);
    const reasons = queue.rows.flatMap((row) => row.reasons);
    expect(reasons).not.toContain("GLOBAL_REASON_WITH_NO_DOCUMENT");
    expect(queue.rows.find((row) => row.documentId === "doc-reasoned")?.reasons)
      .toEqual(["AUTHORITY_CONFLICT doc-reasoned"]);
  });
});

describe("review queue filtering", () => {
  it("lists exactly the reason strings the compile recorded", () => {
    expect(reviewQueueReasons(buildReviewQueue(base).rows)).toEqual([
      "ARCHIVE_ENCRYPTED",
      "AUTHORITY_CONFLICT doc-reasoned",
      "READING_DID_NOT_FINISH",
    ]);
  });

  it("keeps only rows carrying the selected reason, and keeps everything for an empty filter", () => {
    const rows = buildReviewQueue(base).rows;
    expect(filterReviewQueue(rows, "ARCHIVE_ENCRYPTED").map((row) => row.documentId)).toEqual(["doc-security"]);
    expect(filterReviewQueue(rows, "")).toHaveLength(5);
  });

  it("returns nothing for a reason no row carries rather than silently falling back to every row", () => {
    expect(filterReviewQueue(buildReviewQueue(base).rows, "NOT_A_RECORDED_REASON")).toEqual([]);
  });
});

describe("time to first review", () => {
  it("measures compile settled to the first decision on that document", () => {
    const row = buildReviewQueue(base).rows.find((entry) => entry.documentId === "doc-read");
    expect(row?.timeToFirstReviewMs).toBe(45 * 60_000);
    expect(formatElapsed(row?.timeToFirstReviewMs ?? null)).toBe("45 min");
  });

  it("takes the earliest decision when a document has several", () => {
    const queue = buildReviewQueue({
      ...base,
      decisions: [
        { evidenceId: "ev-1:chunk-2", recordedAt: "2026-09-11T03:00:00.000Z" },
        { evidenceId: "ev-1:chunk-1", recordedAt: "2026-09-11T00:10:00.000Z" },
      ],
    });
    expect(queue.rows.find((row) => row.documentId === "doc-read")?.timeToFirstReviewMs).toBe(10 * 60_000);
  });

  it("reports no elapsed time, not zero, when the compile has no settled time", () => {
    const queue = buildReviewQueue({ ...base, compileSettledAt: null });
    expect(queue.missing).toContain("compile_settled_at");
    expect(queue.rows.every((row) => row.timeToFirstReviewMs === null)).toBe(true);
    expect(queue.rows.find((row) => row.documentId === "doc-read")?.firstReviewAt).toBe("2026-09-11T00:45:00.000Z");
  });

  it("ignores an unparseable decision time instead of treating it as now", () => {
    const queue = buildReviewQueue({ ...base, decisions: [{ evidenceId: "ev-1:chunk-1", recordedAt: "not-a-time" }] });
    expect(queue.rows.find((row) => row.documentId === "doc-read")?.firstReviewAt).toBeNull();
  });

  it("refuses to format a negative or missing elapsed time", () => {
    expect(formatElapsed(null)).toBeNull();
    expect(formatElapsed(-1)).toBeNull();
    expect(formatElapsed(Number.NaN)).toBeNull();
    expect(formatElapsed(30_000)).toBe("under a minute");
    expect(formatElapsed(3 * 3_600_000 + 12 * 60_000)).toBe("3 h 12 min");
    expect(formatElapsed(50 * 3_600_000)).toBe("2 d 2 h");
  });
});

describe("a missing compile-job row", () => {
  it("names what is absent instead of reporting zero excluded documents", () => {
    const queue = buildReviewQueue({ ...base, documentIds: null, blocked: [], compileSettledAt: null });
    expect(queue.missing).toEqual(["compile_job", "compile_settled_at"]);
    expect(queue.counts.excluded).toBe(0);
    // The denominator falls back to what can actually be seen -- three of the compile's five.
    expect(queue.total).toBe(3);
    expect(queue.rows.map((row) => row.documentId)).toEqual(["doc-reasoned", "doc-unread", "doc-read"]);
  });

  it("says so on screen", () => {
    const markup = renderToStaticMarkup(createElement(ReviewQueue, {
      input: { ...base, documentIds: null, blocked: [], compileSettledAt: null },
    }));
    expect(markup).toContain("cannot be listed here");
    expect(markup).toContain("time-to-first-review is not measured");
  });
});

describe("a truncated review-decision read", () => {
  /*
    The decision read is newest-first and bounded, so a World with more decisions than the
    window hands back rows that may not contain the first decision on a document. The queue
    must not present the earliest row it happens to hold as "the first review".
  */
  it("names the gap rather than calling a later decision the first one", () => {
    const queue = buildReviewQueue({ ...base, decisionsTruncated: true });
    expect(queue.missing).toEqual(["review_decisions"]);
    // The rows still render: a truncated window is incomplete, not useless.
    expect(queue.total).toBe(5);
  });

  it("claims nothing of the sort when the window was not full", () => {
    expect(buildReviewQueue({ ...base, decisionsTruncated: false }).missing).toEqual([]);
    expect(buildReviewQueue(base).missing).toEqual([]);
  });

  it("says so on screen, with the window size it actually read", () => {
    const markup = renderToStaticMarkup(createElement(ReviewQueue, {
      input: { ...base, decisionsTruncated: true },
    }));
    expect(markup).toContain(`More than ${REVIEW_DECISION_READ_LIMIT} review decisions`);
    expect(markup).toContain("ordered as if it were still undecided");
    expect(renderToStaticMarkup(createElement(ReviewQueue, { input: base })))
      .not.toContain("review decisions are recorded for this World");
  });
});

describe("the rendered queue", () => {
  it("prints the denominator, the safety stop and the elapsed decision time", () => {
    const markup = renderToStaticMarkup(createElement(ReviewQueue, { input: base }));
    expect(markup).toContain("of 5 sources in this compile");
    expect(markup).toContain("Stopped by a safety check");
    expect(markup).toContain("First review decision after 45 min");
    expect(markup).toContain("No review decision recorded yet");
    expect(markup).toContain("Master agreement.pdf");
    // No synthesised severity anywhere: the copy says so, and nothing prints a score.
    expect(markup).toContain("No severity score is computed");
  });

  it("offers the reason filter with exactly the recorded reasons, and hides it when compact", () => {
    const full = renderToStaticMarkup(createElement(ReviewQueue, { input: base }));
    expect(full).toContain("ARCHIVE_ENCRYPTED");
    expect(full).toContain("Filter by review reason");
    const compact = renderToStaticMarkup(createElement(ReviewQueue, { input: base, compact: true }));
    expect(compact).not.toContain("Filter by review reason");
    expect(compact).toContain("of 5 sources in this compile");
  });

  it("elides a long reason in the filter label but keeps the exact reason as its value", () => {
    const long = `AUTHORITY_CONFLICT ${"x".repeat(200)} doc-long`;
    const markup = renderToStaticMarkup(createElement(ReviewQueue, {
      input: { ...base, documentIds: ["doc-long"], blocked: [], documents: [], reviewReasons: [long], evidence: [], decisions: [], names: {} },
    }));
    // A select sizes itself to its widest option, which is how a 360px screen overflows.
    expect(markup).toContain("…</option>");
    expect(markup).not.toContain(`>${long}</option>`);
    expect(markup).toContain(`value="${long}"`);
    // The row itself still prints the reason in full.
    expect(markup).toContain(`Reason: ${long}`);
  });

  it("says there is nothing to break down rather than printing an empty table", () => {
    const markup = renderToStaticMarkup(createElement(ReviewQueue, {
      input: { documentIds: [], blocked: [], compileSettledAt: null, reviewReasons: [], evidence: [], decisions: [] },
    }));
    expect(markup).toContain("nothing to break down");
  });
});
