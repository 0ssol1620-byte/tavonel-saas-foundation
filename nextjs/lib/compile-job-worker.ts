import { globalCollectionCompileEnabled, GLOBAL_COLLECTION_KEY_PREFIX } from "./global-collection-compile";
import { isCompileWaitingOnReading, runCollectionCompile } from "./collection-compile-run";
import {
  advanceCompileJob,
  claimCompileJobLease,
  type CompileBlocker,
  type CompileJob,
  type CompileState,
  countCompileJobDeferrals,
  isRestingCompileState,
  readOpenCompileJobs,
  recordCompileJobDeferral,
  recordCompileJobSizeLimit,
} from "./compile-job-store";
import { groupImmutableDocuments, selectCurrentDocumentVersions } from "./immutable-keys";
import { listImmutableWorkspaceObjects } from "./r2-objects";
import { readR2SignerEnv } from "./r2-synthetic-canary";
import { alertCompileJobTurn } from "./operations-alert-triggers";
import { authorizeCompileJobSourceAccess, classifyCompileJobSources, compileJobAuthorityEnabled } from "./compile-job-authority";
import { CORE_CLIENT_TIMEOUT_MS, WORKER_MAX_DURATION_MS } from "./execution-budget";

/*
  The half of the compile that no longer needs a browser.

  Before this, the tab polled the document list every 1.5 seconds and called the compiler
  itself once everything had been read. The customer's connection was therefore part of the
  pipeline: closing it abandoned a run whose reading had already been paid for. Here the same
  observation happens server-side, on a schedule, against durable state -- and the customer's
  tab becomes what it should always have been, a view.

  One turn does one step. It does not drain, and it does not wait for a compile that is not
  ready yet; a scheduler calls it again. That is the same shape as the source-import worker
  next door and for the same reason: the invocation has a wall clock and the work does not.
*/

/** How long a document may fail to appear before the worker stops expecting it. */
const STALL_AFTER_MS = 15 * 60 * 1_000;

/**
 * What this worker logs when it meets a database that has not been migrated yet.
 *
 * Stable string on purpose: it is the thing an operator greps for, and the thing an alert is
 * built on. It names the migration so the fix is in the message.
 */
export const DIGEST_MIGRATION_NOT_APPLIED =
  "candidate_manifest_digest not recorded: migration 20260911120200 not applied";

/**
 * Advance a job that has a digest to record, on a deployment that may not be able to record it.
 *
 * Release order for 2026-09-11 is migrations first, then deploy (`docs/runbooks/RELEASE_ORDER.md`),
 * and the migration's ninth parameter defaults to null so a worker that is still sending eight
 * arguments keeps working. This is the other direction: the worker arrives first, the function
 * still takes eight arguments, and every advance would answer PGRST202 -- which would stall the
 * whole compile queue rather than lose one column.
 *
 * So: retry once without the digest, and say so at error level. Loud, because the queue running
 * while a recorded fact is silently missing is exactly the state that must not look healthy --
 * `candidateAwaitingActivation` reads conservatively from the digest, and a compile that ran
 * during this window has none. Once, because a second PGRST202 on the eight-argument call is a
 * different problem and retrying it forever would hide that one too.
 */
async function advanceRecordingDigest(
  input: Parameters<typeof advanceCompileJob>[0] & { candidateManifestDigest?: string | null },
) {
  const first = await advanceCompileJob(input);
  if (first.ok || first.code !== "COMPILE_JOB_RPC_UNDEFINED") return first;
  console.error(DIGEST_MIGRATION_NOT_APPLIED, { jobId: input.jobId, state: input.state });
  // `undefined` omits the argument from the request body; `null` would still name it and fail
  // the same way. The store's own note on the field says why.
  return advanceCompileJob({ ...input, candidateManifestDigest: undefined });
}

/**
 * How long a compile may sit in `structuring` before another worker may take it over.
 *
 * The transition into `structuring` is the lease: only the worker whose advance actually
 * changed the row runs the expensive step, so two schedulers firing at once do not compile
 * twice. This is the other half -- without it, a worker that died mid-compile would strand
 * the job in `structuring` forever.
 */
const COMPILE_LEASE_MS = 5 * 60 * 1_000;

/**
 * The compiler's own listing disagreed with the worker's about whether a document has been read.
 *
 * A terminal outcome, not a blocker: it is not one document a customer can drop, it is the two
 * views of the workspace failing to agree, and no answer the customer gives changes it.
 */
