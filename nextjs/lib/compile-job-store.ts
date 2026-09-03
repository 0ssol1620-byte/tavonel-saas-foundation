import { createHash, randomBytes } from "node:crypto";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";
import { CORPUS_ID_PATTERN, planCorpusBatches, type CorpusBatch } from "./corpus-batching";
import { corpusIdFor } from "./corpus-id";

/*
  The application's view of durable compile orchestration (migration 0038).

  Every invariant that matters under concurrency -- idempotent enqueue, monotonic state,
  terminal-is-terminal -- lives in the database functions, for the same reason the queue in
  `job-store.ts` puts them there: two workers and a browser can all write at once, and only
  the database sees every writer. This module validates its inputs and does no reasoning
  about ordering.
*/

export const COMPILE_STATES = [
  "draft",
  "preflight",
  "awaiting_confirmation",
  "uploading",
  "sanitizing",
  "reading",
  "structuring",
  "resolving",
  "building_world",
  "review_required",
  "ready",
  "failed",
  "cancelled",
] as const;

export type CompileState = (typeof COMPILE_STATES)[number];

/** Reached, nothing further happens, and a redelivery may not move it. */
export const TERMINAL_COMPILE_STATES: readonly CompileState[] = ["ready", "failed", "cancelled"];

export function isTerminalCompileState(state: CompileState) {
  return TERMINAL_COMPILE_STATES.includes(state);
}

export type CompileBlocker = {
  documentId: string;
  /*
    `reason` is a machine code, and the distinction between these two groups is load-bearing.

    A `security` blocker -- an encrypted archive, a nested archive, a file that failed
    sanitation -- is never included in a "continue with the rest" offer without the customer
    saying so explicitly, because quietly proceeding past a security stop is how a pipeline
    learns to ignore them. An `input` blocker (unsupported type, unreadable page) is ordinary
    and may be skipped.
  */
  kind: "input" | "security";
  reason: string;
};

export type CompileJob = {
  jobId: string;
  workspaceKey: string;
  documentIds: string[];
  state: CompileState;
  collectionId: string | null;
  errorCode: string | null;
  blocked: CompileBlocker[];
  blockedResolution: BlockerResolution | null;
  documentsTotal: number;
  documentsReady: number;
  /* Set only on a part of a corpus compile; null on an ordinary single compile (0040). */
  corpusId: string | null;
  batchIndex: number | null;
  batchCount: number | null;
  createdAt: string;
  updatedAt: string;
  settledAt: string | null;
};

export type CompileJobEvent = {
  sequence: number;
  jobId: string;
  eventType: string;
  state: CompileState;
  documentsTotal: number;
  documentsReady: number;
  errorCode: string | null;
  detail: Record<string, unknown>;
  occurredAt: string;
};

export type CompileJobFailure =
  | "COMPILE_JOB_STORE_NOT_CONFIGURED"
  | "COMPILE_JOB_STORE_READ_FAILED"
  | "COMPILE_JOB_STORE_WRITE_FAILED"
  | "COMPILE_JOB_SCOPE_INVALID"
  | "COMPILE_JOB_NOT_FOUND";

export type CompileJobResult<T> = { ok: true; value: T } | { ok: false; code: CompileJobFailure };

