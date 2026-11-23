import { percentile } from "./operational-sli";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";

/*
  WO-D24-2: the distribution behind the oldest-job wait the SLI already reports. For compile jobs
  that settled (`ready` or `failed`; a cancel is the customer's choice, not queue latency):

  - start wait: `created_at` to the first event that is not `created` -- the first time anything
    moved the job. A judgement about what "left the queue" means, not a measurement of the worker.
  - time to settle: `created_at` to `settled_at`.

  Seconds, nearest-rank percentiles. Nothing here carries a workspace, job id or document.
*/
export type CompileQueueTimingSample = { startWaitSeconds: number | null; timeToSettleSeconds: number };

export type CompileQueueTimingReading = { ok: true; samples: CompileQueueTimingSample[] } | { ok: false };

type Percentiles = { p50: number | null; p95: number | null; p99: number | null };

export type CompileQueueTimingSummary = { n: number; startWait: Percentiles; timeToSettle: Percentiles };

const spread = (values: number[]): Percentiles => ({
  p50: percentile(values, 50),
  p95: percentile(values, 95),
  p99: percentile(values, 99),
});

export function summarizeQueueTimings(samples: readonly CompileQueueTimingSample[]): CompileQueueTimingSummary {
  return {
    n: samples.length,
    startWait: spread(samples.flatMap((sample) => (sample.startWaitSeconds === null ? [] : [sample.startWaitSeconds]))),
    timeToSettle: spread(samples.map((sample) => sample.timeToSettleSeconds)),
  };
}

type JobRow = { job_id?: unknown; created_at?: unknown; settled_at?: unknown };
type EventRow = { job_id?: unknown; occurred_at?: unknown };

const ms = (value: unknown) => (typeof value === "string" ? Date.parse(value) : Number.NaN);

// ponytail: the event read is capped at 20 events per job; a job with more non-created events than
// that leaves a later job without its first event and reads as startWait null, never as zero.
export async function readCompileQueueTimings(sinceIso: string, limit = 500): Promise<CompileQueueTimingReading> {
  const config = readSupabaseAdminConfig();
  if (!config || Number.isNaN(Date.parse(sinceIso))) return { ok: false };
  const bounded = Math.min(Math.max(1, Math.trunc(limit)), 500);
  try {
    const jobsResponse = await supabaseAdminRequest(
      config,
      `/rest/v1/foundation_compile_jobs?${new URLSearchParams({
        state: "in.(ready,failed)",
        settled_at: `gte.${sinceIso}`,
        order: "settled_at.desc",
        limit: String(bounded),
        select: "job_id,created_at,settled_at",
      })}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!jobsResponse.ok) return { ok: false };
    const jobs = await jobsResponse.json().catch(() => null) as JobRow[] | null;
    if (!Array.isArray(jobs)) return { ok: false };
    const ids = jobs.flatMap((job) => (typeof job.job_id === "string" ? [job.job_id] : []));
    const firstMoved = new Map<string, number>();
    if (ids.length > 0) {
      const eventsResponse = await supabaseAdminRequest(
        config,
        `/rest/v1/foundation_compile_job_events?${new URLSearchParams({
          job_id: `in.(${ids.join(",")})`,
          event_type: "neq.created",
          order: "job_id.asc,event_sequence.asc",
          limit: String(Math.min(ids.length * 20, 10_000)),
          select: "job_id,occurred_at",
        })}`,
        { signal: AbortSignal.timeout(10_000) },
      );
      if (!eventsResponse.ok) return { ok: false };
      const events = await eventsResponse.json().catch(() => null) as EventRow[] | null;
      if (!Array.isArray(events)) return { ok: false };
      for (const event of events) {
        const at = ms(event.occurred_at);
        if (typeof event.job_id === "string" && Number.isFinite(at) && !firstMoved.has(event.job_id)) firstMoved.set(event.job_id, at);
      }
    }
    const samples: CompileQueueTimingSample[] = [];
    for (const job of jobs) {
      const created = ms(job.created_at);
      const settled = ms(job.settled_at);
      if (!Number.isFinite(created) || !Number.isFinite(settled)) return { ok: false };
      const moved = typeof job.job_id === "string" ? firstMoved.get(job.job_id) : undefined;
      samples.push({
        startWaitSeconds: moved === undefined ? null : Math.max(0, Math.floor((moved - created) / 1_000)),
        timeToSettleSeconds: Math.max(0, Math.floor((settled - created) / 1_000)),
      });
    }
    return { ok: true, samples };
  } catch {
    return { ok: false };
  }
}