const READING_LISTING_DISAGREEMENT = "READING_LISTING_DISAGREEMENT";

/**
 * How many turns may end in that disagreement before the job settles.
 *
 * Having a bound is what matters; the number is a judgement, not a measurement. A listing that
 * is merely catching up agrees on the next turn, so ten consecutive disagreements -- each one a
 * fresh pair of listings -- are evidence of a permanent one. The sibling queue bounds attempts
 * at five (0024:74) and the quarantine queue retries ten times; a turn here is two listings and
 * no GPU, so this takes the looser of the two. It lives in the worker because it is policy: the
 * row has no attempt column to hold it until the migration that gives it one.
 */
const MAX_READING_DEFERRALS = 10;
/** Temporary policy-store outages retry with the same bounded, durable deferral ledger. */
const MAX_AUTHORITY_DEFERRALS = 10;

export type CompileJobTurn = {
  jobId: string;
  state: CompileState;
  note: "waiting" | "advanced" | "blocked" | "compiled" | "failed" | "resting" | "skipped";
  /** The code a `failed` turn settled with. */
  errorCode?: string;
  /** True only when this turn durably wrote the failed state: the one turn that pages the dead letter. */
  deadLettered?: true;
  /** True when a temporary authority-store failure should not consume the runnable batch width. */
  retryable?: true;
  /** This turn took the compile lease. */
  claimed?: true;
  /** Skipped because the tick could no longer fit a whole Core call; the batch stops here. */
  outOfTime?: true;
  documentsReady: number;
  blocked: CompileBlocker[];
};

type Classification = {
  ready: string[];
  awaitingUpload: string[];
  awaitingReading: string[];
  blocked: CompileBlocker[];
};

/*
  What the object store can actually tell us.

  `sanitizing` is deliberately absent from what this worker claims. Sanitation happens inside
  the upload path, which writes the sanitized object only after the file has passed; from out
  here a document that is being sanitized and a document that was never uploaded look
  identical, so reporting one as the other would be a guess dressed as a state.
*/
function classify(
  job: CompileJob,
  documents: ReturnType<typeof groupImmutableDocuments>,
  stalled: boolean,
): Classification {
  const result: Classification = { ready: [], awaitingUpload: [], awaitingReading: [], blocked: [] };
  const alreadyBlocked = new Map(job.blocked.map((entry) => [entry.documentId, entry] as const));

  for (const documentId of job.documentIds) {
    const existing = alreadyBlocked.get(documentId);
    if (existing) {
      result.blocked.push(existing);
      continue;
    }
    const document = documents.find((item) => item.documentId === documentId);
    if (!document) {
      if (stalled) result.blocked.push({ documentId, kind: "input", reason: "DOCUMENT_NEVER_ARRIVED" });
      else result.awaitingUpload.push(documentId);
      continue;
    }
    if (document.processingState === "ocr_ready" && document.sanitizedKey && document.ocrJsonKey) {
      result.ready.push(documentId);
      continue;
    }
    if (document.processingState === "operator_review") {
      // The reader produced a review package instead of a result. That is a real outcome
      // rather than a delay, and it is the customer's to decide on.
      result.blocked.push({ documentId, kind: "input", reason: "READING_NEEDS_OPERATOR_REVIEW" });
      continue;
    }
    if (stalled) result.blocked.push({ documentId, kind: "input", reason: "READING_DID_NOT_FINISH" });
    else result.awaitingReading.push(documentId);
  }
  return result;
}

/** True once the customer has answered a partial failure in a way that means "go ahead". */
function blockersResolved(job: CompileJob, blocked: readonly CompileBlocker[]) {
  if (blocked.length === 0) return true;
  return job.blockedResolution === "continue" || job.blockedResolution === "remove_blocked";
}

/**
 * One turn, then the W1-A3 pages: a job that settled failed (this queue's dead letter) and a
 * document newly blocked as DOCUMENT_NEVER_ARRIVED. Delivery never throws and never changes the turn.
 */
export async function runCompileJobTurn(job: CompileJob, deadlineAt = Number.POSITIVE_INFINITY): Promise<CompileJobTurn> {
  const turn = await advanceCompileJobTurn(job, deadlineAt);
  await alertCompileJobTurn(job, turn);
  return turn;
}

