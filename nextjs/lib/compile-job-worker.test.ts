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
const advance = vi.fn(async (_input?: { jobId?: string }): Promise<CompileJobResult<{ state: CompileState; changed: boolean }>> => ({
  ok: true as const,
  value: { state: "reading" as CompileState, changed: true },
}));
const runCompile = vi.fn<(...args: unknown[]) => Promise<any>>();
const listObjects = vi.fn<(...args: unknown[]) => Promise<any>>();
const jobAuthority = vi.fn<(...args: [{ jobId: string; workspaceKey: string; documentIds: readonly string[]; phase: string }]) => Promise<{ ok: true } | { ok: false; code: string }>>(async () => ({ ok: true }));
const authorityEnabled = vi.fn(() => false);
type SourceClassificationInput = { workspaceKey: string; documentIds: readonly string[] };
const classifySources = vi.fn<(...args: [SourceClassificationInput]) => Promise<{ ok: true; scope: "direct_upload" | "connector" } | { ok: false; code: string }>>(async () => ({ ok: true, scope: "direct_upload" }));
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
vi.mock("./compile-job-authority", () => ({ authorizeCompileJobSourceAccess: (input: { jobId: string; workspaceKey: string; documentIds: readonly string[]; phase: string }) => jobAuthority(input), classifyCompileJobSources: (input: SourceClassificationInput) => classifySources(input), compileJobAuthorityEnabled: () => authorityEnabled() }));
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
    createdByUserId: "00000000-0000-4000-8000-000000000001",
    authorizationRevision: 1,
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
  advance.mockReset().mockResolvedValue({
    ok: true as const,
    value: { state: "reading" as CompileState, changed: true },
  });
  runCompile.mockReset();
  listObjects.mockReset();
  jobAuthority.mockReset().mockResolvedValue({ ok: true });
  authorityEnabled.mockReset().mockReturnValue(false);
  classifySources.mockReset().mockResolvedValue({ ok: true, scope: "direct_upload" });
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
  it("preserves a legacy direct-upload job with no actor revision when the mode is off", async () => {
    group.mockReturnValue([]);
    const turn = await runCompileJobTurn(job({ createdByUserId: null, authorizationRevision: null }));
    expect(turn.note).toBe("waiting");
    expect(listObjects).toHaveBeenCalled();
    expect(jobAuthority).not.toHaveBeenCalled();
    expect(classifySources).toHaveBeenCalledWith({ workspaceKey: "pilot-alpha", documentIds: ["doc-a", "doc-b"] });
  });

  it("retries source-classification outages while keeping the job unread", async () => {
    classifySources.mockResolvedValueOnce({ ok: false, code: "COMPILE_JOB_AUTHORITY_UNAVAILABLE" });
    group.mockReturnValue([]);
    const queued = job({ createdByUserId: null, authorizationRevision: null });
    const first = await runCompileJobTurn(queued);
    expect(first).toMatchObject({ note: "waiting", state: queued.state });
    expect(listObjects).not.toHaveBeenCalled();
    expect(recordDeferral).toHaveBeenCalledWith(expect.objectContaining({
      reason: "COMPILE_SOURCE_AUTHORITY_UNAVAILABLE", attempt: 1,
    }));
    const second = await runCompileJobTurn(queued);
    expect(second.note).toBe("waiting");
    expect(listObjects).toHaveBeenCalledTimes(1);
  });

  it("denies connector jobs in default-off mode without falling back to their creator", async () => {
    classifySources.mockResolvedValueOnce({ ok: true, scope: "connector" });
    const turn = await runCompileJobTurn(job());
    expect(turn).toMatchObject({ note: "failed", state: "failed" });
    expect(listObjects).not.toHaveBeenCalled();
    expect(jobAuthority).not.toHaveBeenCalled();
    expect(advance).toHaveBeenCalledWith(expect.objectContaining({ errorCode: "COMPILE_SOURCE_AUTHORITY_DISABLED" }));
  });

  it("fails legacy jobs before listing any workspace objects when the mode is enabled", async () => {
    authorityEnabled.mockReturnValue(true);
    const turn = await runCompileJobTurn(job({ createdByUserId: null, authorizationRevision: null }));
    expect(turn).toMatchObject({ note: "failed", state: "failed" });
    expect(listObjects).not.toHaveBeenCalled();
    expect(advance).toHaveBeenCalledWith(expect.objectContaining({ errorCode: "COMPILE_SOURCE_AUTHORITY_MISSING" }));
  });

  it("retries an authority-store outage, then authorizes the same job after recovery", async () => {
    authorityEnabled.mockReturnValue(true);
    jobAuthority.mockResolvedValueOnce({ ok: false, code: "COMPILE_JOB_AUTHORITY_UNAVAILABLE" })
      .mockResolvedValueOnce({ ok: true });
    group.mockReturnValue([]);
    const queued = job();
    const first = await runCompileJobTurn(queued);
    expect(first).toMatchObject({ note: "waiting", state: queued.state });
    expect(listObjects).not.toHaveBeenCalled();
    expect(recordDeferral).toHaveBeenCalledWith(expect.objectContaining({
      job: queued, reason: "COMPILE_SOURCE_AUTHORITY_UNAVAILABLE", attempt: 1,
    }));

    const second = await runCompileJobTurn(queued);
    expect(second.note).toBe("waiting");
    expect((jobAuthority.mock.calls as Array<[{ jobId: string }]>).map(([input]) => input.jobId)).toEqual([queued.jobId, queued.jobId]);
    expect(listObjects).toHaveBeenCalledTimes(1);
  });

  it("attempts the queue timestamp update when deferral-event recording fails", async () => {
    classifySources.mockResolvedValueOnce({ ok: false, code: "COMPILE_JOB_AUTHORITY_UNAVAILABLE" });
    recordDeferral.mockResolvedValueOnce({ ok: false, code: "COMPILE_JOB_STORE_WRITE_FAILED" });
    const turn = await runCompileJobTurn(job());
    expect(turn).toMatchObject({ note: "waiting", retryable: true });
    expect(recordDeferral).toHaveBeenCalledTimes(1);
    expect(advance).toHaveBeenCalledWith(expect.objectContaining({ state: "reading" }));
    expect(listObjects).not.toHaveBeenCalled();
  });

  it("checks a failed queue timestamp update and reports no persisted backoff", async () => {
    authorityEnabled.mockReturnValue(true);
    jobAuthority.mockResolvedValueOnce({ ok: false, code: "COMPILE_JOB_AUTHORITY_UNAVAILABLE" });
    advance.mockResolvedValueOnce({ ok: false, code: "COMPILE_JOB_STORE_WRITE_FAILED" });
    const turn = await runCompileJobTurn(job());
    expect(turn).toMatchObject({ note: "waiting", retryable: true });
    expect(recordDeferral).toHaveBeenCalledTimes(1);
    expect(advance).toHaveBeenCalledTimes(1);
    expect(listObjects).not.toHaveBeenCalled();
  });

  it("settles only after bounded authority-unavailable retries are exhausted", async () => {
    authorityEnabled.mockReturnValue(true);
    jobAuthority.mockResolvedValue({ ok: false, code: "COMPILE_JOB_AUTHORITY_UNAVAILABLE" });
    let deferrals = 0;
    countDeferrals.mockImplementation(async () => ({ ok: true, value: deferrals }));
    recordDeferral.mockImplementation(async (input) => {
      deferrals = input.attempt;
      return { ok: true, value: { recorded: true } };
    });
    let turn: Awaited<ReturnType<typeof runCompileJobTurn>> | undefined;
    for (let index = 0; index < 11; index += 1) turn = await runCompileJobTurn(job());
    expect(turn).toMatchObject({ note: "failed", state: "failed" });
    expect(recordDeferral).toHaveBeenCalledTimes(10);
    expect(listObjects).not.toHaveBeenCalled();
    expect(advance).toHaveBeenCalledWith(expect.objectContaining({
      state: "failed", errorCode: "COMPILE_SOURCE_AUTHORITY_UNAVAILABLE",
    }));
  });

  it("fails closed when the job-keyed authorization check denies", async () => {
    authorityEnabled.mockReturnValue(true);
    jobAuthority.mockResolvedValueOnce({ ok: false, code: "COMPILE_JOB_AUTHORITY_DENIED" });
    const turn = await runCompileJobTurn(job());
    expect(turn).toMatchObject({ note: "failed", state: "failed" });
    expect(listObjects).not.toHaveBeenCalled();
    expect(advance).toHaveBeenCalledWith(expect.objectContaining({ errorCode: "COMPILE_SOURCE_AUTHORITY_REVOKED" }));
    expect(countDeferrals).not.toHaveBeenCalled();
    expect(recordDeferral).not.toHaveBeenCalled();
  });
  it("keeps a revoked job blocked and retryable if terminal settlement cannot be written", async () => {
    authorityEnabled.mockReturnValue(true);
    jobAuthority.mockResolvedValueOnce({ ok: false, code: "COMPILE_JOB_AUTHORITY_DENIED" });
    advance.mockResolvedValueOnce({ ok: false, code: "COMPILE_JOB_STORE_WRITE_FAILED" });
    const turn = await runCompileJobTurn(job());
    expect(turn).toMatchObject({ note: "waiting", retryable: true });
    expect(listObjects).not.toHaveBeenCalled();
    expect(countDeferrals).not.toHaveBeenCalled();
    expect(recordDeferral).not.toHaveBeenCalled();
  });

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
    expect(runCompile).toHaveBeenCalledWith("pilot-alpha", ["doc-a"], undefined, "cjob-00000000000000000000000000000001");
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

    expect(openJobs).toHaveBeenCalledWith(10);
    expect(turns.map((turn) => turn.note)).toEqual(["resting", "resting", "resting", "resting", "resting", "waiting"]);
    expect(advance).toHaveBeenCalledWith(expect.objectContaining({ jobId: fresh }));
    expect(listObjects).toHaveBeenCalledTimes(1);
  });

  it("scans past five authority-store failures to reach a healthy later job", async () => {
    const blockedJobs = Array.from({ length: 5 }, (_, index) => job({
      jobId: `cjob-${String(index + 1).padStart(32, "0")}`,
      documentIds: [`blocked-${index}-a`, `blocked-${index}-b`],
    }));
    const healthyId = `cjob-${"f".repeat(32)}`;
    openJobs.mockResolvedValue({ ok: true, value: [...blockedJobs, job({ jobId: healthyId,
      documentIds: ["healthy-a", "healthy-b"] })] });
    classifySources.mockImplementation(async ({ documentIds }) =>
      documentIds[0].startsWith("blocked-")
        ? { ok: false, code: "COMPILE_JOB_AUTHORITY_UNAVAILABLE" }
        : { ok: true, scope: "direct_upload" });
    recordDeferral.mockResolvedValue({ ok: false, code: "COMPILE_JOB_STORE_WRITE_FAILED" });
    advance.mockImplementation(async (input) => input?.jobId === healthyId
      ? { ok: true, value: { state: "reading", changed: true } }
      : { ok: false, code: "COMPILE_JOB_STORE_WRITE_FAILED" });
    group.mockReturnValue([DOCUMENT("healthy-a", "sanitized"), DOCUMENT("healthy-b", "sanitized")]);

    const turns = await runCompileJobBatch(5);

    expect(openJobs).toHaveBeenCalledWith(10);
    expect(turns).toHaveLength(6);
    expect(turns.slice(0, 5).every((turn) => turn.retryable)).toBe(true);
    expect(turns[5]).toMatchObject({ jobId: healthyId });
    expect(listObjects).toHaveBeenCalledTimes(1);
    expect(runCompile).not.toHaveBeenCalled();
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
    expect(recorded).toEqual(Array.from({ length: 10 }, (_, index) => index + 1));
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

describe("private global collection worker", () => {
  it("leaves a durable global job pending while qualification is disabled", async () => {
    vi.stubEnv("TAVONEL_GLOBAL_COLLECTION_COMPILE", "0");
    const result = await runCompileJobTurn(job({ compilationMode: "global_collection", corpusId: `corpus-${"a".repeat(32)}` }));
    expect(result.note).toBe("skipped");
    expect(runCompile).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});


it("compiles every document of a qualified global job into one logical collection", async () => {
  vi.stubEnv("TAVONEL_GLOBAL_COLLECTION_COMPILE", "1");
  vi.stubEnv("TAVONEL_CORE_V2_REVISION_COMPILE", "1");
  vi.stubEnv("TAVONEL_GLOBAL_COLLECTION_CORE_RELEASE_SHA256", `sha256:${"a".repeat(64)}`);
  const ids = Array.from({ length: 13 }, (_, i) => `doc-${i}`);
  group.mockReturnValue(ids.map((id) => DOCUMENT(id, "ocr_ready")));
  runCompile.mockResolvedValue({ ok: true, status: 200, payload: { collectionId: `collection-${"b".repeat(32)}`, lifecycle: "candidate" } });
  const corpusId = `corpus-${"a".repeat(32)}`;
  const turn = await runCompileJobTurn(job({ compilationMode: "global_collection", corpusId,
    batchIndex: 0, batchCount: 1, documentIds: ids, documentsTotal: 13 }));
  expect(turn.note).toBe("compiled");
  expect(runCompile).toHaveBeenCalledWith("pilot-alpha", ids, `global-corpus/${corpusId}`, "cjob-00000000000000000000000000000001");
  vi.unstubAllEnvs();
});
