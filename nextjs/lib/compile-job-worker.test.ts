import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CompileJob, CompileJobResult, CompileState } from "./compile-job-store";

/*
  What the worker must never do on its own.

  Every case here is a decision that belongs to the customer or to another worker, and the
  failure mode in each is the same shape: the compile appears to succeed while quietly having
  done something nobody asked for. A World missing four documents nobody was told about; two
  compiles of one submission; a cancelled job that finished anyway.
*/

// Typed as the store's own result so a case can hand the worker a refusal as well as a success.
const advance = vi.fn(async (): Promise<CompileJobResult<{ state: CompileState; changed: boolean }>> => ({
  ok: true as const,
  value: { state: "reading" as CompileState, changed: true },
}));
const runCompile = vi.fn();
const listObjects = vi.fn();
const group = vi.fn();
const countDeferrals = vi.fn(async (): Promise<CompileJobResult<number>> => ({ ok: true, value: 0 }));
const recordDeferral = vi.fn(
  async (_input: { attempt: number }): Promise<CompileJobResult<{ recorded: true }>> =>
    ({ ok: true, value: { recorded: true } }),
);

const openJobs = vi.fn(async (): Promise<CompileJobResult<CompileJob[]>> => ({ ok: true, value: [] }));

vi.mock("./compile-job-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./compile-job-store")>();
  return {
    ...actual,
    advanceCompileJob: advance,
    readOpenCompileJobs: openJobs,
    countCompileJobDeferrals: countDeferrals,
    recordCompileJobDeferral: recordDeferral,
  };
});
vi.mock("./collection-compile-run", () => ({
  runCollectionCompile: (...args: unknown[]) => runCompile(...args),
  isCompileWaitingOnReading: (code: string) => code === "OCR_NOT_READY" || code === "SOURCE_VERSION_CHANGED",
}));
vi.mock("./r2-objects", () => ({ listImmutableWorkspaceObjects: (...args: unknown[]) => listObjects(...args) }));
vi.mock("./r2-synthetic-canary", () => ({ readR2SignerEnv: () => ({ bucket: "test" }) }));
vi.mock("./immutable-keys", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./immutable-keys")>();
  return { ...actual, groupImmutableDocuments: (...args: unknown[]) => group(...args) };
});

/*
  Imported after the mocks are built, and that is not a style choice: a value import of a module
  `vi.mock` replaces is evaluated together with the hoisted factory, before the `const`s the
  factory closes over exist, and the file fails to load at all. The two lists read here are the
  real ones -- the factory spreads the actual module -- so reading them late is what makes them
  readable.
*/
const { runCompileJobBatch, runCompileJobTurn, DIGEST_MIGRATION_NOT_APPLIED } =
  await import("./compile-job-worker");