const WORKSPACE_KEY = /^pilot-[A-Za-z0-9]{1,16}$/;
const COMPILE_JOB_ID = /^cjob-[a-f0-9]{32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function newCompileJobId() {
  return `cjob-${randomBytes(16).toString("hex")}`;
}

/**
 * The job's identity is its document set, not the moment it was requested.
 *
 * Sorted before hashing because the compiler is order-independent and the customer's
 * selection order is not meaningful. Two submissions of the same sources therefore collide on
 * purpose, which is what makes a double-clicked Compile button one job instead of two charges.
 */
export function compileIdempotencyKey(workspaceKey: string, documentIds: readonly string[]) {
  const canonical = [...new Set(documentIds)].sort().join("\n");
  return createHash("sha256").update(`${workspaceKey}\n${canonical}`).digest("hex");
}

function fail(code: CompileJobFailure) {
  return { ok: false as const, code };
}

function isCompileState(value: unknown): value is CompileState {
  return typeof value === "string" && (COMPILE_STATES as readonly string[]).includes(value);
}

async function admin(path: string, init?: RequestInit): Promise<Response | null> {
  const config = readSupabaseAdminConfig();
  if (!config) return null;
  try {
    return await supabaseAdminRequest(config, path, {
      ...init,
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return null;
  }
}

async function rpc(name: string, body: unknown): Promise<CompileJobResult<unknown>> {
  const config = readSupabaseAdminConfig();
  if (!config) return fail("COMPILE_JOB_STORE_NOT_CONFIGURED");
  const response = await admin(`/rest/v1/rpc/${name}`, { method: "POST", body: JSON.stringify(body) });
  if (!response) return fail("COMPILE_JOB_STORE_WRITE_FAILED");
  if (!response.ok) return fail("COMPILE_JOB_STORE_WRITE_FAILED");
  const payload = await response.json().catch(() => null);
  return { ok: true as const, value: payload };
}

type CompileJobRow = {
  job_id: string;
  workspace_key: string;
  document_ids: string[];
  state: string;
  collection_id: string | null;
  error_code: string | null;
  blocked: unknown;
  blocked_resolution: string | null;
  documents_total: number;
  documents_ready: number;
  corpus_id: string | null;
  batch_index: number | null;
  batch_count: number | null;
  created_at: string;
  updated_at: string;
  settled_at: string | null;
};

function parseBlocked(value: unknown): CompileBlocker[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    if (typeof row.documentId !== "string" || typeof row.reason !== "string") return [];
    const kind = row.kind === "security" ? "security" : "input";
    return [{ documentId: row.documentId, kind, reason: row.reason } satisfies CompileBlocker];
  });
}

function toJob(row: CompileJobRow): CompileJob | null {
  if (!isCompileState(row.state)) return null;
  return {
    jobId: row.job_id,
    workspaceKey: row.workspace_key,
    documentIds: Array.isArray(row.document_ids) ? row.document_ids : [],
    state: row.state,
    collectionId: row.collection_id,
    errorCode: row.error_code,
    blocked: parseBlocked(row.blocked),
    blockedResolution: BLOCKER_RESOLUTIONS.find((value) => value === row.blocked_resolution) ?? null,
    documentsTotal: row.documents_total,
    documentsReady: row.documents_ready,
    corpusId: typeof row.corpus_id === "string" ? row.corpus_id : null,
    batchIndex: typeof row.batch_index === "number" ? row.batch_index : null,
    batchCount: typeof row.batch_count === "number" ? row.batch_count : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    settledAt: row.settled_at,
  };
}

export async function enqueueCompileJob(input: {
  workspaceKey: string;
  createdByUserId: string;
  documentIds: readonly string[];
  /* Present when this job is one part of a corpus compile. */
  corpus?: { corpusId: string; batchIndex: number; batchCount: number };
}): Promise<CompileJobResult<{ jobId: string; state: CompileState; created: boolean }>> {
  if (!WORKSPACE_KEY.test(input.workspaceKey)) return fail("COMPILE_JOB_SCOPE_INVALID");
  if (!UUID.test(input.createdByUserId)) return fail("COMPILE_JOB_SCOPE_INVALID");
  const documentIds = [...new Set(input.documentIds)];
  if (documentIds.length === 0) return fail("COMPILE_JOB_SCOPE_INVALID");
  if (input.corpus && !CORPUS_ID_PATTERN.test(input.corpus.corpusId)) return fail("COMPILE_JOB_SCOPE_INVALID");

  const result = await rpc("enqueue_foundation_compile_job", {
    p_job_id: newCompileJobId(),
    p_workspace_key: input.workspaceKey,
    p_created_by_user_id: input.createdByUserId,
    p_document_ids: documentIds,
    p_idempotency_key: compileIdempotencyKey(input.workspaceKey, documentIds),
    p_corpus_id: input.corpus?.corpusId ?? null,
    p_batch_index: input.corpus?.batchIndex ?? null,
    p_batch_count: input.corpus?.batchCount ?? null,
  });
  if (!result.ok) return result;

  const row = Array.isArray(result.value) ? result.value[0] : result.value;
  const record = row as { job_id?: unknown; state?: unknown; created?: unknown } | null;
  if (!record || typeof record.job_id !== "string" || !isCompileState(record.state)) {
    return fail("COMPILE_JOB_STORE_WRITE_FAILED");
  }
  return { ok: true, value: { jobId: record.job_id, state: record.state, created: record.created === true } };
}

export async function readCompileJob(
  workspaceKey: string,
  jobId: string,
): Promise<CompileJobResult<CompileJob>> {
  if (!WORKSPACE_KEY.test(workspaceKey) || !COMPILE_JOB_ID.test(jobId)) {
    return fail("COMPILE_JOB_SCOPE_INVALID");
  }
  const query = new URLSearchParams({
    job_id: `eq.${jobId}`,
    workspace_key: `eq.${workspaceKey}`,
    select: "*",
    limit: "1",
  });
  const response = await admin(`/rest/v1/foundation_compile_jobs?${query}`);
  if (!response) return fail("COMPILE_JOB_STORE_NOT_CONFIGURED");
  if (!response.ok) return fail("COMPILE_JOB_STORE_READ_FAILED");
  const rows = await response.json().catch(() => null) as CompileJobRow[] | null;
  if (!Array.isArray(rows) || rows.length === 0) return fail("COMPILE_JOB_NOT_FOUND");
  const job = toJob(rows[0]);
  return job ? { ok: true, value: job } : fail("COMPILE_JOB_STORE_READ_FAILED");
}

/**
 * Events strictly after `afterSequence`, oldest first.
 *
 * This is the replay a reconnecting SSE consumer asks for with `Last-Event-ID`. Returning
 * them in sequence order is the whole contract: a client that missed events 4 through 9
 * receives exactly those, and never has to re-derive state from a snapshot.
 */
export async function readCompileJobEvents(
  workspaceKey: string,
  jobId: string,
  afterSequence = 0,
  limit = 200,
): Promise<CompileJobResult<CompileJobEvent[]>> {
  if (!WORKSPACE_KEY.test(workspaceKey) || !COMPILE_JOB_ID.test(jobId)) {
    return fail("COMPILE_JOB_SCOPE_INVALID");
  }
  const query = new URLSearchParams({
    job_id: `eq.${jobId}`,
    workspace_key: `eq.${workspaceKey}`,
    event_sequence: `gt.${Math.max(0, Math.floor(afterSequence))}`,
    order: "event_sequence.asc",
    limit: String(Math.min(Math.max(1, limit), 500)),
    select: "*",
  });
  const response = await admin(`/rest/v1/foundation_compile_job_events?${query}`);
  if (!response) return fail("COMPILE_JOB_STORE_NOT_CONFIGURED");
  if (!response.ok) return fail("COMPILE_JOB_STORE_READ_FAILED");
  const rows = await response.json().catch(() => null) as Array<Record<string, unknown>> | null;
  if (!Array.isArray(rows)) return fail("COMPILE_JOB_STORE_READ_FAILED");
  const events = rows.flatMap((row) => {
    if (!isCompileState(row.state) || typeof row.event_sequence !== "number") return [];
    return [{
      sequence: row.event_sequence,
      jobId: String(row.job_id ?? jobId),
      eventType: String(row.event_type ?? "state_changed"),
      state: row.state,
      documentsTotal: Number(row.documents_total ?? 0),
      documentsReady: Number(row.documents_ready ?? 0),
      errorCode: typeof row.error_code === "string" ? row.error_code : null,
      detail: (row.detail && typeof row.detail === "object" ? row.detail : {}) as Record<string, unknown>,
      occurredAt: String(row.occurred_at ?? new Date().toISOString()),
    } satisfies CompileJobEvent];
  });
  return { ok: true, value: events };
}

export async function advanceCompileJob(input: {
  workspaceKey: string;
  jobId: string;
  state: CompileState;
  documentsReady?: number;
  collectionId?: string | null;
  errorCode?: string | null;
  blocked?: CompileBlocker[] | null;
  queueJobId?: string | null;
}): Promise<CompileJobResult<{ state: CompileState; changed: boolean }>> {
  if (!WORKSPACE_KEY.test(input.workspaceKey) || !COMPILE_JOB_ID.test(input.jobId)) {
    return fail("COMPILE_JOB_SCOPE_INVALID");
  }
  const result = await rpc("advance_foundation_compile_job", {
    p_job_id: input.jobId,
    p_workspace_key: input.workspaceKey,
    p_state: input.state,
    p_documents_ready: input.documentsReady ?? null,
    p_collection_id: input.collectionId ?? null,
    p_error_code: input.errorCode ?? null,
    p_blocked: input.blocked ?? null,
    p_queue_job_id: input.queueJobId ?? null,
  });
  if (!result.ok) return result;
  const row = Array.isArray(result.value) ? result.value[0] : result.value;
  const record = row as { state?: unknown; changed?: unknown } | null;
  if (!record || !isCompileState(record.state)) return fail("COMPILE_JOB_STORE_WRITE_FAILED");
  return { ok: true, value: { state: record.state, changed: record.changed === true } };
}

/**
 * The workspace's own jobs, newest first.
 *
 * This is what makes "close the tab and come back" work without the browser having kept a
 * job id: the customer's unfinished compiles are a server-side fact, and the workspace asks
 * for them on load rather than restoring them from local storage that a different device,
 * a cleared profile or a private window would not have.
 */
export async function listWorkspaceCompileJobs(
  workspaceKey: string,
  limit = 10,
): Promise<CompileJobResult<CompileJob[]>> {
  if (!WORKSPACE_KEY.test(workspaceKey)) return fail("COMPILE_JOB_SCOPE_INVALID");
  const query = new URLSearchParams({
    workspace_key: `eq.${workspaceKey}`,
    order: "created_at.desc",
    limit: String(Math.min(Math.max(1, limit), 50)),
    select: "*",
  });
  const response = await admin(`/rest/v1/foundation_compile_jobs?${query}`);
  if (!response) return fail("COMPILE_JOB_STORE_NOT_CONFIGURED");
  if (!response.ok) return fail("COMPILE_JOB_STORE_READ_FAILED");
  const rows = await response.json().catch(() => null) as CompileJobRow[] | null;
  if (!Array.isArray(rows)) return fail("COMPILE_JOB_STORE_READ_FAILED");
  return { ok: true, value: rows.flatMap((row) => { const job = toJob(row); return job ? [job] : []; }) };
}

export type BlockerResolution = "continue" | "remove_blocked" | "retry_eligible";

export const BLOCKER_RESOLUTIONS: readonly BlockerResolution[] = ["continue", "remove_blocked", "retry_eligible"];

/**
 * Record the customer's answer to a partial failure.
 *
 * `refusal` is not an error condition -- it is the database declining a choice that is not
 * available for this job, and the wording of the offer is the UI's business. The one that
 * matters is `SECURITY_BLOCKER_REQUIRES_EXPLICIT_REMOVAL`: a one-click continue may not step
 * over a file that failed sanitation.
 */
export async function resolveCompileJobBlockers(input: {
  workspaceKey: string;
  jobId: string;
  actorUserId: string;
  resolution: BlockerResolution;
}): Promise<CompileJobResult<{ applied: boolean; refusal: string | null; blocked: CompileBlocker[] }>> {
  if (!WORKSPACE_KEY.test(input.workspaceKey) || !COMPILE_JOB_ID.test(input.jobId)) {
    return fail("COMPILE_JOB_SCOPE_INVALID");
  }
  if (!UUID.test(input.actorUserId)) return fail("COMPILE_JOB_SCOPE_INVALID");
  if (!BLOCKER_RESOLUTIONS.includes(input.resolution)) return fail("COMPILE_JOB_SCOPE_INVALID");

  const result = await rpc("resolve_foundation_compile_job_blockers", {
    p_job_id: input.jobId,
    p_workspace_key: input.workspaceKey,
    p_actor_user_id: input.actorUserId,
    p_resolution: input.resolution,
  });
  if (!result.ok) return result;
  const row = Array.isArray(result.value) ? result.value[0] : result.value;
  if (!row) return fail("COMPILE_JOB_NOT_FOUND");
  const record = row as { applied?: unknown; refusal?: unknown; blocked?: unknown };
  return {
    ok: true,
    value: {
      applied: record.applied === true,
      refusal: typeof record.refusal === "string" ? record.refusal : null,
      blocked: parseBlocked(record.blocked),
    },
  };
}

/** Every job a worker could still move, oldest first so nothing starves. */
export async function readOpenCompileJobs(limit = 20): Promise<CompileJobResult<CompileJob[]>> {
  const query = new URLSearchParams({
    state: "not.in.(ready,failed,cancelled)",
    order: "updated_at.asc",
    limit: String(Math.min(Math.max(1, limit), 100)),
    select: "*",
  });
  const response = await admin(`/rest/v1/foundation_compile_jobs?${query}`);
  if (!response) return fail("COMPILE_JOB_STORE_NOT_CONFIGURED");
  if (!response.ok) return fail("COMPILE_JOB_STORE_READ_FAILED");
  const rows = await response.json().catch(() => null) as CompileJobRow[] | null;
  if (!Array.isArray(rows)) return fail("COMPILE_JOB_STORE_READ_FAILED");
  return { ok: true, value: rows.flatMap((row) => { const job = toJob(row); return job ? [job] : []; }) };
}

/*
  Enqueue a corpus: one compile job per part, sequentially, into a corpus derived from the set.

  Sequential rather than parallel on purpose. Each part carries its own idempotency key, so a
  parallel burst is safe against duplication, but a workspace submitting a hundred documents
  would open eleven Supabase round trips at once for a run whose first part will not start any
  sooner for it. Enqueue is the cheap half; the compile is not.

  Partial enqueue is a normal outcome, not an error to unwind. If part 7 of 11 fails to write,
  parts 0..6 exist and are already being worked; the caller is told how far it got, and
  resubmitting the same selection lands in the same corpus and fills in the rest -- which is
  why the corpus id is derived from the document set rather than generated.
*/
export async function enqueueCorpusCompile(input: {
  workspaceKey: string;
  createdByUserId: string;
  documentIds: readonly string[];
}): Promise<CompileJobResult<{
  corpusId: string;
  batchCount: number;
  parts: Array<{ jobId: string; batchIndex: number; state: CompileState; created: boolean }>;
  incompleteReason: CompileJobFailure | null;
}>> {
  if (!WORKSPACE_KEY.test(input.workspaceKey)) return fail("COMPILE_JOB_SCOPE_INVALID");
  const batches: CorpusBatch[] = planCorpusBatches(input.documentIds);
  if (batches.length === 0) return fail("COMPILE_JOB_SCOPE_INVALID");
  const corpusId = corpusIdFor(input.workspaceKey, input.documentIds);

  const parts: Array<{ jobId: string; batchIndex: number; state: CompileState; created: boolean }> = [];
  for (const batch of batches) {
    const enqueued = await enqueueCompileJob({
      workspaceKey: input.workspaceKey,
      createdByUserId: input.createdByUserId,
      documentIds: batch.documentIds,
      corpus: { corpusId, batchIndex: batch.index, batchCount: batch.count },
    });
    if (!enqueued.ok) {
      if (parts.length === 0) return enqueued;
      return {
        ok: true,
        value: { corpusId, batchCount: batches.length, parts, incompleteReason: enqueued.code },
      };
    }
    parts.push({ ...enqueued.value, batchIndex: batch.index });
  }
  return { ok: true, value: { corpusId, batchCount: batches.length, parts, incompleteReason: null } };
}

/** Every part of one corpus, in position order. */
export async function readCorpusParts(
  workspaceKey: string,
  corpusId: string,
): Promise<CompileJobResult<CompileJob[]>> {
  if (!WORKSPACE_KEY.test(workspaceKey) || !CORPUS_ID_PATTERN.test(corpusId)) {
    return fail("COMPILE_JOB_SCOPE_INVALID");
  }
  const query = new URLSearchParams({
    workspace_key: `eq.${workspaceKey}`,
    corpus_id: `eq.${corpusId}`,
    select: "*",
    order: "batch_index.asc",
    limit: "64",
  });
  const response = await admin(`/rest/v1/foundation_compile_jobs?${query}`);
  if (!response) return fail("COMPILE_JOB_STORE_NOT_CONFIGURED");
  if (!response.ok) return fail("COMPILE_JOB_STORE_READ_FAILED");
  const rows = await response.json().catch(() => null) as CompileJobRow[] | null;
  if (!Array.isArray(rows)) return fail("COMPILE_JOB_STORE_READ_FAILED");
  if (rows.length === 0) return fail("COMPILE_JOB_NOT_FOUND");
  const jobs = rows.map(toJob);
  if (jobs.some((job) => job === null)) return fail("COMPILE_JOB_STORE_READ_FAILED");
  return { ok: true, value: jobs as CompileJob[] };
}
