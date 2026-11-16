import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/*
  WO-D30-1's migration, checked where it can be checked without a database. The real proof is
  `supabase/tests/world_change_proposals.sql` (pgTAP, db-rehearsal). This file pins what a reader
  would otherwise take on trust: RLS on with no client policy, service_role-only functions with an
  empty search_path, and the exact transition table.
*/
const FILE = "20261116130100_world_change_proposals.sql";
const migrations = resolve(import.meta.dirname, "../../supabase/migrations");
const sql = readFileSync(join(migrations, FILE), "utf8");
const code = sql.split("\n").filter((line) => !line.trimStart().startsWith("--")).join("\n");

const SIGNATURES = [
  "create_world_change_proposal(text, text, text, jsonb, text, text[], text, integer, text, uuid, text, timestamptz)",
  "decide_world_change_proposal(text, uuid, text, uuid, text, timestamptz)",
  "record_world_change_proposal_outcome(text, uuid, text, jsonb)",
  "list_world_change_proposals(text, text, integer)",
];

describe("world change proposals migration", () => {
  it("keeps the table away from every client role", () => {
    expect(code).toContain("alter table public.world_change_proposals enable row level security;");
    expect(code).toContain("revoke all on public.world_change_proposals from public, anon, authenticated, service_role;");
    expect(code).toMatch(/create policy world_change_proposals_no_client_access on public\.world_change_proposals\s+as restrictive for all to anon, authenticated using \(false\) with check \(false\);/);
    expect(code.match(/create policy/g)).toHaveLength(1);
    expect(code).not.toMatch(/grant [^;]*on (table )?public\.world_change_proposals/i);
  });

  it("declares the columns, the states and the idempotency uniqueness", () => {
    expect(code).toContain("action_type text not null check (action_type in ('library_label'))");
    expect(code).toContain("octet_length(input::text) <= 4096");
    expect(code).toContain("cardinality(evidence_ids) <= 16");
    expect(code).toContain("check (principal_kind in ('session', 'steward'))");
    expect(code).toContain("idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9._:-]{8,128}$')");
    expect(code).toContain("('proposed', 'confirmed', 'rejected', 'expired', 'stale', 'executed', 'failed', 'undone')");
    expect(code).toContain("unique (workspace_key, idempotency_key)");
    expect(code).toContain("collection_id ~ '^collection-[a-f0-9]{32}$'");
  });

  it("makes every function security definer, time-bound and service_role only", () => {
    expect(code.match(/security definer set search_path = '' set statement_timeout = '3s'/g)).toHaveLength(4);
    for (const signature of SIGNATURES) {
      expect(code).toContain(`revoke all on function public.${signature}\n  from public, anon, authenticated, service_role;`);
      expect(code).toContain(`grant execute on function public.${signature} to service_role;`);
    }
    expect(code).not.toMatch(/grant [^;]*\bto\s+(public|anon|authenticated)\b/);
  });

  it("enumerates the transitions and nothing else", () => {
    expect(code).toContain("if v_row.state <> 'proposed' then\n    raise exception 'proposal_not_decidable';");
    expect(code).toContain("when p_now >= v_row.expires_at then 'expired'");
    expect(code).toContain("when p_current_manifest_digest <> v_row.expected_manifest_digest then 'stale'");
    expect(code).toContain("(v_row.state = 'confirmed' and p_outcome in ('executed', 'failed'))");
    expect(code).toContain("(v_row.state = 'executed' and p_outcome = 'undone')");
    expect(code).toContain("raise exception 'proposal_transition_illegal'");
    expect(code.match(/for update;/g)).toHaveLength(2);
  });

  it("replays the same digest and refuses a conflicting one", () => {
    expect(code).toContain("raise exception 'proposal_idempotency_conflict'");
    expect(code).toContain("'replayed', true");
    expect(code).toContain("advisory_xact_lock");
  });

  it("never deletes a proposal", () => {
    expect(code).not.toMatch(/\bdelete\b|\btruncate\b/i);
    expect(code).not.toMatch(/\bupdate\s+public\.(?!world_change_proposals)/i);
  });
});
