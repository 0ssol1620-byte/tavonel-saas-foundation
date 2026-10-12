import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ReviewQueue from "@/components/review-queue";
import { formatTimestamp } from "@/lib/format";
import {
  buildReviewQueue,
  compareReviewQueueRows,
  currentReviewLedger,
  filterReviewQueue,
  formatElapsed,
  readReviewLedger,
  REVIEW_DECISION_READ_LIMIT,
  reviewLedgerScope,
  reviewQueueDecisionInput,
  reviewQueueReasons,
  type ReviewLedgerFetch,
  type ReviewLedgerReadState,
  type ReviewQueueInput,
  type ScopedReviewLedger,
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
    // With the whole history read, the earliest decision seen is the first one.
    expect(row?.firstReviewAt).toBe("2026-09-11T00:45:00.000Z");
    expect(row?.observedReviewAt).toBe(row?.firstReviewAt);
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

  it("says so on screen, with the window size it actually read and no count it cannot know", () => {
    const markup = renderToStaticMarkup(createElement(ReviewQueue, {
      input: { ...base, decisionsTruncated: true },
    }));
    expect(markup).toContain(`full window of the newest ${REVIEW_DECISION_READ_LIMIT}`);
    expect(markup).toContain("older decisions may exist");
    expect(markup).toContain("is ordered as undecided");
    // A full window is not evidence of more than the limit.
    expect(markup).not.toContain(`More than ${REVIEW_DECISION_READ_LIMIT}`);
    expect(renderToStaticMarkup(createElement(ReviewQueue, { input: base })))
      .not.toContain("full window");
  });

  it("keeps the decision it read but does not call it the first, or time it", () => {
    const complete = buildReviewQueue(base);
    const queue = buildReviewQueue({ ...base, decisionsTruncated: true });
    const row = queue.rows.find((entry) => entry.documentId === "doc-read");
    expect(row?.observedReviewAt).toBe("2026-09-11T00:45:00.000Z");
    expect(row?.firstReviewAt).toBeNull();
    expect(row?.timeToFirstReviewMs).toBeNull();
    // Status, risk and order come from what was recorded, not from the history gap.
    expect(row?.status).toBe("read");
    expect(queue.counts).toEqual(complete.counts);
    expect(queue.rows.map((entry) => [entry.documentId, entry.status, entry.securityBlocked, entry.reasons]))
      .toEqual(complete.rows.map((entry) => [entry.documentId, entry.status, entry.securityBlocked, entry.reasons]));
  });

  it("still orders a document with an observed decision after an undecided one", () => {
    const queue = buildReviewQueue({
      ...base,
      documentIds: ["doc-a", "doc-b"],
      blocked: [],
      documents: [],
      reviewReasons: [],
      evidence: [{ id: "ev-a:1", sourceId: "doc-a" }, { id: "ev-b:1", sourceId: "doc-b" }],
      decisions: [{ evidenceId: "ev-a:1", recordedAt: "2026-09-11T01:00:00.000Z" }],
      decisionsTruncated: true,
      names: {},
    });
    expect(queue.rows.map((row) => row.documentId)).toEqual(["doc-b", "doc-a"]);
  });

  it("shows the observed time qualified, and no first-review duration, on screen", () => {
    const markup = renderToStaticMarkup(createElement(ReviewQueue, {
      input: { ...base, decisionsTruncated: true },
    }));
    expect(markup).not.toContain("First review decision");
    expect(markup).toContain(`Review decision recorded ${formatTimestamp("2026-09-11T00:45:00.000Z")}`);
    expect(markup).toContain("not necessarily the first");
    // A document with nothing in the window is not claimed to have never been decided.
    expect(markup).toContain("No review decision among the decisions read");
    expect(markup).not.toContain("No review decision recorded yet");
  });

  it("qualifies the window even when it holds no decision for any document", () => {
    const markup = renderToStaticMarkup(createElement(ReviewQueue, {
      input: { ...base, decisions: [], decisionsTruncated: true },
    }));
    expect(markup).toContain("older decisions may exist");
    expect(markup).toContain("No review decision among the decisions read");
    expect(markup).not.toContain("No review decision recorded yet");
  });
});