async function advanceCompileJobTurn(job: CompileJob, deadlineAt: number): Promise<CompileJobTurn> {
  let claimed = false;
  const rest = (
    note: CompileJobTurn["note"],
    state: CompileState,
    documentsReady: number,
    blocked: CompileBlocker[],
    retryable = false,
  ): CompileJobTurn => ({ jobId: job.jobId, state, note, documentsReady, blocked, ...(retryable ? { retryable: true as const } : {}),
    ...(claimed ? { claimed: true as const } : {}) });

  /*
    A resting state is not an unfinished one.

    The compile produced a package a person has to look at. Nothing the worker can do moves it
    along, and picking it up again would recompile the same sources on every turn forever.

    The scheduler no longer offers these at all (`SCHEDULER_EXCLUDED_STATES`), so this is a
    second reader of one list rather than a second opinion: the events route nudges this
    function for any non-terminal job, a watched review package included.
  */
  if (isRestingCompileState(job.state)) return rest("resting", job.state, job.documentsReady, job.blocked);

  if (job.compilationMode === "global_collection" && !globalCollectionCompileEnabled()) {
    return rest("skipped", job.state, job.documentsReady, job.blocked);
  }
  const settleAuthorityFailure = async (errorCode: string) => {
    const settled = await advanceCompileJob({ workspaceKey: job.workspaceKey, jobId: job.jobId, state: "failed",
      documentsReady: job.documentsReady, errorCode });
    if (!settled.ok || !settled.value.changed) {
      // Keep a denied job unread, but let the bounded batch scan past it until terminal state can
      // be durably recorded. Never report failed as settled when the store refused the write.
      return rest("waiting", job.state, job.documentsReady, job.blocked, true);
    }
    return { ...rest("failed", "failed", job.documentsReady, job.blocked), errorCode, deadLettered: true as const };
  };
  // The failed state is written first and paged only when the store says this turn changed it:
  // a refused write pages nothing, and a redelivered turn of an already failed job pages again never.
  const settleFailed = async (input: Parameters<typeof advanceCompileJob>[0] & { errorCode: string }, documentsReady: number, blocked: CompileBlocker[]): Promise<CompileJobTurn> => {
    const written = await advanceCompileJob(input);
    return { ...rest("failed", "failed", documentsReady, blocked), errorCode: input.errorCode,
      ...(written.ok && written.value.changed ? { deadLettered: true as const } : {}) };
  };
  const deferAuthorityUnavailable = async () => {
    const reason = "COMPILE_SOURCE_AUTHORITY_UNAVAILABLE";
    const seen = await countCompileJobDeferrals(job.workspaceKey, job.jobId, reason, MAX_AUTHORITY_DEFERRALS + 1);
    // An unreadable ledger is not evidence of exhaustion. Keep the job blocked and retry once
    // the store answers; no protected source read is permitted on this path.
    const attempt = (seen.ok ? seen.value : 0) + 1;
    if (seen.ok && attempt > MAX_AUTHORITY_DEFERRALS) return settleAuthorityFailure(reason);
    const recorded = await recordCompileJobDeferral({ job, state: job.state, documentsReady: job.documentsReady,
      blocked: job.blocked, reason, attempt });
    // Try the independent queue timestamp update even when event recording failed. Each write is
    // checked; if either is unavailable, mark this turn retryable so the batch can scan past it.
    const bumped = await advanceCompileJob({ workspaceKey: job.workspaceKey, jobId: job.jobId, state: job.state,
      documentsReady: job.documentsReady });
    if (!recorded.ok || !bumped.ok || !bumped.value.changed) {
      return rest("waiting", job.state, job.documentsReady, job.blocked, true);
    }
    return rest("waiting", job.state, job.documentsReady, job.blocked, true);
  };
  if (compileJobAuthorityEnabled()) {
    if (!job.createdByUserId || !job.authorizationRevision) {
      return settleAuthorityFailure("COMPILE_SOURCE_AUTHORITY_MISSING");
    }
    // Enabled mode requires the durable actor-bound RPC before protected reads; unavailable RPC
    // fails closed and never falls back to the enqueue creator as a provider principal.
    const authority = await authorizeCompileJobSourceAccess({ jobId: job.jobId,
      workspaceKey: job.workspaceKey, documentIds: job.documentIds, phase: "before_source_read" });
    if (!authority.ok) {
      if (authority.code === "COMPILE_JOB_AUTHORITY_DENIED") return settleAuthorityFailure("COMPILE_SOURCE_AUTHORITY_REVOKED");
      return deferAuthorityUnavailable();
    }
  } else {
    // The default-off path preserves existing direct-upload jobs. Connector bindings are
    // explicitly denied until actor-bound processing authority is enabled.
    const source = await classifyCompileJobSources({ workspaceKey: job.workspaceKey, documentIds: job.documentIds });
    if (!source.ok) return deferAuthorityUnavailable();
    if (source.scope === "connector") return settleAuthorityFailure("COMPILE_SOURCE_AUTHORITY_DISABLED");
  }
  const signer = readR2SignerEnv();
  if (!signer) return rest("skipped", job.state, job.documentsReady, job.blocked);

  const listed = await listImmutableWorkspaceObjects(signer, job.workspaceKey);
  if (!listed.ok) return rest("waiting", job.state, job.documentsReady, job.blocked);

  const selected = selectCurrentDocumentVersions(groupImmutableDocuments(job.workspaceKey, listed.objects));
  const documents = selected.documents;
  const stalled = Date.now() - Date.parse(job.createdAt) > STALL_AFTER_MS;
  const classified = classify(job, documents, stalled);
  for (const documentId of selected.ambiguousDocumentIds) {
    if (!job.documentIds.includes(documentId)) continue;
    classified.ready = classified.ready.filter((id) => id !== documentId);
    classified.awaitingReading = classified.awaitingReading.filter((id) => id !== documentId);
    classified.awaitingUpload = classified.awaitingUpload.filter((id) => id !== documentId);
    if (!classified.blocked.some((item) => item.documentId === documentId)) {
      classified.blocked.push({ documentId, kind: "input", reason: "SOURCE_VERSION_AMBIGUOUS" });
    }
  }

  // Record progress and any newly discovered blockers before deciding anything, so a customer
  // watching the stream sees the same picture the worker is reasoning about.
  const blockedChanged = JSON.stringify(classified.blocked) !== JSON.stringify(job.blocked);
  const phase: CompileState = classified.awaitingUpload.length > 0 ? "uploading" : "reading";

  if (!blockersResolved(job, classified.blocked)) {
    // Stop. The customer chooses: continue with what read cleanly, remove the blocked files,
    // retry the ones that can be retried, or cancel. The worker never chooses for them.
    if (blockedChanged || job.documentsReady !== classified.ready.length) {
      await advanceCompileJob({
        workspaceKey: job.workspaceKey,
        jobId: job.jobId,
        state: phase,
        documentsReady: classified.ready.length,
        blocked: classified.blocked,
      });
    }
    return rest("blocked", phase, classified.ready.length, classified.blocked);
  }

  const stillWorking = classified.awaitingUpload.length > 0 || classified.awaitingReading.length > 0;
  if (stillWorking) {
    await advanceCompileJob({
      workspaceKey: job.workspaceKey,
      jobId: job.jobId,
      state: phase,
      documentsReady: classified.ready.length,
      blocked: blockedChanged ? classified.blocked : undefined,
    });
    return rest("waiting", phase, classified.ready.length, classified.blocked);
  }

  if (classified.ready.length === 0) {
    return settleFailed({
      workspaceKey: job.workspaceKey,
      jobId: job.jobId,
      state: "failed",
      documentsReady: 0,
      errorCode: "NO_DOCUMENT_COULD_BE_READ",
      blocked: classified.blocked,
    }, 0, classified.blocked);
  }

  /*
    Take the lease by moving into `structuring`, and compile only if this call is the one that
    moved it. Two schedulers firing together therefore produce one compile, not two.

    A stale lease is taken over the same way: a worker that died mid-compile left the row here,
    and after COMPILE_LEASE_MS another worker may pick it up. Repeating the compile is safe -- the
    collection id is derived from the input binding and the artifact write is idempotent -- so
    the cost of being wrong about a dead worker is one wasted run, not a duplicate World.

    Both are one compare-and-set on the row as this turn read it (`claimCompileJobLease`), so of
    every runner that read the same row exactly one compiles. Before 2026-11-05 the takeover was
    a bare clock check and the fresh lease an RPC that answers `changed` to every same-rank
    caller; cjob-157f2f23 ran Core twice and appended a `structuring` row after `failed`.
  */
  if (job.state === "structuring" && Date.now() - Date.parse(job.updatedAt) < COMPILE_LEASE_MS) {
    return rest("skipped", job.state, classified.ready.length, classified.blocked);
  }
  /*
    Never take a lease the tick cannot finish. Core is given CORE_CLIENT_TIMEOUT_MS and settlement
    the rest of the 60 s, so a claim is only made while a whole Core call still fits; otherwise the
    job keeps its place at the head of the queue for the next tick. Without this a second compile
    in one tick claimed at ~46 s, the function died at 60 s, and the lease sat dead for 5 minutes
    (REVIEW-PR192-R1 MAJOR-1) -- cjob-157f2f23's failure, moved from the stream to the cron.
  */
  if (deadlineAt - Date.now() < CORE_CLIENT_TIMEOUT_MS) {
    return { ...rest("skipped", job.state, classified.ready.length, classified.blocked), outOfTime: true };
  }
  const leased = await claimCompileJobLease({
    job,
    documentsReady: classified.ready.length,
    blocked: blockedChanged ? classified.blocked : undefined,
  });
  if (!leased.ok || !leased.value.claimed) {
    return rest("skipped", job.state, classified.ready.length, classified.blocked);
  }
  claimed = true;
  // Core's budget is cut to what the tick has left minus the settlement reserve (MINOR-10).
  const tickDeadline = Number.isFinite(deadlineAt) ? deadlineAt : undefined;

  const run = job.compilationMode === "global_collection"
    ? await runCollectionCompile(job.workspaceKey, classified.ready, `${GLOBAL_COLLECTION_KEY_PREFIX}${job.corpusId}`, job.jobId,
      { userId: job.createdByUserId, provenance: "durable_job" }, tickDeadline)
    : await runCollectionCompile(job.workspaceKey, classified.ready, undefined, job.jobId,
      { userId: job.createdByUserId, provenance: "durable_job" }, tickDeadline);
  if (!run.ok) {
    if (isCompileWaitingOnReading(run.code)) {
      /*
        The listing said ready and the compiler, listing again, said it was not.

        Believing the compiler is right; saying nothing about it was not. Nothing was written,
        so `updated_at` stayed where it was and the job kept its place at the head of the
        oldest-first window, re-listing the workspace twice a turn for ever. Nothing counted the
        disagreement either, so a permanent one -- the two views deriving "read" differently --
        could never end.

        Every deferral is therefore recorded and moves the job to the back of the queue, and a
        disagreement that survives `MAX_READING_DEFERRALS` turns is settled rather than retried:
        at that point it is not a listing catching up, and a job that cannot finish should say so.
        A count that cannot be read does not settle anything -- the ledger keeps the evidence and
        the bound applies again as soon as the store answers.
      */
      const seen = await countCompileJobDeferrals(
        job.workspaceKey,
        job.jobId,
        READING_LISTING_DISAGREEMENT,
        MAX_READING_DEFERRALS + 1,
      );
      const attempt = (seen.ok ? seen.value : 0) + 1;
      if (attempt > MAX_READING_DEFERRALS) {
        return settleFailed({
          workspaceKey: job.workspaceKey,
          jobId: job.jobId,
          state: "failed",
          documentsReady: classified.ready.length,
          errorCode: READING_LISTING_DISAGREEMENT,
          blocked: classified.blocked,
        }, classified.ready.length, classified.blocked);
      }
      await recordCompileJobDeferral({
        job,
        state: "structuring",
        documentsReady: classified.ready.length,
        blocked: classified.blocked,
        reason: READING_LISTING_DISAGREEMENT,
        attempt,
      });
      await advanceCompileJob({
        workspaceKey: job.workspaceKey,
        jobId: job.jobId,
        state: "structuring",
        documentsReady: classified.ready.length,
      });
      return rest("waiting", "structuring", classified.ready.length, classified.blocked);
    }
    const sizeLimit = run.payload.sizeLimit;
    if (sizeLimit && typeof sizeLimit === "object") {
      // Best effort: the failure below is recorded whether or not this row lands. Not deduplicated:
      // if the failed advance is refused, the lease expires and a retry appends a second, identical
      // row -- append-only and harmless, the same as the deferral rows.
      await recordCompileJobSizeLimit({ job, state: "structuring", documentsReady: classified.ready.length,
        blocked: classified.blocked, reason: run.code, sizeLimit: sizeLimit as Record<string, unknown> });
    }
    return settleFailed({
      workspaceKey: job.workspaceKey,
      jobId: job.jobId,
      state: "failed",
      errorCode: run.code,
      blocked: classified.blocked,
    }, classified.ready.length, classified.blocked);
  }

  // The digest goes on both advances, not because it is written twice -- the RPC coalesces --
  // but because either call can be the one that lands. A redelivery whose first advance is
  // refused for moving backwards (the job is already at review_required) would otherwise settle
  // with no record of the artifact it produced.
  await advanceRecordingDigest({
    workspaceKey: job.workspaceKey,
    jobId: job.jobId,
    state: "building_world",
    documentsReady: classified.ready.length,
    collectionId: run.payload.collectionId,
    candidateManifestDigest: run.payload.manifestDigest,
  });

  const settled: CompileState = run.payload.lifecycle === "review_required" ? "review_required" : "ready";
  await advanceRecordingDigest({
    workspaceKey: job.workspaceKey,
    jobId: job.jobId,
    state: settled,
    documentsReady: classified.ready.length,
    collectionId: run.payload.collectionId,
    blocked: classified.blocked,
    candidateManifestDigest: run.payload.manifestDigest,
  });
  return rest("compiled", settled, classified.ready.length, classified.blocked);
}

