import { isCompileWaitingOnReading, runCollectionCompile } from "./collection-compile-run";
import {
  advanceCompileJob,
  type CompileBlocker,
  type CompileJob,
  type CompileState,
  isRestingCompileState,
  readOpenCompileJobs,
} from "./compile-job-store";
import { groupImmutableDocuments } from "./immutable-keys";
import { listImmutableWorkspaceObjects } from "./r2-objects";
import { readR2SignerEnv } from "./r2-synthetic-canary";

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
 * How long a compile may sit in `structuring` before another worker may take it over.
 *
 * The transition into `structuring` is the lease: only the worker whose advance actually
 * changed the row runs the expensive step, so two schedulers firing at once do not compile
 * twice. This is the other half -- without it, a worker that died mid-compile would strand
 * the job in `structuring` forever.
 */
const COMPILE_LEASE_MS = 5 * 60 * 1_000;

export type CompileJobTurn = {
  jobId: string;
  state: CompileState;
  note: "waiting" | "advanced" | "blocked" | "compiled" | "failed" | "resting" | "skipped";
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

export async function runCompileJobTurn(job: CompileJob): Promise<CompileJobTurn> {
  const rest = (
    note: CompileJobTurn["note"],
    state: CompileState,
    documentsReady: number,
    blocked: CompileBlocker[],
  ): CompileJobTurn => ({ jobId: job.jobId, state, note, documentsReady, blocked });

  /*
    A resting state is not an unfinished one.

    The compile produced a package a person has to look at. Nothing the worker can do moves it
    along, and picking it up again would recompile the same sources on every turn forever.

    The scheduler no longer offers these at all (`SCHEDULER_EXCLUDED_STATES`), so this is a
    second reader of one list rather than a second opinion: the events route nudges this
    function for any non-terminal job, a watched review package included.
  */
  if (isRestingCompileState(job.state)) return rest("resting", job.state, job.documentsReady, job.blocked);

  const signer = readR2SignerEnv();
  if (!signer) return rest("skipped", job.state, job.documentsReady, job.blocked);

  const listed = await listImmutableWorkspaceObjects(signer, job.workspaceKey);
  if (!listed.ok) return rest("waiting", job.state, job.documentsReady, job.blocked);

  const documents = groupImmutableDocuments(job.workspaceKey, listed.objects);
  const stalled = Date.now() - Date.parse(job.createdAt) > STALL_AFTER_MS;
  const classified = classify(job, documents, stalled);

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
    await advanceCompileJob({
      workspaceKey: job.workspaceKey,
      jobId: job.jobId,
      state: "failed",
      documentsReady: 0,
      errorCode: "NO_DOCUMENT_COULD_BE_READ",
      blocked: classified.blocked,
    });
    return rest("failed", "failed", 0, classified.blocked);
  }

  /*
    Take the lease by moving into `structuring`, and compile only if this call is the one that
    moved it. Two schedulers firing together therefore produce one compile, not two.

    An exception for a stale lease: a worker that died mid-compile left the row here, and after
    COMPILE_LEASE_MS another worker may pick it up. Repeating the compile is safe -- the
    collection id is derived from the input binding and the artifact write is idempotent -- so
    the cost of being wrong about a dead worker is one wasted run, not a duplicate World.
  */
  if (job.state !== "structuring") {
    const leased = await advanceCompileJob({
      workspaceKey: job.workspaceKey,
      jobId: job.jobId,
      state: "structuring",
      documentsReady: classified.ready.length,
      blocked: blockedChanged ? classified.blocked : undefined,
    });
    if (!leased.ok || !leased.value.changed) {
      return rest("skipped", job.state, classified.ready.length, classified.blocked);
    }
  } else if (Date.now() - Date.parse(job.updatedAt) < COMPILE_LEASE_MS) {
    return rest("skipped", job.state, classified.ready.length, classified.blocked);
  }

  const run = await runCollectionCompile(job.workspaceKey, classified.ready);
  if (!run.ok) {
    if (isCompileWaitingOnReading(run.code)) {
      // The listing said ready and the compiler disagreed. Believe the compiler, go back to
      // watching, and let the next turn look again.
      return rest("waiting", "structuring", classified.ready.length, classified.blocked);
    }
    await advanceCompileJob({
      workspaceKey: job.workspaceKey,
      jobId: job.jobId,
      state: "failed",
      errorCode: run.code,
      blocked: classified.blocked,
    });
    return rest("failed", "failed", classified.ready.length, classified.blocked);
  }

  await advanceCompileJob({
    workspaceKey: job.workspaceKey,
    jobId: job.jobId,
    state: "building_world",
    documentsReady: classified.ready.length,
    collectionId: run.payload.collectionId,
  });

  const settled: CompileState = run.payload.lifecycle === "review_required" ? "review_required" : "ready";
  await advanceCompileJob({
    workspaceKey: job.workspaceKey,
    jobId: job.jobId,
    state: settled,
    documentsReady: classified.ready.length,
    collectionId: run.payload.collectionId,
    blocked: classified.blocked,
  });
  return rest("compiled", settled, classified.ready.length, classified.blocked);
}

/** One turn across the queue: pick up whatever is due and advance each by one step. */
export async function runCompileJobBatch(limit = 5): Promise<CompileJobTurn[]> {
  const open = await readOpenCompileJobs(limit);
  if (!open.ok) return [];
  const turns: CompileJobTurn[] = [];
  for (const job of open.value) {
    turns.push(await runCompileJobTurn(job));
  }
  return turns;
}
