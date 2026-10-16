"use client";

import { useEffect, useId, useState } from "react";

type SyncJob = { jobId: string; state: string; itemsSeen: number; itemsDone: number; errorCode: string | null };
/**
  Counts of unfinished jobs behind the newest one. Absent until the route reports them.
  `coverage` says what the counts were taken over: the `rowsRead` most recent jobs out of at most
  `window` asked for ("recent_window"; older or other jobs may exist), or nobody could say
  ("unknown"). There is no "every job" coverage: no read here proves a connection-wide total.
*/
type SyncBacklog = { queued: number; leased: number; coverage: "recent_window" | "unknown"; window: number | null; rowsRead: number | null };
const STATES = new Set(["queued", "leased", "succeeded", "failed", "dead", "canceled"]);
const BACKLOG_UNREAD = "Other imports for this connection could not be counted, so this does not show whether any are still waiting.";

/*
  Accept the backlog only in the exact shape the route sends (audit I06).

  Malformed or absent counts return null and the panel says nothing about backlog, because
  printing "0 waiting" for a count nobody read is the difference between a status and a guess.
  Valid counts are always kept, but only as a lower bound. "recent_window" is believed only when
  the route's own numbers agree (a window, and a rowsRead within it that holds every counted job);
  anything else, including a "complete" marker from an earlier route that had no proof of a total,
  is "unknown".
*/
export function readSyncBacklog(value: unknown): SyncBacklog | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (!Number.isSafeInteger(raw.queued) || !Number.isSafeInteger(raw.leased)) return null;
  const queued = raw.queued as number, leased = raw.leased as number;
  if (queued < 0 || leased < 0) return null;
  const window = Number.isSafeInteger(raw.window) && (raw.window as number) > 0 ? raw.window as number : null;
  const rowsRead = Number.isSafeInteger(raw.rowsRead) && (raw.rowsRead as number) > 0
    && (raw.rowsRead as number) >= queued + leased && (window === null || (raw.rowsRead as number) <= window) ? raw.rowsRead as number : null;
  const coverage = raw.coverage === "recent_window" && window !== null && rowsRead !== null ? "recent_window" : "unknown";
  return { queued, leased, coverage, window, rowsRead };
}

/** The backlog line, or null when no backlog was reported. */
export function describeBacklog(backlog: SyncBacklog | null): string | null {
  if (!backlog) return null;
  const total = backlog.queued + backlog.leased;
  const counts = `${backlog.queued} waiting for a worker · ${backlog.leased} being read now`;
  // A bounded or unconfirmed read can undercount, never overcount: say "at least", and never turn 0 into "none".
  const recent = backlog.coverage === "recent_window" ? `${backlog.rowsRead} recent import${backlog.rowsRead === 1 ? "" : "s"} read` : null;
  const scope = recent ? `${recent}, up to ${backlog.window} requested; older or other imports were not confirmed.`
    : "How many imports were read could not be confirmed.";
  if (total > 0) return `At least ${total} import${total === 1 ? "" : "s"} not finished · ${counts}. ${scope}`;
  return recent
    ? `No import is waiting or being read among the ${recent} (up to ${backlog.window} requested). Older or other imports were not confirmed, so this does not show that every import is finished.`
    : `No unfinished import among the imports read. ${scope} This does not show that every import is finished.`;
}

/*
  Everything the panel says about the backlog and the newest job's outcome, each scoped to what
  was read. No read here proves that every import of the connection is finished, so only the
  newest job is ever said to have finished, and only when nothing known is waiting behind it.
*/
export function describeImportScope(latestState: string, backlog: SyncBacklog | null): string[] {
  const lines: string[] = [];
  const backlogLine = backlog ? describeBacklog(backlog) : BACKLOG_UNREAD;
  if (backlogLine) lines.push(backlogLine);
  if (latestState === "succeeded" && (!backlog || backlog.queued + backlog.leased === 0)) {
    lines.push("The latest import finished. Check the workspace for processing and review results.");
  }
  return lines;
}