const { RESTING_COMPILE_STATES, SCHEDULER_EXCLUDED_STATES } = await import("./compile-job-store");

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
  countDeferrals.mockReset();
  recordDeferral.mockReset();
  openJobs.mockReset();
  openJobs.mockResolvedValue({ ok: true, value: [] });
  listObjects.mockResolvedValue({ ok: true, objects: [] });
  countDeferrals.mockResolvedValue({ ok: true, value: 0 });
  recordDeferral.mockResolvedValue({ ok: true, value: { recorded: true } });
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

  it("records the digest of the artifact it produced, on whichever advance lands", async () => {
    /*
      `candidateAwaitingActivation` was computable only from versions the workspace had already
      promoted, plus the candidate the current request happened to have loaded -- so a compiled
      World waiting for approval could read as "nothing is waiting". The digest is the one value
      that identifies that artifact, and this is the only place that knows it.

      Both settling advances carry it because either can be the one that lands: a redelivery
      whose building_world advance is refused for moving backwards would otherwise settle with
      no record of what it built. The RPC coalesces, so writing it twice writes it once.
    */
    group.mockReturnValue([DOCUMENT("doc-a", "ocr_ready"), DOCUMENT("doc-b", "ocr_ready")]);
    const manifestDigest = `sha256:${"c".repeat(64)}`;
    runCompile.mockResolvedValue({
      ok: true,
      status: 200,
      payload: { collectionId: "collection-" + "b".repeat(32), manifestDigest, lifecycle: "candidate" },
    });

    const turn = await runCompileJobTurn(job());
    expect(turn.note).toBe("compiled");

    const calls = advance.mock.calls as unknown as Array<[{ state: CompileState; candidateManifestDigest?: string }]>;
    // The lease into `structuring` has no artifact yet and must not claim one.
    expect(calls.map(([input]) => [input.state, input.candidateManifestDigest ?? null])).toEqual([
      ["structuring", null],
      ["building_world", manifestDigest],
      ["ready", manifestDigest],
    ]);
  });

  it("keeps advancing, loudly, against a database the digest migration has not reached", async () => {
    /*
      Deploy order, from the wrong side of it.

      Release order for 2026-09-11 is migrations first, then deploy. If it is reversed, the
      function in the database still takes eight arguments and every advance this worker makes
      answers PGRST202 -- so the failure is not a missing column, it is the whole compile queue
      stopping. The fallback sends the call the deployed function does have, once, and logs the
      stable message an operator greps for. What must not happen is either half alone: a silent
      fallback that hides an unapplied migration, or a stall that hides behind a retry loop.
    */
    group.mockReturnValue([DOCUMENT("doc-a", "ocr_ready"), DOCUMENT("doc-b", "ocr_ready")]);
    const manifestDigest = `sha256:${"c".repeat(64)}`;
    runCompile.mockResolvedValue({
      ok: true,
      status: 200,
      payload: { collectionId: "collection-" + "b".repeat(32), manifestDigest, lifecycle: "candidate" },
    });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    // Call 1 is the lease into `structuring`; call 2 is the building_world advance that carries
    // the digest, and it is the one the old function cannot resolve.
    advance.mockResolvedValueOnce({ ok: true, value: { state: "structuring", changed: true } });
    advance.mockResolvedValueOnce({ ok: false, code: "COMPILE_JOB_RPC_UNDEFINED" });

    const turn = await runCompileJobTurn(job());

    expect(turn.note, "the queue keeps moving").toBe("compiled");
    expect(logged).toHaveBeenCalledWith(
      DIGEST_MIGRATION_NOT_APPLIED,
      expect.objectContaining({ state: "building_world" }),
    );
    const calls = advance.mock.calls as unknown as Array<[{ state: CompileState; candidateManifestDigest?: string }]>;
    expect(calls.map(([input]) => [input.state, input.candidateManifestDigest ?? "omitted"])).toEqual([
      ["structuring", "omitted"],
      ["building_world", manifestDigest],
      // The retry names no digest at all, which is what makes it the eight-argument call.
      ["building_world", "omitted"],
      ["ready", manifestDigest],
    ]);
    expect(calls[2][0], "the retry omits the argument rather than nulling it")
      .not.toHaveProperty("candidateManifestDigest", null);
    // Once, not in a loop: a second PGRST202 is a different problem.
    expect(logged).toHaveBeenCalledTimes(1);
    logged.mockRestore();
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

  it("gives a waiting job its turn even behind a batch of parked reviews", async () => {
    /*
      The starvation, end to end. Five review packages are the oldest open rows and the batch is
      five wide, so before the scheduler stopped asking for them the sixth job -- somebody's
      compile, waiting -- was never reached at all. Here they are handed over anyway, to assert
      the worker spends none of the batch on them and still advances the one job that can move.
    */
    group.mockReturnValue([DOCUMENT("doc-a", "ocr_ready"), DOCUMENT("doc-b", "sanitized")]);
    const fresh = "cjob-" + "b".repeat(32);
    openJobs.mockResolvedValue({
      ok: true,
      value: [
        ...Array.from({ length: 5 }, () => job({ state: "review_required" })),
        job({ jobId: fresh }),
      ],
    });

    const turns = await runCompileJobBatch(5);

    expect(openJobs).toHaveBeenCalledWith(5);
    expect(turns.map((turn) => turn.note)).toEqual(["resting", "resting", "resting", "resting", "resting", "waiting"]);
    expect(advance).toHaveBeenCalledWith(expect.objectContaining({ jobId: fresh }));
    expect(listObjects).toHaveBeenCalledTimes(1);
  });

  it("rests on every state the scheduler refuses to hand out", async () => {
    /*
      The two halves of the starvation fix are one list. A state this worker cannot move must be
      one the scheduler skips, or it holds a slot in the open-job window for ever; a state the
      scheduler skips must be one this worker declines, because the events route nudges this
      function directly for any job that is not terminal.
    */
    for (const state of RESTING_COMPILE_STATES) {
      expect(SCHEDULER_EXCLUDED_STATES).toContain(state);
      listObjects.mockClear();
      const turn = await runCompileJobTurn(job({ state }));
      expect(turn.note).toBe("resting");
      expect(listObjects).not.toHaveBeenCalled();
    }
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

  it("retries when the current source version changes during compilation", async () => {
    group.mockReturnValue([DOCUMENT("doc-a", "ocr_ready"), DOCUMENT("doc-b", "ocr_ready")]);
    runCompile.mockResolvedValue({ ok: false, status: 409, code: "SOURCE_VERSION_CHANGED", payload: {} });
    const turn = await runCompileJobTurn(job());
    expect(turn.note).toBe("waiting");
    expect(advance).not.toHaveBeenCalledWith(expect.objectContaining({ state: "failed" }));
    expect(recordDeferral).toHaveBeenCalled();
  });

  it("gives up on a document that never arrived, rather than waiting forever", async () => {
    group.mockReturnValue([DOCUMENT("doc-a", "ocr_ready")]);
    const stale = new Date(Date.now() - 30 * 60 * 1_000).toISOString();
    const turn = await runCompileJobTurn(job({ createdAt: stale, updatedAt: stale }));
    expect(turn.note).toBe("blocked");
    expect(turn.blocked).toEqual([{ documentId: "doc-b", kind: "input", reason: "DOCUMENT_NEVER_ARRIVED" }]);
  });
});

/*
  The loop that had no end.

  Both views of the workspace are derived from a listing, and when they disagree about whether a
  document has been read the worker believes the compiler -- correctly. What it did with that
  answer was the defect: nothing. No state write, so `updated_at` never moved and the job kept
  its slot at the head of the oldest-first window; no record, so the disagreement was invisible;
  no count, so a permanent disagreement was indistinguishable from a listing catching up and the
  job could never reach any terminal state at all.
*/
describe("a compiler that keeps saying the reading is not finished", () => {
  const deferring = () => {
    group.mockReturnValue([DOCUMENT("doc-a", "ocr_ready"), DOCUMENT("doc-b", "ocr_ready")]);
    runCompile.mockResolvedValue({ ok: false, status: 409, code: "OCR_NOT_READY", payload: {} });
  };

  it("writes the deferral down and moves the job off the head of the queue", async () => {
    deferring();
    // Already holding the lease, so the only write this turn can make is the one being asserted.
    const turn = await runCompileJobTurn(job({ state: "structuring", updatedAt: new Date(0).toISOString() }));

    expect(turn.note).toBe("waiting");
    expect(advance).toHaveBeenCalledTimes(1);
    expect(recordDeferral).toHaveBeenCalledWith(expect.objectContaining({
      job: expect.objectContaining({ jobId: "cjob-00000000000000000000000000000001" }),
      state: "structuring",
      reason: "READING_LISTING_DISAGREEMENT",
      attempt: 1,
    }));
    // The `updated_at` bump. Without it the job is the oldest open row on the next turn too.
    expect(advance).toHaveBeenCalledWith(expect.objectContaining({ state: "structuring" }));
  });

  it("settles rather than deferring for ever", async () => {
    deferring();
    const recorded: number[] = [];
    countDeferrals.mockImplementation(async () => ({ ok: true, value: recorded.length }));
    recordDeferral.mockImplementation(async (input) => {
      recorded.push(input.attempt);
      return { ok: true, value: { recorded: true } };
    });

    let last = await runCompileJobTurn(job());
    let turns = 1;
    while (last.note !== "failed" && turns < 40) {
      last = await runCompileJobTurn(job({ state: "structuring", updatedAt: new Date(0).toISOString() }));
      turns += 1;
    }

    expect(last.note).toBe("failed");
    expect(last.state).toBe("failed");
    expect(advance).toHaveBeenCalledWith(expect.objectContaining({
      state: "failed",
      errorCode: "READING_LISTING_DISAGREEMENT",
    }));
    // Every deferral before the settle is on the ledger, numbered, and each cost one attempt.
    expect(recorded).toEqual(Array.from({ length: turns - 1 }, (_, index) => index + 1));
    expect(runCompile).toHaveBeenCalledTimes(turns);
  });

  it("does not settle a job because the ledger could not be read", async () => {
    // A store that cannot answer is not evidence that the disagreement is permanent.
    deferring();
    countDeferrals.mockResolvedValue({ ok: false, code: "COMPILE_JOB_STORE_READ_FAILED" });
    const turn = await runCompileJobTurn(job());
    expect(turn.note).toBe("waiting");
    expect(advance).not.toHaveBeenCalledWith(expect.objectContaining({ state: "failed" }));
    expect(recordDeferral).toHaveBeenCalledWith(expect.objectContaining({ attempt: 1 }));
  });
});