/*
  GA fairness (ops audit gap 3, 2026-11-10). The store hands jobs out oldest-first across every
  workspace, so a workspace with 22 runnable jobs (WORKSPACE_RUNNABLE_COMPILE_LIMIT) held 22 places
  ahead of a workspace with one: each of its jobs moves to the back after a turn, but the front of
  the queue is still mostly that workspace.

  The batch now reads the widest window the store allows and takes one job per workspace per
  round -- every workspace's oldest, then every workspace's second-oldest -- in the order of each
  workspace's oldest job. Nothing about a turn changes: the lease (claimCompileJobLease) still
  admits the work, so a reordered or redelivered turn is the same idempotent at-least-once step.
*/
export const COMPILE_BATCH_SCAN_WINDOW = 100;

// ponytail: fair within the 100 oldest runnable jobs. A workspace whose every job is newer than
// those 100 waits until turns move them to the back; a DISTINCT ON (workspace_key) RPC is the
// upgrade once more than four workspaces sit at the 22-job limit at the same time.
export function interleaveByWorkspace(jobs: readonly CompileJob[]): CompileJob[] {
  const queues = new Map<string, CompileJob[]>();
  for (const job of jobs) {
    const queue = queues.get(job.workspaceKey);
    if (queue) queue.push(job);
    else queues.set(job.workspaceKey, [job]);
  }
  const fair: CompileJob[] = [];
  for (let round = 0; fair.length < jobs.length; round += 1) {
    for (const queue of queues.values()) if (round < queue.length) fair.push(queue[round]!);
  }
  return fair;
}

