import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Text contract only. Behavior is qualified against actual PostgreSQL/PostgREST in
// scripts/journey/source-revision-journey.mjs (concurrent requests and a two-session lock race).
const migration = readFileSync("../supabase/migrations/20261001090000_connector_binding_latest_cas.sql", "utf8");

describe("connector binding latest compare-and-set migration", () => {
  it("serializes one logical source and decides latest and insert under the same lock", () => {
    expect(migration).toMatch(/pg_advisory_xact_lock\(pg_catalog\.hashtextextended\(\s*'tavonel\.connector_binding_latest\.v1'[\s\S]+v_workspace[\s\S]+v_source/i);
    const lock = migration.search(/pg_advisory_xact_lock/i);
    expect(lock).toBeGreaterThan(0);
    expect(migration.search(/order by b\.recorded_at desc/i)).toBeGreaterThan(lock);
    expect(migration.search(/insert into public\.connector_document_bindings/i)).toBeGreaterThan(lock);
  });

  it("orders only by database observation, refuses equal instants, and never moves latest on replay", () => {
    expect(migration).toMatch(/return 'replay'/);
    expect(migration.search(/return 'replay'/)).toBeLessThan(migration.search(/order by b\.recorded_at desc/i));
    expect(migration).toMatch(/v_next_at = v_top_at then return 'contested'/);
    expect(migration).toMatch(/v_top_id is distinct from p_expected_latest_source_version_id then\s+return 'contested'/);
    expect(migration).toMatch(/pg_catalog\.clock_timestamp\(\)\);/);
    expect(migration).not.toMatch(/provider_revision\s*[<>]/);
  });

  it("is service-only with a fixed search path and leaves the table immutable", () => {
    expect(migration).toMatch(/security definer set search_path = ''/);
    expect(migration).toMatch(/revoke all on function public\.record_connector_document_binding_current\(jsonb, text\) from public, anon, authenticated/);
    expect(migration).toMatch(/grant execute on function public\.record_connector_document_binding_current\(jsonb, text\) to service_role/);
    expect(migration).not.toMatch(/\b(update|delete from)\s+public\.connector_document_bindings/i);
    expect(migration).not.toMatch(/drop trigger|disable trigger/i);
  });
});
