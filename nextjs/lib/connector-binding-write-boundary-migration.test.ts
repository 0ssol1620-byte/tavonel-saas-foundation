import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Text contract only. Behavior (refused direct insert, identity mismatch, tie resolution,
// sub-millisecond order) is qualified on actual PostgreSQL/PostgREST in
// scripts/journey/source-revision-journey.mjs.
const migration = readFileSync("../supabase/migrations/20261001150000_connector_binding_write_boundary.sql", "utf8");
const body = (name: string) => {
  const start = migration.indexOf(`function public.${name}(`);
  expect(start).toBeGreaterThan(-1);
  return migration.slice(start, migration.indexOf("\n$$;", start));
};

describe("connector binding write boundary migration", () => {
  it("refuses direct API-role inserts in the binding guard without changing table privileges", () => {
    const guard = body("guard_connector_document_binding");
    expect(guard).toMatch(/if tg_op <> 'INSERT' then raise exception 'CONNECTOR_BINDING_IMMUTABLE'/);
    expect(guard).toMatch(/if current_user in \('anon', 'authenticated', 'service_role'\) then\s+raise exception 'CONNECTOR_BINDING_WRITE_PATH'/);
    expect(guard).toMatch(/status = 'active' for share/);
    expect(guard).not.toMatch(/security definer/);
    expect(migration).not.toMatch(/(grant|revoke)\s+[a-z, ]*\s+on\s+(table\s+)?public\.connector_document_bindings/i);
  });

  it("derives identity exactly like connector-source-identity.ts and refuses a mismatch before the lock", () => {
    const identity = body("connector_binding_identity");
    expect(identity).toContain(`'["connector.v1",' || pg_catalog.to_json(p_workspace_key)::text || ',' || pg_catalog.to_json(p_connection_id)::text || ','`);
    expect(identity).toContain(`'[' || pg_catalog.to_json(source_id)::text || ',' || pg_catalog.to_json(p_revision)::text || ']'`);
    expect(identity).toContain(`'tavonel-source-intake' || pg_catalog.chr(31) || p_workspace_key || pg_catalog.chr(31) || v_legacy`);
    expect(identity).toMatch(/& 15\) \| 80/);
    expect(identity).toMatch(/& 63\) \| 128/);
    const writer = body("record_connector_document_binding_after");
    expect(writer.indexOf("CONNECTOR_BINDING_IDENTITY_MISMATCH")).toBeLessThan(writer.indexOf("pg_advisory_xact_lock"));
  });

  it("computes the newest set once, exactly, and resolves only an exactly matching tie", () => {
    const newest = body("connector_source_newest_versions");
    expect(newest).toMatch(/b\.recorded_at = v_top_at/);
    expect(newest).toMatch(/r\.tied_source_version_ids = v_set/);
    expect(newest).not.toMatch(/limit 1|order by b\.recorded_at|date_trunc/i);
    const writer = body("record_connector_document_binding_after");
    expect(writer).toMatch(/v_newest := public\.connector_source_newest_versions\(v_workspace, v_source\)/);
    expect(writer).toMatch(/cardinality\(v_newest\) > 1 and v_version = any \(v_newest\) and v_newest = v_expected/);
    expect(writer.indexOf("SOURCE_TOMBSTONED")).toBeLessThan(writer.indexOf("insert into public.connector_binding_tie_resolutions"));
    expect(writer.indexOf("CONNECTOR_BINDING_CONNECTION_INVALID")).toBeLessThan(writer.indexOf("insert into public.connector_binding_tie_resolutions"));
    expect(writer).toMatch(/if v_newest is distinct from v_expected then\s+return 'contested'/);
    expect(writer).toMatch(/v_now <= v_top_at then\s+return 'contested'/);
    expect(writer).not.toMatch(/provider_revision\s*[<>]|source_version_id\s*[<>]/);
  });

  it("routes the earlier writer through the same decisions and keeps resolutions immutable and private", () => {
    expect(body("record_connector_document_binding_current")).toMatch(/return public\.record_connector_document_binding_after\(/);
    expect(migration).toMatch(/before update\s+on public\.connector_binding_tie_resolutions/);
    expect(migration).toMatch(/revoke all on public\.connector_binding_tie_resolutions from public, anon, authenticated, service_role/);
    expect(migration).toMatch(/alter table public\.connector_binding_tie_resolutions enable row level security/);
    for (const fn of ["connector_binding_identity(text, text, text, text, text)", "connector_source_newest_versions(text, text)",
      "record_connector_document_binding_after(jsonb, text[])", "record_connector_document_binding_current(jsonb, text)"]) {
      expect(migration).toContain(`revoke all on function public.${fn} from public, anon, authenticated;`);
      expect(migration).toContain(`grant execute on function public.${fn} to service_role;`);
    }
    expect(migration).not.toMatch(/\b(update|delete from)\s+public\.connector_document_bindings|drop trigger|disable trigger/i);
  });
});
