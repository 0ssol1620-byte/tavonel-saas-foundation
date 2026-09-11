"use client";

import { useEffect, useId, useState } from "react";

type SyncJob = { jobId: string; state: string; itemsSeen: number; itemsDone: number; errorCode: string | null };
/** Counts of unfinished jobs behind the newest one. Absent until the route reports them. */
type SyncBacklog = { queued: number; leased: number };
const STATES = new Set(["queued", "leased", "succeeded", "failed", "dead", "canceled"]);

/*
  Accept the backlog only in the exact shape the route sends (audit I06).

  A malformed or absent field returns null and the panel says nothing about backlog, because
  printing "0 waiting" for a count nobody read is the difference between a status and a guess.
*/
export function readSyncBacklog(value: unknown): SyncBacklog | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (!Number.isSafeInteger(raw.queued) || !Number.isSafeInteger(raw.leased)) return null;
  if ((raw.queued as number) < 0 || (raw.leased as number) < 0) return null;
  return { queued: raw.queued as number, leased: raw.leased as number };
}

/** The backlog line, or null when nothing is waiting or nothing was reported. */
export function describeBacklog(backlog: SyncBacklog | null): string | null {
  if (!backlog) return null;
  const total = backlog.queued + backlog.leased;
  if (total === 0) return null;
  return `${total} import${total === 1 ? "" : "s"} not finished · ${backlog.queued} waiting for a worker · ${backlog.leased} being read now`;
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
        setJobs(payload.jobs);
        setBacklog(readSyncBacklog(payload.backlog));
        setError(null);
        if (payload.jobs.some((job: SyncJob) => job.state === "queued" || job.state === "leased")) {
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
  const backlogLine = describeBacklog(backlog);
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
        {backlogLine ? <p>{backlogLine}</p> : null}
        {latest.state === "succeeded" && !backlogLine ? <p>Import is finished. Check the workspace for processing and review results.</p> : null}
        {advice ? <p>{advice}</p> : null}
      </> : null}
    </div>
    {latest ? <details><summary>Import details</summary><p>Job: <code>{latest.jobId}</code></p>
      {latest.errorCode ? <p>Code: <code>{latest.errorCode}</code></p> : null}</details> : null}
    <button type="button" onClick={() => setRefresh(value => value + 1)}>Refresh import progress</button>
  </section>;
}
