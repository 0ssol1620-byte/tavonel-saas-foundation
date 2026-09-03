import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { COMPILE_STATES } from "./compile-job-store";

const migration = readFileSync(
  resolve(import.meta.dirname, "../../supabase/migrations/0038_foundation_compile_jobs.sql"),
  "utf8",
);

describe("durable compile job schema", () => {
  it("names every lifecycle state the product promises, and the same ones the application knows", () => {
    // Masterplan 6.4 lists thirteen states. A UI that can render a state the database cannot
    // store, or the reverse, is a bug that only appears when a customer hits that state.
    for (const state of COMPILE_STATES) {
      expect(migration).toContain(`'${state}'`);
    }
    expect(COMPILE_STATES).toHaveLength(13);
  });

  it("makes the document set the job's identity, so a resubmission is one compile", () => {
    expect(migration).toContain("idempotency_key text not null");
    expect(migration).toContain("create unique index foundation_compile_jobs_idempotency_idx");
    expect(migration).toContain("(workspace_key, idempotency_key)");
  });

  it("leaves the product's document limit to the application", () => {
    // COMPILE_MAX_DOCUMENTS is the single authority. The check here is structural, and writing
    // the product number in SQL as well is how a limit ends up spelled three ways.
    expect(migration).toContain("cardinality(document_ids) between 1 and 1000");
    expect(migration).not.toMatch(/cardinality\(document_ids\)\s*(<=|between 1 and)\s*12\b/);
  });

  it("keeps the event ledger append-only, because it is what a reconnecting client replays", () => {
    expect(migration).toContain("foundation_compile_job_events is append-only");
    expect(migration).toContain("before update or delete on public.foundation_compile_job_events");
    expect(migration).toContain("event_sequence bigint generated always as identity");
    expect(migration).toContain("primary key (job_id, event_sequence)");
    expect(migration).not.toMatch(/grant\s+(update|delete)\s+on\s+public\.foundation_compile_job_events/i);
  });

  it("refuses to move a settled job, so a redelivery cannot resurrect one", () => {
    expect(migration).toContain("Terminal is terminal");
    expect(migration).toContain("if v_row.state in ('ready', 'failed', 'cancelled') then");
    expect(migration).toContain("v_rank_next < v_rank_current");
  });

  it("will not let a one-click continue step over a security blocker", () => {
    // Masterplan 6.5. The four offers exist so a partial failure is a decision, and the one
    // decision that may not be taken casually is skipping a file that failed sanitation.
    expect(migration).toContain("SECURITY_BLOCKER_REQUIRES_EXPLICIT_REMOVAL");
    expect(migration).toContain("if v_security > 0 and p_resolution = 'continue' then");
    // retry_eligible clears ordinary blockers and keeps the security ones.
    expect(migration).toContain("where entry ->> 'kind' = 'security'");
  });

  it("records who resolved a partial failure and when", () => {
    expect(migration).toContain("blocked_resolved_by uuid");
    expect(migration).toContain("foundation_compile_jobs_resolution_is_attributed");
  });

  it("is reachable only by the service role", () => {
    expect(migration).toContain("alter table public.foundation_compile_jobs enable row level security");
    expect(migration).toContain("revoke all on public.foundation_compile_jobs from public, anon, authenticated");
    expect(migration).toContain("revoke all on public.foundation_compile_job_events from public, anon, authenticated");
    for (const fn of [
      "enqueue_foundation_compile_job",
      "advance_foundation_compile_job",
      "resolve_foundation_compile_job_blockers",
    ]) {
      expect(migration).toContain(`revoke all on function public.${fn}(`);
      expect(migration).toContain(`grant execute on function public.${fn}(`);
    }
  });

  it("cannot report ready without the World it produced", () => {
    expect(migration).toContain("foundation_compile_jobs_ready_has_collection");
    expect(migration).toContain("foundation_compile_jobs_terminal_is_settled");
  });
});
