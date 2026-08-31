import { randomBytes } from "node:crypto";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";

// The application's view of the durable job queue (0024/0025). Every function here is a thin,
// validated wrapper over one of the three RPCs -- the invariants (atomic claim, lease
// ownership, backoff, dedup) live in the database, because they are concurrency invariants
// and only the database can enforce them across simultaneous workers.
//
// Transport is PostgREST, matching every other store in this codebase.

export type JobType = "source_scan" | "source_import" | "retrieval_compile";
export type JobState = "queued" | "leased" | "succeeded" | "failed" | "dead" | "canceled";

export type JobStoreFailure =
  | "JOB_STORE_NOT_CONFIGURED"
  | "JOB_STORE_READ_FAILED"
  | "JOB_STORE_WRITE_FAILED"
  | "JOB_SCOPE_INVALID"
  | "JOB_NOT_FOUND";

export type JobResult<T> = { ok: true; value: T } | { ok: false; code: JobStoreFailure };

const WORKSPACE_KEY = /^pilot-[A-Za-z0-9]{1,16}$/;
const JOB_ID = /^job-[a-f0-9]{32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function newJobId(): string {
  return `job-${randomBytes(16).toString("hex")}`;
}

function fail(code: JobStoreFailure) {
  return { ok: false as const, code };
}

async function rpc(name: string, body: unknown): Promise<JobResult<unknown>> {
  const config = readSupabaseAdminConfig();
  if (!config) return fail("JOB_STORE_NOT_CONFIGURED");
  let response: Response;
  try {
    response = await supabaseAdminRequest(config, `/rest/v1/rpc/${name}`, {
      method: "POST",
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return fail("JOB_STORE_WRITE_FAILED");
  }
  if (!response.ok) return fail("JOB_STORE_WRITE_FAILED");
  const payload = await response.json().catch(() => null);
  return { ok: true as const, value: payload };
}

export type EnqueueInput = {
  workspaceKey: string;
  jobType: JobType;
  // Two enqueues of the same logical work must produce one job. For a connector sync that
  // means (job type, connection) -- not a timestamp or a random value, or every click would
  // start another concurrent scan of the same source and they would race on the cursor.
  idempotencyKey: string;
  createdByUserId: string;
  oauthConnectionId?: string | null;
  collectionId?: string | null;
  payload?: Record<string, unknown>;
};

export type EnqueuedJob = { jobId: string; created: boolean };

export async function enqueueJob(input: EnqueueInput): Promise<JobResult<EnqueuedJob>> {
  if (!WORKSPACE_KEY.test(input.workspaceKey)) return fail("JOB_SCOPE_INVALID");
  if (!UUID.test(input.createdByUserId)) return fail("JOB_SCOPE_INVALID");
  if (input.idempotencyKey.length < 8 || input.idempotencyKey.length > 200) return fail("JOB_SCOPE_INVALID");
  if (input.oauthConnectionId && !UUID.test(input.oauthConnectionId)) return fail("JOB_SCOPE_INVALID");

  const result = await rpc("enqueue_foundation_job", {
    p_job_id: newJobId(),
    p_workspace_key: input.workspaceKey,
    p_job_type: input.jobType,
    p_idempotency_key: input.idempotencyKey,
    p_created_by: input.createdByUserId,
    p_oauth_connection_id: input.oauthConnectionId ?? null,
    p_collection_id: input.collectionId ?? null,
    p_payload: input.payload ?? {},
  });
  if (!result.ok) return result;

  const row = result.value as { job_id?: unknown; created?: unknown } | null;
  const jobId = typeof row?.job_id === "string" ? row.job_id : "";
  if (!JOB_ID.test(jobId)) return fail("JOB_STORE_WRITE_FAILED");
  return { ok: true as const, value: { jobId, created: row?.created === true } };
}

export type ClaimedJob = {
  jobId: string;
  workspaceKey: string;
  jobType: JobType;
  attempt: number;
  maxAttempts: number;
  oauthConnectionId: string | null;
  collectionId: string | null;
  payload: Record<string, unknown>;
  cursorToken: string | null;
  itemsSeen: number;
  itemsDone: number;
};

// Claims one eligible job. Returns null when the queue has nothing due -- an empty queue is
// the normal case for a worker, not an error.
export async function claimJob(
  workerId: string,
  leaseSeconds = 120,
  jobTypes?: JobType[],
): Promise<JobResult<ClaimedJob | null>> {
  const result = await rpc("claim_foundation_job", {
    p_worker_id: workerId,
    p_lease_seconds: leaseSeconds,
    p_job_types: jobTypes ?? null,
  });
  if (!result.ok) return result;

  const row = result.value as Record<string, unknown> | null;
  if (row?.claimed !== true) return { ok: true as const, value: null };
  return {
    ok: true as const,
    value: {
      jobId: String(row.job_id),
      workspaceKey: String(row.workspace_key),
      jobType: String(row.job_type) as JobType,
      attempt: Number(row.attempt),
      maxAttempts: Number(row.max_attempts),
      oauthConnectionId: typeof row.oauth_connection_id === "string" ? row.oauth_connection_id : null,
      collectionId: typeof row.collection_id === "string" ? row.collection_id : null,
      payload: (row.payload ?? {}) as Record<string, unknown>,
      cursorToken: typeof row.cursor_token === "string" ? row.cursor_token : null,
      itemsSeen: Number(row.items_seen ?? 0),
      itemsDone: Number(row.items_done ?? 0),
    },
  };
}

export type BatchOutcome =
  | { outcome: "progress"; itemsSeen: number; itemsDone: number; cursorToken?: string | null }
  | { outcome: "succeeded"; itemsSeen: number; itemsDone: number; cursorToken?: string | null }
  | { outcome: "retry"; errorCode: string; errorDetail?: string; itemsSeen?: number; itemsDone?: number; cursorToken?: string | null }
  | { outcome: "failed"; errorCode: string; errorDetail?: string };

// Commits one batch. The cursor advance travels with the batch deliberately: a worker that
// scanned a page but crashed before durably admitting its rows never reaches this call, so
// the cursor stays where it was and the page is re-read rather than skipped.
export async function completeJobBatch(
  workspaceKey: string,
  jobId: string,
  workerId: string,
  batch: BatchOutcome,
  leaseSeconds = 120,
): Promise<JobResult<{ state: JobState }>> {
  if (!WORKSPACE_KEY.test(workspaceKey) || !JOB_ID.test(jobId)) return fail("JOB_SCOPE_INVALID");

  const result = await rpc("complete_foundation_job_batch", {
    p_workspace_key: workspaceKey,
    p_job_id: jobId,
    p_worker_id: workerId,
    p_outcome: batch.outcome,
    p_items_seen_delta: "itemsSeen" in batch ? (batch.itemsSeen ?? 0) : 0,
    p_items_done_delta: "itemsDone" in batch ? (batch.itemsDone ?? 0) : 0,
    p_cursor_token: "cursorToken" in batch ? (batch.cursorToken ?? null) : null,
    p_lease_seconds: leaseSeconds,
    p_error_code: "errorCode" in batch ? batch.errorCode : null,
    p_error_detail: "errorDetail" in batch ? (batch.errorDetail ?? null) : null,
  });
  if (!result.ok) return result;
  const row = result.value as { state?: unknown } | null;
  return { ok: true as const, value: { state: String(row?.state ?? "queued") as JobState } };
}

export type JobStatus = {
  jobId: string;
  jobType: JobType;
  state: JobState;
  attempt: number;
  itemsSeen: number;
  itemsDone: number;
  errorCode: string | null;
  createdAt: string;
  completedAt: string | null;
};

// Reads one job's status for the workspace UI. Tenant-scoped by workspace_key on the query,
// so a caller cannot poll another tenant's job by guessing an id.
export async function getJobStatus(workspaceKey: string, jobId: string): Promise<JobResult<JobStatus>> {
  if (!WORKSPACE_KEY.test(workspaceKey) || !JOB_ID.test(jobId)) return fail("JOB_SCOPE_INVALID");
  const config = readSupabaseAdminConfig();
  if (!config) return fail("JOB_STORE_NOT_CONFIGURED");

  const query = new URLSearchParams({
    select: "job_id,job_type,state,attempt,items_seen,items_done,error_code,created_at,completed_at",
    workspace_key: `eq.${workspaceKey}`,
    job_id: `eq.${jobId}`,
    limit: "1",
  });

  let response: Response;
  try {
    response = await supabaseAdminRequest(config, `/rest/v1/foundation_jobs?${query}`);
  } catch {
    return fail("JOB_STORE_READ_FAILED");
  }
  if (!response.ok) return fail("JOB_STORE_READ_FAILED");
  const rows = (await response.json().catch(() => null)) as Array<Record<string, unknown>> | null;
  const row = rows?.[0];
  if (!row) return fail("JOB_NOT_FOUND");

  return {
    ok: true as const,
    value: {
      jobId: String(row.job_id),
      jobType: String(row.job_type) as JobType,
      state: String(row.state) as JobState,
      attempt: Number(row.attempt),
      itemsSeen: Number(row.items_seen),
      itemsDone: Number(row.items_done),
      errorCode: typeof row.error_code === "string" ? row.error_code : null,
      createdAt: String(row.created_at),
      completedAt: typeof row.completed_at === "string" ? row.completed_at : null,
    },
  };
}

// Lists a connection's recent jobs, so the connections panel can show real sync state
// (running / last result / pending changes) instead of a spinner that means nothing.
export async function listConnectionJobs(
  workspaceKey: string,
  oauthConnectionId: string,
  limit = 10,
): Promise<JobResult<JobStatus[]>> {
  if (!WORKSPACE_KEY.test(workspaceKey) || !UUID.test(oauthConnectionId)) return fail("JOB_SCOPE_INVALID");
  const config = readSupabaseAdminConfig();
  if (!config) return fail("JOB_STORE_NOT_CONFIGURED");

  const query = new URLSearchParams({
    select: "job_id,job_type,state,attempt,items_seen,items_done,error_code,created_at,completed_at",
    workspace_key: `eq.${workspaceKey}`,
    oauth_connection_id: `eq.${oauthConnectionId}`,
    order: "created_at.desc",
    limit: String(Math.min(Math.max(limit, 1), 50)),
  });

  let response: Response;
  try {
    response = await supabaseAdminRequest(config, `/rest/v1/foundation_jobs?${query}`);
  } catch {
    return fail("JOB_STORE_READ_FAILED");
  }
  if (!response.ok) return fail("JOB_STORE_READ_FAILED");
  const rows = (await response.json().catch(() => null)) as Array<Record<string, unknown>> | null;
  if (!rows) return fail("JOB_STORE_READ_FAILED");

  return {
    ok: true as const,
    value: rows.map((row) => ({
      jobId: String(row.job_id),
      jobType: String(row.job_type) as JobType,
      state: String(row.state) as JobState,
      attempt: Number(row.attempt),
      itemsSeen: Number(row.items_seen),
      itemsDone: Number(row.items_done),
      errorCode: typeof row.error_code === "string" ? row.error_code : null,
      createdAt: String(row.created_at),
      completedAt: typeof row.completed_at === "string" ? row.completed_at : null,
    })),
  };
}
