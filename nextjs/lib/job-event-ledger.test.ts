import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "../supabase/migrations/0034_foundation_job_event_ledger.sql"), "utf8");

describe("foundation job event ledger migration", () => {
  it("records job transitions in an append-only tenant-scoped ledger", () => {
    expect(migration).toContain("create table public.foundation_job_events");
    expect(migration).toContain("foreign key (workspace_key, job_id)");
    expect(migration).toContain("after insert or update on public.foundation_jobs");
    expect(migration).toContain("foundation_job_events is append-only");
    expect(migration).toContain("revoke all on public.foundation_job_events from public, anon, authenticated");
  });
});