describe("a decision recorded before the compile settled", () => {
  const early = { ...base, decisions: [{ evidenceId: "ev-1:chunk-1", recordedAt: "2026-09-10T23:45:00.000Z" }] };

  it("keeps the decision time and leaves the elapsed time unmeasured instead of zero", () => {
    const row = buildReviewQueue(early).rows.find((entry) => entry.documentId === "doc-read");
    expect(row?.firstReviewAt).toBe("2026-09-10T23:45:00.000Z");
    expect(row?.timeToFirstReviewMs).toBeNull();
    expect(row?.status).toBe("read");
  });

  it("says so on screen without printing a manufactured duration", () => {
    const markup = renderToStaticMarkup(createElement(ReviewQueue, { input: early }));
    expect(markup).not.toContain("under a minute");
    expect(markup).not.toContain("First review decision after");
    expect(markup).toContain(`First review decision ${formatTimestamp("2026-09-10T23:45:00.000Z")}`);
    expect(markup).toContain("recorded before this compile settled");
  });

  it("keeps the plain unmeasured wording when it is the settled time that is missing", () => {
    const markup = renderToStaticMarkup(createElement(ReviewQueue, { input: { ...base, compileSettledAt: null } }));
    expect(markup).toContain("elapsed not measured");
    expect(markup).not.toContain("recorded before this compile settled");
  });
});