function recovery(code: string | null) {
  if (code === "SOURCE_LIFECYCLE_REVIEW_REQUIRED" || code?.includes("SUSPENSION") || code?.includes("BINDING_UNRESOLVED"))
    return "Source access changed. Review the affected sources and permissions before continuing.";
  if (code === "INTAKE_DAILY_QUOTA_EXCEEDED") return "The daily import allowance has been reached. This job is waiting for capacity.";
  if (code === "OAUTH_TOKEN_REFRESH_FAILED" || code === "OAUTH_CONNECTION_NOT_FOUND")
    return "The source connection could not be refreshed. Check its account access before starting another import.";
  if (code?.includes("REVISION") || code?.includes("HASH_MISMATCH"))
    return "A source version could not be verified. Check whether the file changed during import.";
  if (code?.includes("CURSOR") || code?.includes("PAGE_INVALID"))
    return "The source listing could not be verified. The saved position has not been discarded; contact support if the job remains stopped.";
  return code ? "The import encountered a problem. Use the diagnostic code below when contacting support." : null;
}

export default function ConnectionSyncStatus({ connectionId, revision, getToken }: {
  connectionId: string; revision: number; getToken: () => Promise<string | null>;
}) {
  const titleId = useId();
  const [jobs, setJobs] = useState<SyncJob[] | null>(null);
  const [backlog, setBacklog] = useState<SyncBacklog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      try {
        const token = await getToken();
        if (!token) throw new Error("Sign in again to read import progress.");
        const response = await fetch(`/api/v1/oauth-connectors/connections/${connectionId}/sync`, {
          headers: { authorization: `Bearer ${token}` },
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
        });
        const payload = await response.json();
        if (!response.ok || !Array.isArray(payload.jobs) || !payload.jobs.every((job: SyncJob) =>
          job && typeof job.jobId === "string" && STATES.has(job.state)
          && Number.isSafeInteger(job.itemsSeen) && job.itemsSeen >= 0
          && Number.isSafeInteger(job.itemsDone) && job.itemsDone >= 0 && job.itemsDone <= job.itemsSeen
          && (job.errorCode === null || typeof job.errorCode === "string"))) {
          throw new Error("Import progress could not be read. Refresh to try again.");
        }
        if (controller.signal.aborted) return;
        const known = readSyncBacklog(payload.backlog);
        setJobs(payload.jobs);
        setBacklog(known);
        setError(null);
        /*
          Keep reading while work is known to be unfinished: a listed job, or a validated count of
          unfinished jobs older than the ten listed (UX11/K23). Counts are a lower bound, so a
          positive one is proof whatever its coverage; a missing, malformed or zero count is not,
          and uncertainty alone never starts another read.
        */
        if (payload.jobs.some((job: SyncJob) => job.state === "queued" || job.state === "leased")
          || (known !== null && known.queued + known.leased > 0)) {
          timer = setTimeout(() => { void read(); }, 5_000);
        }
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error && failure.message.startsWith("Sign in")
          ? failure.message : "Import progress could not be read. Refresh to try again.");
      }
    };
    void read();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [connectionId, revision, refresh, getToken]);

  const latest = jobs?.[0];
  const advice = recovery(latest?.errorCode ?? null);
  const stateLabel = latest ? ({ queued: "Import queued", leased: "Import in progress", succeeded: "Import finished",
    failed: "Import stopped", dead: "Import needs attention", canceled: "Import canceled" }[latest.state]) : null;
  return <section aria-labelledby={titleId} className="connection-sync-status">
    <strong id={titleId}>Import progress</strong>
    <div role="status" aria-live="polite">
      {error ? <p>{error}{latest ? " The result below is the last known state." : ""}</p> : null}
      {jobs === null && !error ? <p>Reading import progress…</p> : null}
      {jobs?.length === 0 ? <p>No import has been started for this connection.</p> : null}
      {latest ? <>
        <p><strong>{stateLabel}</strong> · {latest.itemsSeen} entries checked · {latest.itemsDone} files accepted</p>
        {/*
          Said even when the newest job succeeded: "finished" describes one job, and a
          connection with work still queued behind it is not up to date.
        */}
        {describeImportScope(latest.state, backlog).map(line => <p key={line}>{line}</p>)}
        {advice ? <p>{advice}</p> : null}
      </> : null}
    </div>
    {latest ? <details><summary>Import details</summary><p>Job: <code>{latest.jobId}</code></p>
      {latest.errorCode ? <p>Code: <code>{latest.errorCode}</code></p> : null}</details> : null}
    <button type="button" onClick={() => setRefresh(value => value + 1)}>Refresh import progress</button>
  </section>;
}