/** One turn across the queue: pick up whatever is due and advance each by one step. */
export async function runCompileJobBatch(
  limit = 5,
  /** The tick's wall clock: this invocation dies at WORKER_MAX_DURATION_MS. */
  deadlineAt = Date.now() + WORKER_MAX_DURATION_MS,
): Promise<CompileJobTurn[]> {
  // Read a bounded scan window so a handful of policy-store outages cannot monopolize the
  // oldest-first runnable window when their event or timestamp write fails. This is one metadata
  // query; retryable jobs still perform no R2 listing, OCR read, or Core dispatch.
  const workLimit = Math.min(Math.max(Math.trunc(limit) || 1, 1), 100);
  const open = await readOpenCompileJobs(COMPILE_BATCH_SCAN_WINDOW);
  if (!open.ok) {
    // An unreadable queue is not an empty one: say so, or a filter PostgREST refuses looks idle.
    console.error(JSON.stringify({ event: "compile_batch_read_failed", code: open.code }));
    return [];
  }
  const turns: CompileJobTurn[] = [];
  let attempted = 0;
  // The turn bound is what it was before the window widened: at most two per unit of work.
  for (const job of interleaveByWorkspace(open.value).slice(0, workLimit * 2)) {
    const turn = await runCompileJobTurn(job, deadlineAt);
    turns.push(turn);
    if (turn.outOfTime) break;
    // A job waiting on the customer's blocker decision is not work (D0, 2026-11-08). The store
    // no longer hands those out; this covers one that became blocked during this very turn.
    if (turn.retryable || turn.note === "resting" || turn.note === "blocked") continue;
    attempted += 1;
    if (attempted >= workLimit) break;
  }
  return turns;
}