describe("rows built outside the queue", () => {
  it("order on firstReviewAt when observedReviewAt is absent", () => {
    const row = {
      documentId: "doc-x",
      name: "doc-x",
      status: "read" as const,
      securityBlocked: false,
      reasons: [],
      evidenceCount: 1,
      firstReviewAt: null,
      timeToFirstReviewMs: null,
    };
    const decided = { ...row, documentId: "doc-y", firstReviewAt: "2026-09-11T00:45:00.000Z" };
    expect([decided, row].sort(compareReviewQueueRows).map((entry) => entry.documentId)).toEqual(["doc-x", "doc-y"]);
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

/*
  The decision-ledger read the workspace page performs. An empty `decisions` list is an answer
  only when a scoped read completed and validated; loading, no session, a failed request and an
  unreadable body are all "not known", and an aborted read publishes nothing at all.
*/

// Digests in the route's SHA256 form; the read now refuses any other shape.
const MANIFEST = `sha256:${"0123456789abcdef".repeat(4)}`;
const OTHER_MANIFEST = `sha256:${"fedcba9876543210".repeat(4)}`;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function okJson(body: unknown) {
  return { ok: true, json: async () => body };
}

function ledgerHarness(options: {
  token?: () => Promise<string | null | undefined>;
  respond?: (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;
  collectionId?: string;
} = {}) {
  const controller = new AbortController();
  const calls: Array<{ url: string; init: Parameters<ReviewLedgerFetch>[1] }> = [];
  let sessionReads = 0;
  const fetch: ReviewLedgerFetch = (url, init) => {
    calls.push({ url, init });
    return options.respond ? options.respond(url) : Promise.resolve(okJson({ decisions: [], truncated: false }));
  };
  const read = () => readReviewLedger({
    collectionId: options.collectionId ?? "col-1",
    manifestDigest: MANIFEST,
    accessToken: () => {
      sessionReads += 1;
      return options.token ? options.token() : Promise.resolve("token-1");
    },
    fetch,
    signal: controller.signal,
  });
  return { controller, calls, read, sessionReads: () => sessionReads };
}

const UNREAD_STATES: Array<[ReviewLedgerReadState, string, string]> = [
  [{ status: "loading" }, "still being read", "Review decisions not read yet"],
  [{ status: "unavailable", reason: "session" }, "no signed-in session", "Review decisions not available"],
  [{ status: "error", reason: "status" }, "failed or came back unreadable", "Review decisions could not be read"],
];

describe("an unread decision ledger", () => {
  it("is loading, not empty, before a read for this scope has settled", () => {
    const scope = reviewLedgerScope("col-1", MANIFEST);
    expect(currentReviewLedger(null, scope)).toEqual({ status: "loading" });
    expect(reviewQueueDecisionInput({ status: "loading" }))
      .toEqual({ decisions: [], decisionsTruncated: false, decisionsRead: "loading" });
  });

  it("is unavailable when there is no compiled collection to read for", () => {
    expect(reviewLedgerScope(undefined, MANIFEST)).toBeNull();
    expect(reviewLedgerScope("col-1", null)).toBeNull();
    expect(currentReviewLedger(null, null)).toEqual({ status: "unavailable", reason: "collection" });
  });

  it("never shows another scope's decisions while the new read has not reset the state", () => {
    const old: ScopedReviewLedger = {
      scope: reviewLedgerScope("col-1", OTHER_MANIFEST) as string,
      state: { status: "ready", decisions: [{ evidenceId: "ev-1:chunk-1", recordedAt: "2026-09-11T00:45:00.000Z" }], truncated: false },
    };
    const state = currentReviewLedger(old, reviewLedgerScope("col-1", MANIFEST));
    expect(state).toEqual({ status: "loading" });
    expect(currentReviewLedger(old, reviewLedgerScope("col-2", OTHER_MANIFEST))).toEqual({ status: "loading" });
    const markup = renderToStaticMarkup(createElement(ReviewQueue, { input: { ...base, ...reviewQueueDecisionInput(state) } }));
    expect(markup).not.toContain("First review decision");
    expect(markup).toContain("Review decisions not read yet");
  });

  it("ignores decisions handed over alongside a state that is not ready", () => {
    const queue = buildReviewQueue({ ...base, decisionsRead: "error" });
    expect(queue.missing).toEqual(["review_ledger"]);
    expect(queue.decisionsRead).toBe("error");
    for (const row of queue.rows) {
      expect(row.observedReviewAt).toBeNull();
      expect(row.firstReviewAt).toBeNull();
      expect(row.timeToFirstReviewMs).toBeNull();
    }
    // Status, risk and order still come from the compile's own record.
    expect(queue.counts).toEqual(buildReviewQueue(base).counts);
    expect(queue.rows[0].documentId).toBe("doc-security");
  });

  it("keeps a legacy input, with no read state, as a complete read", () => {
    const queue = buildReviewQueue(base);
    expect(queue.decisionsRead).toBe("ready");
    expect(queue.missing).toEqual([]);
  });

  for (const [state, notice, row] of UNREAD_STATES) {
    it(`says ${state.status} on screen instead of "no decision yet" or a first-review time`, () => {
      const markup = renderToStaticMarkup(createElement(ReviewQueue, { input: { ...base, ...reviewQueueDecisionInput(state) } }));
      expect(markup).toContain(notice);
      expect(markup).toContain(row);
      expect(markup).not.toContain("No review decision recorded yet");
      expect(markup).not.toContain("No review decision among the decisions read");
      expect(markup).not.toContain("First review decision");
      expect(markup).not.toContain("full window");
      // The compile's own breakdown still renders.
      expect(markup).toContain("of 5 sources in this compile");
      expect(markup).toContain("Stopped by a safety check");
    });
  }
});

describe("reading the decision ledger", () => {
  it("issues one scoped GET with the bearer token, no-store and the caller's signal", async () => {
    const harness = ledgerHarness({ collectionId: "col/1 ?" });
    await harness.read();
    expect(harness.calls).toHaveLength(1);
    expect(harness.calls[0].url).toBe(`/api/v1/reviews?collectionId=${encodeURIComponent("col/1 ?")}`);
    expect(harness.calls[0].init).toEqual({ cache: "no-store", headers: { authorization: "Bearer token-1" }, signal: harness.controller.signal });
    expect(harness.calls[0].init).not.toHaveProperty("method");
    expect(harness.sessionReads()).toBe(1);
  });

  it("is unavailable, without a request, when there is no session", async () => {
    for (const token of [null, undefined, ""]) {
      const harness = ledgerHarness({ token: async () => token });
      await expect(harness.read()).resolves.toEqual({ status: "unavailable", reason: "session" });
      expect(harness.calls).toHaveLength(0);
    }
  });

  it("is an error, not a rejection, when the session lookup throws", async () => {
    const harness = ledgerHarness({ token: () => Promise.reject(new Error("storage unavailable")) });
    await expect(harness.read()).resolves.toEqual({ status: "error", reason: "session" });
    expect(harness.calls).toHaveLength(0);
  });

  it("is an error when the request fails or the route answers non-OK", async () => {
    await expect(ledgerHarness({ respond: () => Promise.reject(new TypeError("network")) }).read())
      .resolves.toEqual({ status: "error", reason: "request" });
    let parsed = false;
    const notOk = ledgerHarness({ respond: async () => ({ ok: false, json: async () => { parsed = true; return { decisions: [] }; } }) });
    await expect(notOk.read()).resolves.toEqual({ status: "error", reason: "status" });
    expect(parsed).toBe(false);
  });

  it("is malformed when the body is not the route's shape, rather than an empty answer", async () => {
    const bodies: unknown[] = [
      null,
      "decisions",
      {},
      { decisions: "none" },
      { decisions: [null] },
      { decisions: [{ evidenceId: "ev-1:chunk-1", recordedAt: "2026-09-11T00:45:00.000Z" }] },
      { decisions: [{ evidenceId: 1, recordedAt: "2026-09-11T00:45:00.000Z", manifestDigest: MANIFEST }] },
      { decisions: [], truncated: "yes" },
    ];
    for (const body of bodies) {
      await expect(ledgerHarness({ respond: async () => okJson(body) }).read())
        .resolves.toEqual({ status: "error", reason: "malformed" });
    }
    await expect(ledgerHarness({ respond: async () => ({ ok: true, json: () => Promise.reject(new SyntaxError("Unexpected token")) }) }).read())
      .resolves.toEqual({ status: "error", reason: "malformed" });
  });

  it("is a ready, complete empty answer only for a validated 200 with no decisions", async () => {
    const state = await ledgerHarness({ respond: async () => okJson({ decisions: [], truncated: false }) }).read();
    expect(state).toEqual({ status: "ready", decisions: [], truncated: false });
    const markup = renderToStaticMarkup(createElement(ReviewQueue, {
      input: { ...base, ...reviewQueueDecisionInput(state as ReviewLedgerReadState) },
    }));
    expect(markup).toContain("No review decision recorded yet");
    expect(markup).not.toContain("still being read");
    expect(markup).not.toContain("could not be read");
  });

  it("keeps only this manifest's decisions, so another revision's decision is not this compile's", async () => {
    const state = await ledgerHarness({
      respond: async () => okJson({
        decisions: [
          { evidenceId: "ev-1:chunk-1", recordedAt: "2026-09-11T00:45:00.000Z", manifestDigest: MANIFEST },
          { evidenceId: "ev-1:chunk-2", recordedAt: "2026-09-11T00:05:00.000Z", manifestDigest: OTHER_MANIFEST },
          { evidenceId: "ev-2:chunk-1", recordedAt: "2026-09-11T00:20:00.000Z", manifestDigest: OTHER_MANIFEST },
        ],
        truncated: false,
      }),
    }).read();
    expect(state).toEqual({
      status: "ready",
      decisions: [{ evidenceId: "ev-1:chunk-1", recordedAt: "2026-09-11T00:45:00.000Z" }],
      truncated: false,
    });
    const queue = buildReviewQueue({ ...base, ...reviewQueueDecisionInput(state as ReviewLedgerReadState) });
    expect(queue.rows.find((row) => row.documentId === "doc-read")?.timeToFirstReviewMs).toBe(45 * 60_000);
    expect(queue.rows.find((row) => row.documentId === "doc-reasoned")?.firstReviewAt).toBeNull();
  });

  it("is malformed when this manifest's only decision has an empty or unparseable time, never \"no decision yet\"", async () => {
    for (const recordedAt of ["", "not-a-timestamp"]) {
      const state = await ledgerHarness({
        respond: async () => okJson({ decisions: [{ evidenceId: "ev-1:chunk-1", recordedAt, manifestDigest: MANIFEST }], truncated: false }),
      }).read();
      expect(state).toEqual({ status: "error", reason: "malformed" });
      const markup = renderToStaticMarkup(createElement(ReviewQueue, {
        input: { ...base, ...reviewQueueDecisionInput(state as ReviewLedgerReadState) },
      }));
      expect(markup).toContain("Review decisions could not be read");
      expect(markup).not.toContain("No review decision recorded yet");
      expect(markup).not.toContain("First review decision");
    }
  });

  it("keeps the same decision ready and timed when its time is a valid timestamp", async () => {
    const state = await ledgerHarness({
      respond: async () => okJson({
        decisions: [{ evidenceId: "ev-1:chunk-1", recordedAt: "2026-09-11T00:45:00.000Z", manifestDigest: MANIFEST }],
        truncated: false,
      }),
    }).read();
    expect(state).toEqual({
      status: "ready",
      decisions: [{ evidenceId: "ev-1:chunk-1", recordedAt: "2026-09-11T00:45:00.000Z" }],
      truncated: false,
    });
    const markup = renderToStaticMarkup(createElement(ReviewQueue, {
      input: { ...base, ...reviewQueueDecisionInput(state as ReviewLedgerReadState) },
    }));
    expect(markup).toContain("First review decision after 45 min");
    expect(markup).not.toContain("could not be read");
  });

  it("passes a truncated 200 through as truncated, and a missing flag as a window that was not full", async () => {
    const truncated = await ledgerHarness({ respond: async () => okJson({ decisions: [], truncated: true }) }).read();
    expect(truncated).toEqual({ status: "ready", decisions: [], truncated: true });
    expect(buildReviewQueue({ ...base, ...reviewQueueDecisionInput(truncated as ReviewLedgerReadState) }).missing)
      .toEqual(["review_decisions"]);
    await expect(ledgerHarness({ respond: async () => okJson({ decisions: [] }) }).read())
      .resolves.toEqual({ status: "ready", decisions: [], truncated: false });
  });
});

/*
  Identifiers on a listed decision, held to the route's own contract (SHA256 and EVIDENCE_ID in
  app/api/v1/reviews/route.ts). The store turns a null column into "", so a blank id reaches the
  read as a string; it must make the read unknown, not filter into an empty answer.
*/
describe("review ledger identifiers", () => {
  const AT = "2026-09-11T00:45:00.000Z";

  async function readRows(decisions: unknown[]) {
    return ledgerHarness({ respond: async () => okJson({ decisions, truncated: false }) }).read();
  }

  function render(state: ReviewLedgerReadState | null) {
    return renderToStaticMarkup(createElement(ReviewQueue, {
      input: { ...base, ...reviewQueueDecisionInput(state as ReviewLedgerReadState) },
    }));
  }

  function expectUnknown(state: ReviewLedgerReadState | null) {
    expect(state).toEqual({ status: "error", reason: "malformed" });
    const markup = render(state);
    expect(markup).toContain("Review decisions could not be read");
    expect(markup).not.toContain("No review decision recorded yet");
    expect(markup).not.toContain("First review decision");
  }

  it("review ledger identifier: an empty or whitespace evidence id is malformed, even with a parseable time", async () => {
    for (const evidenceId of ["", " ", "   \t"]) {
      expectUnknown(await readRows([{ evidenceId, recordedAt: AT, manifestDigest: MANIFEST }]));
    }
  });

  it("review ledger identifier: an evidence id outside the route's EVIDENCE_ID is malformed, not trimmed into a match", async () => {
    for (const evidenceId of [
      " ev-1:chunk-1",
      "ev-1:chunk-1 ",
      "ev-1:chunk-1\n",
      "-ev-1:chunk-1",
      "ev 1:chunk-1",
      "ev-1/chunk-1",
      `e${"x".repeat(256)}`,
    ]) {
      expectUnknown(await readRows([{ evidenceId, recordedAt: AT, manifestDigest: MANIFEST }]));
    }
  });

  it("review ledger identifier: an empty or whitespace manifest digest is malformed, not another revision", async () => {
    for (const manifestDigest of ["", " ", "   \t"]) {
      expectUnknown(await readRows([{ evidenceId: "ev-1:chunk-1", recordedAt: AT, manifestDigest }]));
    }
  });

  it("review ledger identifier: a digest outside the route's SHA256 is malformed, not normalised into this manifest", async () => {
    for (const manifestDigest of [
      ` ${MANIFEST}`,
      `${MANIFEST} `,
      `${MANIFEST}\n`,
      MANIFEST.toUpperCase(),
      `sha256:${"0123456789ABCDEF".repeat(4)}`,
      "0123456789abcdef".repeat(4),
      MANIFEST.slice(0, -1),
      `${MANIFEST}0`,
      `sha512:${"0123456789abcdef".repeat(4)}`,
    ]) {
      expectUnknown(await readRows([{ evidenceId: "ev-1:chunk-1", recordedAt: AT, manifestDigest }]));
    }
  });

  it("review ledger identifier: a malformed row is not dropped beside a well-formed decision on this manifest", async () => {
    const good = { evidenceId: "ev-1:chunk-1", recordedAt: AT, manifestDigest: MANIFEST };
    expectUnknown(await readRows([good, { evidenceId: "ev-2:chunk-1", recordedAt: AT, manifestDigest: "" }]));
    expectUnknown(await readRows([good, { evidenceId: "", recordedAt: AT, manifestDigest: OTHER_MANIFEST }]));
  });

  it("review ledger identifier: well-formed decisions on another manifest are still a successful empty read", async () => {
    const state = await readRows([
      { evidenceId: "ev-1:chunk-1", recordedAt: AT, manifestDigest: OTHER_MANIFEST },
      { evidenceId: "ev-2:chunk-1", recordedAt: "2026-09-11T00:20:00.000Z", manifestDigest: OTHER_MANIFEST },
    ]);
    expect(state).toEqual({ status: "ready", decisions: [], truncated: false });
    const markup = render(state);
    expect(markup).toContain("No review decision recorded yet");
    expect(markup).not.toContain("could not be read");
  });

  it("review ledger identifier: route punctuation and the 256-character limit are accepted and matched as-is", async () => {
    const punctuated = "EV_7.page-3:chunk.12";
    const longest = `e${"x".repeat(255)}`;
    const state = await readRows([
      { evidenceId: punctuated, recordedAt: AT, manifestDigest: MANIFEST },
      { evidenceId: longest, recordedAt: "2026-09-11T01:00:00.000Z", manifestDigest: MANIFEST },
    ]);
    expect(state).toEqual({
      status: "ready",
      decisions: [
        { evidenceId: punctuated, recordedAt: AT },
        { evidenceId: longest, recordedAt: "2026-09-11T01:00:00.000Z" },
      ],
      truncated: false,
    });
    const queue = buildReviewQueue({
      ...base,
      evidence: [{ id: punctuated, sourceId: "doc-read" }, { id: longest, sourceId: "doc-reasoned" }],
      ...reviewQueueDecisionInput(state as ReviewLedgerReadState),
    });
    expect(queue.rows.find((row) => row.documentId === "doc-read")?.timeToFirstReviewMs).toBe(45 * 60_000);
    expect(queue.rows.find((row) => row.documentId === "doc-reasoned")?.firstReviewAt).toBe("2026-09-11T01:00:00.000Z");
  });
});

describe("an aborted decision-ledger read", () => {
  it("publishes nothing when aborted while the session is resolving, and never requests", async () => {
    const session = deferred<string | null>();
    const harness = ledgerHarness({ token: () => session.promise });
    const pending = harness.read();
    harness.controller.abort();
    session.resolve("token-1");
    await expect(pending).resolves.toBeNull();
    expect(harness.calls).toHaveLength(0);
  });

  it("publishes nothing when a session failure lands after the abort", async () => {
    const session = deferred<string | null>();
    const harness = ledgerHarness({ token: () => session.promise });
    const pending = harness.read();
    harness.controller.abort();
    session.reject(new Error("late"));
    await expect(pending).resolves.toBeNull();
  });

  it("publishes nothing when a good response lands after the abort", async () => {
    const response = deferred<{ ok: boolean; json: () => Promise<unknown> }>();
    const harness = ledgerHarness({ respond: () => response.promise });
    const pending = harness.read();
    await Promise.resolve();
    await Promise.resolve();
    expect(harness.calls).toHaveLength(1);
    harness.controller.abort();
    response.resolve(okJson({ decisions: [{ evidenceId: "ev-1:chunk-1", recordedAt: "2026-09-11T00:45:00.000Z", manifestDigest: MANIFEST }], truncated: false }));
    await expect(pending).resolves.toBeNull();
  });

  it("does not turn an AbortError into an error or an empty ready read", async () => {
    const harness = ledgerHarness({
      respond: () => new Promise((_, reject) => {
        harness.controller.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
    });
    const pending = harness.read();
    await Promise.resolve();
    await Promise.resolve();
    harness.controller.abort();
    await expect(pending).resolves.toBeNull();
  });

  it("publishes nothing when the body is still being parsed at abort time", async () => {
    const body = deferred<unknown>();
    const harness = ledgerHarness({ respond: async () => ({ ok: true, json: () => body.promise }) });
    const pending = harness.read();
    for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
    harness.controller.abort();
    body.resolve({ decisions: [], truncated: false });
    await expect(pending).resolves.toBeNull();
  });

  it("keeps a late result for the old manifest off the new one, the way the page publishes", async () => {
    let stored: ScopedReviewLedger | null = null;
    const publish = (scope: string, state: ReviewLedgerReadState | null) => {
      if (state !== null) stored = { scope, state };
    };
    const oldScope = reviewLedgerScope("col-1", OTHER_MANIFEST) as string;
    const newScope = reviewLedgerScope("col-1", MANIFEST) as string;

    const oldResponse = deferred<{ ok: boolean; json: () => Promise<unknown> }>();
    const oldRead = ledgerHarness({ respond: () => oldResponse.promise });
    publish(oldScope, { status: "loading" });
    const oldPending = oldRead.read().then((state) => publish(oldScope, state));
    await Promise.resolve();
    await Promise.resolve();

    // The manifest changes: the old read is aborted and the new one starts as loading.
    oldRead.controller.abort();
    publish(newScope, { status: "loading" });
    expect(currentReviewLedger(stored, newScope)).toEqual({ status: "loading" });

    const newRead = ledgerHarness({ respond: async () => okJson({ decisions: [], truncated: false }) });
    await newRead.read().then((state) => publish(newScope, state));
    oldResponse.resolve(okJson({ decisions: [{ evidenceId: "ev-1:chunk-1", recordedAt: "2026-09-11T00:45:00.000Z", manifestDigest: OTHER_MANIFEST }], truncated: false }));
    await oldPending;

    expect(currentReviewLedger(stored, newScope)).toEqual({ status: "ready", decisions: [], truncated: false });
    expect(currentReviewLedger(stored, oldScope)).toEqual({ status: "loading" });
  });
});
