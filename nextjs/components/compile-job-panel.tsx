"use client";

import type { BlockerResolution, CompileBlocker, CompileState } from "@/lib/compile-job-store";
import type { CorpusProgress } from "@/lib/corpus-batching";

/*
  What the server is doing with a compile, and what the customer is allowed to do about it.

  This panel replaces a sentence. The old workspace reported progress in `notice` -- one line
  of prose, rewritten on every poll -- which worked while the browser owned the run and stopped
  making sense the moment it did not. A compile now outlives the tab, so the tab needs a view
  of something it is not driving: where the job is, how much of it has been read, what is stuck
  and who has to decide.

  It states the durable fact plainly, because that is the reassurance that matters here:
  closing the page does not stop the compile.
*/

export type CompileJobView = {
  jobId: string;
  state: CompileState;
  documentsTotal: number;
  documentsReady: number;
  blocked: CompileBlocker[];
  blockedResolution: BlockerResolution | null;
  errorCode: string | null;
  collectionId: string | null;
  /* Set when this job is one part of a corpus compile (migration 0040). */
  corpusId?: string | null;
  batchIndex?: number | null;
};

/*
  One line per state, in the customer's terms.

  `sanitizing` is here even though the worker never claims it, because the upload path can:
  the vocabulary is the product's, not one component's view of it.
*/
const STATE_COPY: Record<CompileState, string> = {
  draft: "Not started.",
  preflight: "Checking the selection.",
  awaiting_confirmation: "Waiting for you to confirm.",
  uploading: "Waiting for every file to arrive.",
  sanitizing: "Preparing sources safely.",
  reading: "Reading the sources.",
  structuring: "Structuring what was read.",
  resolving: "Resolving entities across documents.",
  building_world: "Building the World.",
  review_required: "A review package is ready for a person to inspect.",
  ready: "Compiled World ready.",
  failed: "This compile stopped.",
  cancelled: "Cancelled.",
};

const BLOCKER_COPY: Record<string, string> = {
  DOCUMENT_NEVER_ARRIVED: "never finished uploading",
  READING_DID_NOT_FINISH: "did not finish being read",
  READING_NEEDS_OPERATOR_REVIEW: "needs operator review before it can be read",
};

const SETTLED: readonly CompileState[] = ["ready", "failed", "cancelled"];

/*
  A corpus is a run of several compiles, and the panel says so above the part it is showing.

  Deliberately not a second progress bar for the whole corpus. The bar below tracks the part
  the customer is looking at, and averaging eleven parts into one number would hide the thing
  they actually need -- which part is stuck, and on what.
*/
const CORPUS_COPY: Record<CorpusProgress["state"], string> = {
  running: "compiling",
  ready: "all parts compiled",
  partial: "some parts did not compile",
  failed: "no part compiled",
};

export function CompileJobPanel({
  job,
  corpus,
  names,
  busy,
  onResolve,
  onCancel,
  onOpenPart,
}: {
  job: CompileJobView;
  corpus?: (CorpusProgress & { parts: Array<{ jobId: string; batchIndex: number | null; state: CompileState }> }) | null;
  names?: Record<string, string>;
  busy?: boolean;
  onResolve: (resolution: BlockerResolution) => void;
  onCancel: () => void;
  onOpenPart?: (jobId: string) => void;
}) {
  const settled = SETTLED.includes(job.state);
  const undecided = job.blocked.length > 0 && !job.blockedResolution && !settled;
  const security = job.blocked.filter((entry) => entry.kind === "security");
  const clean = Math.max(0, job.documentsTotal - job.blocked.length);

  return (
    <section className="workspace-compile-job" aria-labelledby="workspace-compile-job-title" data-state={job.state}>
      <p className="eyebrow">{corpus ? `CORPUS · PART ${(job.batchIndex ?? 0) + 1} OF ${corpus.batchCount}` : "COMPILE"}</p>
      <h2 id="workspace-compile-job-title">{STATE_COPY[job.state]}</h2>
      {corpus ? (
        <>
          <p className="fine">
            {corpus.documentsTotal} sources in {corpus.batchCount} parts, {CORPUS_COPY[corpus.state]} ·
            {" "}{corpus.partsReady} ready{corpus.partsFailed > 0 ? `, ${corpus.partsFailed} stopped` : ""}
          </p>
          {/*
            Each part is its own World and its own state machine, so each is its own control.
            Rolling them into one status would make "part 7 needs a decision" invisible.
          */}
          <ol className="workspace-corpus-parts">
            {corpus.parts.map((part) => (
              <li key={part.jobId}>
                <button
                  type="button"
                  data-state={part.state}
                  aria-pressed={part.jobId === job.jobId}
                  onClick={() => onOpenPart?.(part.jobId)}
                >
                  {(part.batchIndex ?? 0) + 1}
                </button>
              </li>
            ))}
          </ol>
        </>
      ) : null}
      <p className="fine">
        {job.documentsReady} of {job.documentsTotal} read
        {job.errorCode ? ` · ${job.errorCode}` : ""}
      </p>
      {/*
        The sentence this whole change exists to make true. It is worth saying out loud, in the
        place where somebody is deciding whether they can close the laptop.
      */}
      {settled ? null : (
        <p className="fine">This runs on our servers. You can close this page and come back to it.</p>
      )}
      <progress
        className="workspace-compile-job-progress"
        max={job.documentsTotal}
        value={job.documentsReady}
        aria-label={`${job.documentsReady} of ${job.documentsTotal} sources read`}
      />

      {job.blocked.length > 0 ? (
        <div className="workspace-compile-job-blocked" role="group" aria-label="Sources that could not be read">
          <p className="fine">
            {job.blocked.length} of {job.documentsTotal} could not be read.
          </p>
          <ul>
            {job.blocked.map((entry) => (
              <li key={entry.documentId}>
                <strong>{names?.[entry.documentId] ?? entry.documentId}</strong>
                {" "}
                {BLOCKER_COPY[entry.reason] ?? entry.reason.toLowerCase().replace(/_/g, " ")}
                {entry.kind === "security" ? <em> · stopped by a safety check</em> : null}
              </li>
            ))}
          </ul>
          {undecided ? (
            <>
              {/*
                Four offers, and nothing happens until one is chosen. A worker that compiled
                the readable ones by itself would hand back a World quietly missing documents
                the customer still believes are in it.
              */}
              <div className="workspace-intake-actions">
                <button
                  type="button"
                  disabled={busy || security.length > 0}
                  onClick={() => onResolve("continue")}
                >
                  Continue with {clean}
                </button>
                <button type="button" disabled={busy} onClick={() => onResolve("remove_blocked")}>
                  Remove the {job.blocked.length} blocked
                </button>
                <button
                  type="button"
                  disabled={busy || job.blocked.every((entry) => entry.kind === "security")}
                  onClick={() => onResolve("retry_eligible")}
                >
                  Retry what can be retried
                </button>
                <button type="button" disabled={busy} onClick={onCancel}>Cancel</button>
              </div>
              {security.length > 0 ? (
                <p className="fine workspace-preflight-blocked" role="alert">
                  {security.length === 1 ? "One file was" : `${security.length} files were`} stopped by a safety
                  check. Continuing past {security.length === 1 ? "it" : "them"} is not a one-click choice — remove
                  {security.length === 1 ? " it" : " them"} from this compile explicitly, or cancel.
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      {!settled && !undecided ? (
        <div className="workspace-intake-actions">
          <button type="button" disabled={busy} onClick={onCancel}>Cancel this compile</button>
        </div>
      ) : null}
    </section>
  );
}
