import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CompileJob, CompileState } from "./compile-job-store";

/*
  What the worker must never do on its own.

  Every case here is a decision that belongs to the customer or to another worker, and the
  failure mode in each is the same shape: the compile appears to succeed while quietly having
  done something nobody asked for. A World missing four documents nobody was told about; two
  compiles of one submission; a cancelled job that finished anyway.
*/

const advance = vi.fn(async () => ({
  ok: true as const,
  value: { state: "reading" as CompileState, changed: true },
}));
const runCompile = vi.fn();
const listObjects = vi.fn();
const group = vi.fn();

vi.mock("./compile-job-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./compile-job-store")>();
  return { ...actual, advanceCompileJob: advance, readOpenCompileJobs: vi.fn() };
});
vi.mock("./collection-compile-run", () => ({
  runCollectionCompile: (...args: unknown[]) => runCompile(...args),
  isCompileWaitingOnReading: (code: string) => code === "OCR_NOT_READY",
}));
vi.mock("./r2-objects", () => ({ listImmutableWorkspaceObjects: (...args: unknown[]) => listObjects(...args) }));
vi.mock("./r2-synthetic-canary", () => ({ readR2SignerEnv: () => ({ bucket: "test" }) }));
vi.mock("./immutable-keys", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./immutable-keys")>();
  return { ...actual, groupImmutableDocuments: (...args: unknown[]) => group(...args) };
});

const { runCompileJobTurn } = await import("./compile-job-worker");

const DOCUMENT = (id: string, state: "ocr_ready" | "sanitized" | "operator_review") => ({
  documentId: id,
  versionKey: "a".repeat(32),
  sanitizedKey: `k/${id}/sanitized.pdf`,
  sanitizedSize: 10,
  ocrJsonKey: state === "ocr_ready" ? `k/${id}/ocr.json` : null,
  ocrJsonSize: state === "ocr_ready" ? 10 : null,
  hasOcrJson: state === "ocr_ready",
  cdrReceiptKey: null,
  ocrReviewKey: state === "operator_review" ? `k/${id}/ocr-review.json` : null,
  processingState: state,
});

function job(overrides: Partial<CompileJob> = {}): CompileJob {
  const now = new Date().toISOString();
  return {
    jobId: "cjob-00000000000000000000000000000001",
    workspaceKey: "pilot-alpha",
    documentIds: ["doc-a", "doc-b"],
    state: "reading",
    collectionId: null,
    errorCode: null,
    corpusId: null,
    batchIndex: null,
    batchCount: null,
    blocked: [],
    blockedResolution: null,
    documentsTotal: 2,
    documentsReady: 0,
    createdAt: now,
    updatedAt: now,
    settledAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  advance.mockClear();
  runCompile.mockReset();
  listObjects.mockReset();
  group.mockReset();
  listObjects.mockResolvedValue({ ok: true, objects: [] });
});

describe("the durable compile worker", () => {
  it("waits rather than compiling a partial set", async () => {
    group.mockReturnValue([DOCUMENT("doc-a", "ocr_ready"), DOCUMENT("doc-b", "sanitized")]);
    const turn = await runCompileJobTurn(job());
    expect(turn.note).toBe("waiting");
    expect(turn.documentsReady).toBe(1);
    expect(runCompile).not.toHaveBeenCalled();
  });

  it("stops on a blocker and refuses to decide for the customer", async () => {
    group.mockReturnValue([DOCUMENT("doc-a", "ocr_ready"), DOCUMENT("doc-b", "operator_review")]);
    const turn = await runCompileJobTurn(job());
    expect(turn.note).toBe("blocked");
    expect(turn.blocked).toEqual([{ documentId: "doc-b", kind: "input", reason: "READING_NEEDS_OPERATOR_REVIEW" }]);
    // The one document that read cleanly is NOT compiled. Someone has to say so first.
    expect(runCompile).not.toHaveBeenCalled();
  });

  it("compiles only what read cleanly once the customer has said to continue", async () => {
    group.mockReturnValue([DOCUMENT("doc-a", "ocr_ready"), DOCUMENT("doc-b", "operator_review")]);
    runCompile.mockResolvedValue({
      ok: true,
      status: 200,
      payload: { collectionId: "collection-" + "b".repeat(32), lifecycle: "candidate" },
    });
    const turn = await runCompileJobTurn(job({
      blocked: [{ documentId: "doc-b", kind: "input", reason: "READING_NEEDS_OPERATOR_REVIEW" }],
      blockedResolution: "continue",
    }));
    expect(turn.note).toBe("compiled");
    expect(turn.state).toBe("ready");
    expect(runCompile).toHaveBeenCalledWith("pilot-alpha", ["doc-a"]);
  });

  it("does not compile twice when two workers pick up the same job", async () => {
    group.mockReturnValue([DOCUMENT("doc-a", "ocr_ready"), DOCUMENT("doc-b", "ocr_ready")]);
    // The lease is the transition into `structuring`: the loser's advance changes nothing.
    advance.mockResolvedValueOnce({ ok: true, value: { state: "structuring", changed: false } });
    const turn = await runCompileJobTurn(job());
    expect(turn.note).toBe("skipped");
    expect(runCompile).not.toHaveBeenCalled();
  });

  it("leaves a review package alone instead of recompiling it every minute", async () => {
    const turn = await runCompileJobTurn(job({ state: "review_required" }));
    expect(turn.note).toBe("resting");
    expect(listObjects).not.toHaveBeenCalled();
  });

  it("settles as failed when nothing in the batch could be read", async () => {
    group.mockReturnValue([DOCUMENT("doc-a", "operator_review"), DOCUMENT("doc-b", "operator_review")]);
    const turn = await runCompileJobTurn(job({
      blocked: [
        { documentId: "doc-a", kind: "input", reason: "READING_NEEDS_OPERATOR_REVIEW" },
        { documentId: "doc-b", kind: "input", reason: "READING_NEEDS_OPERATOR_REVIEW" },
      ],
      blockedResolution: "continue",
    }));
    expect(turn.note).toBe("failed");
    expect(advance).toHaveBeenCalledWith(expect.objectContaining({ state: "failed", errorCode: "NO_DOCUMENT_COULD_BE_READ" }));
  });

  it("keeps waiting when the compiler disagrees with the listing", async () => {
    group.mockReturnValue([DOCUMENT("doc-a", "ocr_ready"), DOCUMENT("doc-b", "ocr_ready")]);
    runCompile.mockResolvedValue({ ok: false, status: 409, code: "OCR_NOT_READY", payload: {} });
    const turn = await runCompileJobTurn(job());
    expect(turn.note).toBe("waiting");
    expect(advance).not.toHaveBeenCalledWith(expect.objectContaining({ state: "failed" }));
  });

  it("gives up on a document that never arrived, rather than waiting forever", async () => {
    group.mockReturnValue([DOCUMENT("doc-a", "ocr_ready")]);
    const stale = new Date(Date.now() - 30 * 60 * 1_000).toISOString();
    const turn = await runCompileJobTurn(job({ createdAt: stale, updatedAt: stale }));
    expect(turn.note).toBe("blocked");
    expect(turn.blocked).toEqual([{ documentId: "doc-b", kind: "input", reason: "DOCUMENT_NEVER_ARRIVED" }]);
  });
});
