import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(import.meta.dirname, "../..", path), "utf8");
const schema = read("supabase/migrations/0024_foundation_jobs.sql");
const rpc = read("supabase/migrations/0025_foundation_job_rpc.sql");

// The durable job layer exists to remove a bound that is currently real: the connector sync
// route runs with maxDuration = 60 and hard-refuses maxImports > 3, because that is what one
// Vercel invocation can finish. A customer connecting a Drive with 10,000 files has no path
// that terminates. These assertions pin the properties that make a queue safe to build on --
// each one corresponds to a specific way an unsafe queue corrupts data.

describe("foundation jobs schema", () => {
  it("creates the jobs table with tenant-scoped keys", () => {
    expect(schema).toContain("create table public.foundation_jobs");
    expect(schema).toContain("primary key (workspace_key, job_id)");
    expect(schema).toContain("workspace_key text not null check (workspace_key ~ '^pilot-[A-Za-z0-9]{1,16}$')");
  });

  it("locks the table to service_role only", () => {
    expect(schema).toContain("enable row level security");
    expect(schema).toContain("revoke all on public.foundation_jobs from public, anon, authenticated");
    expect(schema).toContain("to service_role");
    expect(schema).not.toMatch(/grant .* to (authenticated|anon|public);/);
  });

  it("deduplicates live work so a double enqueue cannot produce two jobs", () => {
    // Two concurrent bulk imports of one connection would race on the cursor and duplicate
    // documents. The partial index allows the same work to run again later, once the first
    // job is terminal, which is correct -- tomorrow's scan is a new job.
    expect(schema).toContain("create unique index foundation_jobs_idempotency_idx");
    expect(schema).toMatch(/where state in \('queued', 'leased'\)/);
  });

  it("uses expiring leases rather than locks, so a dead worker cannot strand a job", () => {
    expect(schema).toContain("lease_expires_at timestamptz");
    expect(schema).toContain("foundation_jobs_lease_paired");
    expect(schema).toContain("foundation_jobs_lease_state");
    expect(schema).toContain("create index foundation_jobs_lease_expiry_idx");
  });

  it("bounds retries and keeps exhausted jobs visible", () => {
    expect(schema).toContain("max_attempts integer not null default 5");
    expect(schema).toMatch(/'dead'/);
    expect(schema).toContain("foundation_jobs_failure_reason");
  });

  it("stores the provider resume token on the job, not only on the connection", () => {
    // A cursor that advances independently of the batch that earned it is the lost-update
    // failure: a sync reports success while silently skipping files.
    expect(schema).toContain("cursor_token text");
    expect(schema).toMatch(/char_length\(cursor_token\) <= 4096/);
  });

  it("refuses to store anything credential-shaped in a job payload", () => {
    // Provider tokens live in the secret broker. A queue row is the wrong place for one and
    // would widen exposure to anything that can read the jobs table.
    expect(schema).toMatch(/payload::text !~\* '"\(secret\|password\|token\|credential\|access_token\|refresh_token\|private\[_-\]\?key\)"/);
    expect(schema).toMatch(/octet_length\(payload::text\) <= 8192/);
  });

  it("keeps job history after a connection is revoked", () => {
    // Deliberately not a foreign key: the audit trail must survive the thing it describes,
    // or it disappears exactly when someone needs to ask what the job did.
    expect(schema).toContain("oauth_connection_id uuid");
    expect(schema).not.toMatch(/oauth_connection_id uuid[^,]*references/);
  });

  it("requires terminal jobs to record when and why they ended", () => {
    expect(schema).toContain("foundation_jobs_terminal_completed");
    expect(schema).toContain("foundation_jobs_progress");
  });
});

describe("foundation job RPCs", () => {
  it("exposes exactly enqueue, claim and batch-completion", () => {
    for (const fn of [
      "public.enqueue_foundation_job",
      "public.claim_foundation_job",
      "public.complete_foundation_job_batch",
    ]) {
      expect(rpc).toContain(`create or replace function ${fn}`);
    }
    expect(rpc.match(/create or replace function/g)?.length).toBe(3);
  });

  it("claims atomically with skip locked, so two workers cannot take one job", () => {
    // A read-then-write claim lets both workers read the same row before either writes, and
    // both then import the same files.
    expect(rpc).toContain("for update skip locked");
  });

  it("reclaims a job whose lease expired, so a crashed worker does not strand it", () => {
    expect(rpc).toMatch(/state = 'leased' and lease_expires_at < now\(\)/);
    // Reclaiming still increments attempt, so a job that repeatedly kills its worker walks
    // toward 'dead' instead of looping forever.
    expect(rpc).toContain("attempt = attempt + 1");
  });

  it("lets only the lease holder report progress", () => {
    // A worker whose lease lapsed and was reclaimed must not overwrite the new holder's
    // progress or advance the cursor from a stale position.
    expect(rpc).toContain("foundation_job_lease_not_held");
    expect(rpc).toMatch(/leased_by is distinct from p_worker_id/);
  });

  it("advances the cursor in the same statement that records the batch", () => {
    expect(rpc).toContain("cursor_token = coalesce(p_cursor_token, cursor_token)");
  });

  it("backs off exponentially with a cap instead of spinning", () => {
    expect(rpc).toMatch(/least\(power\(2, least\(v_job\.attempt, 10\)\)::integer, 900\)/);
  });

  it("distinguishes a transient retry from a permanent failure", () => {
    expect(rpc).toMatch(/p_outcome not in \('progress', 'succeeded', 'retry', 'failed'\)/);
    expect(rpc).toContain("foundation_job_error_code_required");
  });

  it("returns the existing job id on a duplicate enqueue rather than failing", () => {
    // The second caller still needs something to poll.
    expect(rpc).toContain("'created', false");
  });

  it("keeps the same security posture as the other RPCs", () => {
    expect(rpc.match(/^security definer$/gm)?.length).toBe(3);
    expect(rpc.match(/^set search_path = ''$/gm)?.length).toBe(3);
    expect(rpc.match(/revoke all on function/g)?.length).toBe(3);
    expect(rpc.match(/grant execute on function/g)?.length).toBe(3);
    expect(rpc).not.toMatch(/grant execute .* to (authenticated|anon|public);/);
  });
});
