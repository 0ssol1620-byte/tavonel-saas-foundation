import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Text contract only. Behavior is qualified against actual PostgreSQL/PostgREST in
// scripts/journey/source-revision-journey.mjs (legacy tie recovery, concurrency, two-session lock).
const migration = readFileSync("../supabase/migrations/20261001120000_connector_binding_tie_recovery.sql", "utf8");
const cas = readFileSync("../supabase/migrations/20261001090000_connector_binding_latest_cas.sql", "utf8");

describe("connector binding tie-recovery migration", () => {
  it("serializes with the existing compare-and-set under the same per-source lock", () => {
    const key = /pg_advisory_xact_lock\(pg_catalog\.hashtextextended\(\s*'tavonel\.connector_binding_latest\.v1' \|\| pg_catalog\.chr\(10\) \|\| v_workspace \|\| pg_catalog\.chr\(10\) \|\| v_source, 0\)\)/;
    expect(migration).toMatch(key);
    expect(cas).toMatch(key);
    const lock = migration.search(/pg_advisory_xact_lock/);
    expect(migration.search(/return 'replay'/)).toBeGreaterThan(lock);
    expect(migration.search(/max\(b\.recorded_at\)/)).toBeGreaterThan(migration.search(/return 'replay'/));
    expect(migration.search(/insert into public\.connector_document_bindings/)).toBeGreaterThan(lock);
  });

  it("compares the whole newest set and never prefers one tied row", () => {
    expect(migration).toMatch(/b\.recorded_at = v_top_at/);
    expect(migration).toMatch(/if v_top is distinct from v_expected then\s+return 'contested'/);
    expect(migration).toMatch(/v_now <= v_top_at then\s+return 'contested'/);
    expect(migration).not.toMatch(/limit 1/i);
    expect(migration).not.toMatch(/provider_revision\s*[<>]|source_version_id\s*[<>]/);
  });

  it("validates the snapshot set and is service-only, leaving the table and the 2-argument function alone", () => {
    expect(migration).toMatch(/cardinality\(p_expected_latest_source_version_ids\) > 16/);
    expect(migration).toMatch(/raise exception 'CONNECTOR_BINDING_INVALID'/);
    expect(migration).toMatch(/security definer set search_path = ''/);
    expect(migration).toMatch(/revoke all on function public\.record_connector_document_binding_after\(jsonb, text\[\]\) from public, anon, authenticated/);
    expect(migration).toMatch(/grant execute on function public\.record_connector_document_binding_after\(jsonb, text\[\]\) to service_role/);
    expect(migration).not.toMatch(/record_connector_document_binding_current\(/);
    expect(migration).not.toMatch(/\b(update|delete from)\s+public\.connector_document_bindings|drop trigger|disable trigger|alter table|grant (insert|update|delete)/i);
  });
});
