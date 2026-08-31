import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { claimJob, completeJobBatch, enqueueJob, getJobStatus, listConnectionJobs, newJobId } from "./job-store";

// The application side of the durable job queue. The concurrency invariants live in the
// database (0025) because only the database can enforce them across simultaneous workers;
// what is testable here is that this layer validates its inputs, sends the right arguments,
// and never widens tenant scope.

const WORKSPACE = "pilot-acme01";
const USER = "11111111-1111-4111-8111-111111111111";
const CONNECTION = "22222222-2222-4222-8222-222222222222";
const JOB_ID = "job-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

let calls: Array<{ url: string; method: string; body: unknown }>;
let rpcResponse: unknown;
let rowsResponse: unknown;
let ok: boolean;

beforeEach(() => {
  calls = [];
  ok = true;
  rpcResponse = { job_id: JOB_ID, created: true };
  rowsResponse = [];
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://fixture.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_".padEnd(48, "x"));
  vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
    const href = typeof url === "string" ? url : url.toString();
    calls.push({ url: href, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
    const payload = href.includes("/rpc/") ? rpcResponse : rowsResponse;
    return { ok, status: ok ? 200 : 500, json: async () => payload } as unknown as Response;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("job id", () => {
  it("generates ids the schema CHECK accepts", () => {
    for (let index = 0; index < 20; index += 1) {
      expect(newJobId()).toMatch(/^job-[a-f0-9]{32}$/);
    }
  });

  it("does not repeat", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newJobId()));
    expect(ids.size).toBe(200);
  });
});

describe("enqueue", () => {
  const base = {
    workspaceKey: WORKSPACE,
    jobType: "source_scan" as const,
    idempotencyKey: "scan:conn-1",
    createdByUserId: USER,
    oauthConnectionId: CONNECTION,
  };

  it("enqueues through the RPC, not a direct insert", () => {
    // Enqueue must go through enqueue_foundation_job: the dedup check and the insert have to
    // be one statement, or two concurrent clicks each see "no live job" and insert two.
    return enqueueJob(base).then(() => {
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toContain("/rpc/enqueue_foundation_job");
      expect(calls[0].method).toBe("POST");
    });
  });

  it("reports whether the job was created or collapsed onto a live one", async () => {
    rpcResponse = { job_id: JOB_ID, created: true };
    expect((await enqueueJob(base)).ok && (await enqueueJob(base))).toBeTruthy();

    rpcResponse = { job_id: JOB_ID, created: false };
    const second = await enqueueJob(base);
    expect(second.ok && second.value).toEqual({ jobId: JOB_ID, created: false });
  });

  it("refuses a workspace key the schema would reject", async () => {
    // A key that fails the CHECK would surface as an opaque PostgREST error mid-flow.
    for (const bad of ["", "acme", "pilot-", "pilot-waytoolongworkspacekey", "../../etc"]) {
      const result = await enqueueJob({ ...base, workspaceKey: bad });
      expect(result).toEqual({ ok: false, code: "JOB_SCOPE_INVALID" });
    }
    expect(calls).toHaveLength(0);
  });

  it("refuses a malformed actor or connection id", async () => {
    expect(await enqueueJob({ ...base, createdByUserId: "nope" })).toEqual({ ok: false, code: "JOB_SCOPE_INVALID" });
    expect(await enqueueJob({ ...base, oauthConnectionId: "nope" })).toEqual({ ok: false, code: "JOB_SCOPE_INVALID" });
    expect(calls).toHaveLength(0);
  });

  it("refuses an idempotency key outside the schema's bounds", async () => {
    expect(await enqueueJob({ ...base, idempotencyKey: "short" })).toEqual({ ok: false, code: "JOB_SCOPE_INVALID" });
    expect(await enqueueJob({ ...base, idempotencyKey: "x".repeat(201) })).toEqual({ ok: false, code: "JOB_SCOPE_INVALID" });
    expect(calls).toHaveLength(0);
  });

  it("rejects a response whose job id is not a real job id", async () => {
    // Fail closed rather than hand back an id the caller will poll forever.
    rpcResponse = { job_id: "job-not-hex", created: true };
    expect(await enqueueJob(base)).toEqual({ ok: false, code: "JOB_STORE_WRITE_FAILED" });
  });
});

describe("claim", () => {
  it("returns null for an empty queue rather than an error", async () => {
    // A worker polling an idle queue is the normal case.
    rpcResponse = { claimed: false };
    const result = await claimJob("worker-1");
    expect(result).toEqual({ ok: true, value: null });
  });

  it("maps a claimed job, including its resume cursor and progress", async () => {
    rpcResponse = {
      claimed: true,
      job_id: JOB_ID,
      workspace_key: WORKSPACE,
      job_type: "source_import",
      attempt: 2,
      max_attempts: 5,
      oauth_connection_id: CONNECTION,
      collection_id: null,
      payload: { target: { rootPath: "/docs" } },
      cursor_token: "page-token-7",
      items_seen: 400,
      items_done: 380,
    };
    const result = await claimJob("worker-1", 180, ["source_import"]);
    expect(result.ok && result.value).toMatchObject({
      jobId: JOB_ID,
      jobType: "source_import",
      attempt: 2,
      cursorToken: "page-token-7",
      itemsSeen: 400,
      itemsDone: 380,
    });
    expect(calls[0].body).toMatchObject({ p_worker_id: "worker-1", p_lease_seconds: 180, p_job_types: ["source_import"] });
  });
});

describe("batch completion", () => {
  beforeEach(() => {
    rpcResponse = { state: "leased" };
  });

  it("sends the cursor with the batch that earned it", async () => {
    // The lost-update guard: cursor and progress move together or not at all.
    await completeJobBatch(WORKSPACE, JOB_ID, "worker-1", {
      outcome: "progress",
      itemsSeen: 200,
      itemsDone: 190,
      cursorToken: "page-token-8",
    });
    expect(calls[0].body).toMatchObject({
      p_outcome: "progress",
      p_items_seen_delta: 200,
      p_items_done_delta: 190,
      p_cursor_token: "page-token-8",
    });
  });

  it("carries an error code on retry and on permanent failure", async () => {
    await completeJobBatch(WORKSPACE, JOB_ID, "worker-1", { outcome: "retry", errorCode: "PROVIDER_RATE_LIMIT" });
    expect(calls[0].body).toMatchObject({ p_outcome: "retry", p_error_code: "PROVIDER_RATE_LIMIT" });

    calls.length = 0;
    await completeJobBatch(WORKSPACE, JOB_ID, "worker-1", { outcome: "failed", errorCode: "SOURCE_REVOKED" });
    expect(calls[0].body).toMatchObject({ p_outcome: "failed", p_error_code: "SOURCE_REVOKED" });
  });

  it("bounds a deferred pause and sends it through the scheduling parameter", async () => {
    await completeJobBatch(WORKSPACE, JOB_ID, "worker-1", {
      outcome: "deferred",
      errorCode: "INTAKE_DAILY_QUOTA_EXCEEDED",
      retryAfterSeconds: 3_600,
    });
    expect(calls[0].body).toMatchObject({
      p_outcome: "deferred",
      p_error_code: "INTAKE_DAILY_QUOTA_EXCEEDED",
      p_lease_seconds: 3_600,
    });
  });

  it("never sends a cursor for a permanent failure", async () => {
    // Nothing was earned, so nothing may advance.
    await completeJobBatch(WORKSPACE, JOB_ID, "worker-1", { outcome: "failed", errorCode: "SOURCE_REVOKED" });
    expect((calls[0].body as Record<string, unknown>).p_cursor_token).toBeNull();
  });

  it("refuses a malformed workspace or job id before calling", async () => {
    expect(await completeJobBatch("nope", JOB_ID, "w", { outcome: "progress", itemsSeen: 1, itemsDone: 1 }))
      .toEqual({ ok: false, code: "JOB_SCOPE_INVALID" });
    expect(await completeJobBatch(WORKSPACE, "job-nothex", "w", { outcome: "progress", itemsSeen: 1, itemsDone: 1 }))
      .toEqual({ ok: false, code: "JOB_SCOPE_INVALID" });
    expect(calls).toHaveLength(0);
  });
});

describe("status reads", () => {
  it("scopes a status read to the caller's workspace", async () => {
    // Without workspace_key on the query, knowing a job id would be enough to read another
    // tenant's job.
    rowsResponse = [{
      job_id: JOB_ID, job_type: "source_scan", state: "succeeded", attempt: 1,
      items_seen: 10, items_done: 10, error_code: null,
      created_at: "2026-08-31T00:00:00Z", completed_at: "2026-08-31T00:01:00Z",
    }];
    const result = await getJobStatus(WORKSPACE, JOB_ID);
    expect(result.ok && result.value.state).toBe("succeeded");
    expect(calls[0].url).toContain(`workspace_key=eq.${WORKSPACE}`);
    expect(calls[0].url).toContain(`job_id=eq.${JOB_ID}`);
  });

  it("reports a missing job distinctly from a read failure", async () => {
    rowsResponse = [];
    expect(await getJobStatus(WORKSPACE, JOB_ID)).toEqual({ ok: false, code: "JOB_NOT_FOUND" });

    ok = false;
    expect(await getJobStatus(WORKSPACE, JOB_ID)).toEqual({ ok: false, code: "JOB_STORE_READ_FAILED" });
  });

  it("scopes and bounds a connection's job list", async () => {
    rowsResponse = [];
    await listConnectionJobs(WORKSPACE, CONNECTION, 1000);
    expect(calls[0].url).toContain(`workspace_key=eq.${WORKSPACE}`);
    expect(calls[0].url).toContain(`oauth_connection_id=eq.${CONNECTION}`);
    // An unbounded list is a denial-of-service on our own database.
    expect(calls[0].url).toContain("limit=50");
  });
});
